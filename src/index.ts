#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec, spawn } from 'child_process';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { existsSync, readFileSync } from 'fs';
import { resolve, join } from 'path';
import os from 'os';
import fs from 'fs/promises';
import { Client, type ClientChannel } from 'ssh2';
import { createServer, type Server as NetServer, Socket } from 'net';
import { randomUUID } from 'crypto';

// ===========================================
// ERROR HANDLING TYPES
// ===========================================

type SSHErrorType =
    | 'SHELL_PARSE_ERROR'
    | 'SSH_CONNECTION'
    | 'AUTH_FAILURE'
    | 'COMMAND_FAILED'
    | 'TIMEOUT'
    | 'BUFFER_EXCEEDED'
    | 'SESSION_NOT_FOUND'
    | 'TUNNEL_NOT_FOUND';

interface SSHError {
    errorType: SSHErrorType;
    originalCommand: string | string[];
    executedCommand?: string;
    exitCode?: number | null;
    stdout: string;
    stderr: string;
    suggestion?: string;
    truncated?: boolean;
    totalBytes?: number;
}

// ===========================================
// ERROR CLASSIFICATION HELPERS
// ===========================================

function classifyError(exitCode: number | null, stderr: string): SSHErrorType {
    const stderrLower = stderr.toLowerCase();

    // SSH connection errors
    if (stderrLower.includes('connection refused') ||
        stderrLower.includes('no route to host') ||
        stderrLower.includes('network is unreachable') ||
        stderrLower.includes('connection timed out') ||
        stderrLower.includes('could not resolve hostname')) {
        return 'SSH_CONNECTION';
    }

    // Authentication errors
    if (stderrLower.includes('permission denied') ||
        stderrLower.includes('authentication failed') ||
        stderrLower.includes('no more authentication methods') ||
        stderrLower.includes('host key verification failed') ||
        stderrLower.includes('publickey')) {
        return 'AUTH_FAILURE';
    }

    // Shell parsing errors
    if (stderrLower.includes('syntax error') ||
        stderrLower.includes('unexpected') ||
        stderrLower.includes('unterminated') ||
        stderrLower.includes('bad substitution') ||
        stderrLower.includes('command not found')) {
        return 'SHELL_PARSE_ERROR';
    }

    // Timeout
    if (exitCode === null || stderrLower.includes('timed out')) {
        return 'TIMEOUT';
    }

    // Default: command failed
    return 'COMMAND_FAILED';
}

function getSuggestion(errorType: SSHErrorType, exitCode?: number | null): string {
    const suggestions: Record<SSHErrorType, string> = {
        'SSH_CONNECTION': 'Verify host is reachable: ping <host> or check firewall settings',
        'AUTH_FAILURE': 'Check: 1) Private key path is correct, 2) Key has correct permissions (chmod 600), 3) Public key is in remote authorized_keys',
        'SHELL_PARSE_ERROR': 'Try using ssh_exec_raw with command as array to bypass shell escaping',
        'COMMAND_FAILED': `Command exited with code ${exitCode ?? 'unknown'}. Check stderr for details.`,
        'TIMEOUT': 'Command timed out. Try increasing timeout parameter or check if command is hanging',
        'BUFFER_EXCEEDED': 'Output exceeded buffer limit. Redirect output to file: command > /tmp/output.txt',
        'SESSION_NOT_FOUND': 'Session expired or not found. Start a new session with ssh_session_start',
        'TUNNEL_NOT_FOUND': 'Tunnel not found. Check active tunnels with ssh_tunnel_list',
    };

    return suggestions[errorType];
}

function formatError(error: SSHError): string {
    // Remove executedCommand from output to avoid leaking sensitive info
    const safeError = {
        ...error,
        executedCommand: error.executedCommand ? '[hidden]' : undefined,
    };
    return JSON.stringify(safeError, null, 2);
}

// Constants
const DEFAULT_TIMEOUT = 120000;  // 2 minutes
const MAX_TIMEOUT = 600000;      // 10 minutes
const MAX_BUFFER = 5 * 1024 * 1024;  // 5MB
const DISPLAY_LIMIT = 100000;    // 100KB for display
const SESSION_TIMEOUT = 30 * 60 * 1000;  // 30 minutes idle timeout
const MAX_SESSION_BUFFER = 1024 * 1024;  // 1MB per session

// ===========================================
// INTERACTIVE SESSION TYPES & STORAGE
// ===========================================

interface SSHSession {
    id: string;
    host: string;
    username: string;
    conn: Client;
    channel: ClientChannel;
    outputBuffer: string;
    createdAt: Date;
    lastActivity: Date;
}

const activeSessions: Map<string, SSHSession> = new Map();

// Session cleanup interval (clean stale sessions every 5 minutes)
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of activeSessions) {
        if (now - session.lastActivity.getTime() > SESSION_TIMEOUT) {
            console.error(`Cleaning up stale session: ${id}`);
            try {
                session.channel.close();
                session.conn.end();
            } catch (e) {
                // Ignore cleanup errors
            }
            activeSessions.delete(id);
        }
    }
}, 5 * 60 * 1000);

// ===========================================
// PORT FORWARDING TYPES & STORAGE
// ===========================================

type TunnelType = 'local' | 'remote';

interface SSHTunnel {
    id: string;
    type: TunnelType;
    host: string;
    username: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
    conn: Client;
    server?: NetServer;
    createdAt: Date;
}

const activeTunnels: Map<string, SSHTunnel> = new Map();

// Define Credential type (good practice)
interface Credential {
    id?: number;
    name: string;
    host: string;
    username: string;
    privateKeyPath: string;
}

// Initialize database
async function initDb() {
    const homeDir = os.homedir(); // Get user home directory
    const dbPath = join(homeDir, 'ssh.db'); // Construct path in home directory
    console.error(`Initializing database at: ${dbPath}`); // Log the path
    const db = await open({
        filename: dbPath, // Use absolute path in home dir
        driver: sqlite3.Database
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      username TEXT NOT NULL,
      privateKeyPath TEXT NOT NULL
    )
  `);

    return db;
}

// Validate private key path
function validatePrivateKeyPath(path: string): string {
    console.error('DEBUG: Validating key path input:', path); // Log input
    if (typeof path !== 'string') {
        throw new Error('validatePrivateKeyPath received non-string input');
    }
    const resolvedPath = resolve(path);
    console.error('DEBUG: Resolved key path:', resolvedPath); // Log resolved
    if (!existsSync(resolvedPath)) {
        throw new Error(`Private key file not found at path: ${resolvedPath}`);
    }
    return resolvedPath;
}

// Helper to get a credential by name
async function getCredentialByName(db: Database, name: string): Promise<Credential | undefined> {
    return db.get<Credential>('SELECT * FROM credentials WHERE name = ?', [name]);
}

const server = new Server(
    {
        name: 'ssh-server',
        version: '0.1.0',
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Setup tool handlers
function setupToolHandlers() {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'ssh_exec',
                description: 'Execute command over SSH using stored credentials',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of stored credential to use' },
                        command: { type: 'string', description: 'Command to execute' },
                        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000, max: 600000)' },
                    },
                    required: ['credentialName', 'command'],
                },
            },
            {
                name: 'ssh_exec_raw',
                description: 'Execute command over SSH with array arguments (no shell escaping needed)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of stored credential to use' },
                        command: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Command as array, e.g., ["grep", "-E", "pattern|other", "file.txt"]'
                        },
                        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 120000, max: 600000)' },
                    },
                    required: ['credentialName', 'command'],
                },
            },
            {
                name: 'add_credential',
                description: 'Add a new SSH credential with private key file path',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                        host: { type: 'string' },
                        username: { type: 'string' },
                        privateKeyPath: { type: 'string' },
                    },
                    required: ['name', 'host', 'username', 'privateKeyPath'],
                },
            },
            {
                name: 'list_credentials',
                description: 'List all stored SSH credentials',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'remove_credential',
                description: 'Remove a stored SSH credential',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string' },
                    },
                    required: ['name'],
                },
            },
            {
                name: 'rsync_copy',
                description: 'Copy files/directories between local and remote server via rsync (best for directories or large transfers)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of the stored credential to use' },
                        localPath: { type: 'string', description: 'Path on the local machine' },
                        remotePath: { type: 'string', description: 'Path on the remote server' },
                        direction: { type: 'string', enum: ['toRemote', 'fromRemote'], description: 'Direction of copy (toRemote or fromRemote)' },
                    },
                    required: ['credentialName', 'localPath', 'remotePath', 'direction'],
                },
            },
            {
                name: 'scp_copy',
                description: 'Copy a single file between local and remote server via SCP (simpler than rsync for single files)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of the stored credential to use' },
                        localPath: { type: 'string', description: 'Path to local file' },
                        remotePath: { type: 'string', description: 'Path on remote server' },
                        direction: { type: 'string', enum: ['toRemote', 'fromRemote'], description: 'Direction of copy (toRemote or fromRemote)' },
                    },
                    required: ['credentialName', 'localPath', 'remotePath', 'direction'],
                },
            },
            // Interactive Session Tools
            {
                name: 'ssh_session_start',
                description: 'Start an interactive SSH session with PTY (for vim, htop, etc)',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of stored credential to use' },
                    },
                    required: ['credentialName'],
                },
            },
            {
                name: 'ssh_session_send',
                description: 'Send input to an interactive SSH session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string', description: 'Session ID from ssh_session_start' },
                        input: { type: 'string', description: 'Input to send (include \\n for enter)' },
                    },
                    required: ['sessionId', 'input'],
                },
            },
            {
                name: 'ssh_session_read',
                description: 'Read output from an interactive SSH session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string', description: 'Session ID from ssh_session_start' },
                        clear: { type: 'boolean', description: 'Clear buffer after reading (default: true)' },
                    },
                    required: ['sessionId'],
                },
            },
            {
                name: 'ssh_session_end',
                description: 'End an interactive SSH session',
                inputSchema: {
                    type: 'object',
                    properties: {
                        sessionId: { type: 'string', description: 'Session ID to close' },
                    },
                    required: ['sessionId'],
                },
            },
            {
                name: 'ssh_session_list',
                description: 'List all active SSH sessions',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            // Port Forwarding Tools
            {
                name: 'ssh_tunnel_start',
                description: 'Start an SSH tunnel for port forwarding',
                inputSchema: {
                    type: 'object',
                    properties: {
                        credentialName: { type: 'string', description: 'Name of stored credential to use' },
                        type: { type: 'string', enum: ['local', 'remote'], description: 'local (-L): access remote port locally. remote (-R): expose local port to remote. Default: local' },
                        localPort: { type: 'number', description: 'Local port to bind (local) or expose (remote)' },
                        remoteHost: { type: 'string', description: 'Target host (from SSH server perspective, usually localhost)' },
                        remotePort: { type: 'number', description: 'Target port on remoteHost' },
                    },
                    required: ['credentialName', 'localPort', 'remoteHost', 'remotePort'],
                },
            },
            {
                name: 'ssh_tunnel_list',
                description: 'List all active SSH tunnels',
                inputSchema: {
                    type: 'object',
                    properties: {},
                    required: [],
                },
            },
            {
                name: 'ssh_tunnel_stop',
                description: 'Stop an SSH tunnel',
                inputSchema: {
                    type: 'object',
                    properties: {
                        tunnelId: { type: 'string', description: 'Tunnel ID to close' },
                    },
                    required: ['tunnelId'],
                },
            },
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const db = await initDb();
        console.error('DEBUG: CallToolRequest handler entered for tool:', request.params.name);
        console.error('DEBUG: Raw arguments:', JSON.stringify(request.params.arguments)); // Log raw args

        switch (request.params.name) {
            case 'ssh_exec': {
                const args = request.params.arguments as {
                    credentialName: string;
                    command: string;
                    timeout?: number;
                };
                const { credentialName, command, timeout: userTimeout } = args;

                // Validate and cap timeout
                const timeout = Math.min(userTimeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

                try {
                    // Load credentials from database
                    const cred = await getCredentialByName(db, credentialName);
                    if (!cred) {
                        throw new Error(`Credential '${credentialName}' not found.`);
                    }
                    const { host, username, privateKeyPath } = cred;
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

                    // Escape single quotes in the command for bash -ic
                    const escapedCommand = command.replace(/'/g, "'\\''");
                    // Wrap the command in bash -ic '...' to load shell environment
                    const sshCommand = `ssh -i "${validatedKeyPath}" -o BatchMode=yes -o ConnectTimeout=30 ${username}@${host} "bash -ic '${escapedCommand}'"`;
                    console.error('Executing SSH command for credential:', credentialName);

                    return new Promise((resolve) => {
                        exec(sshCommand, { maxBuffer: MAX_BUFFER, timeout }, (error, stdout, stderr) => {
                            // Handle output truncation for display
                            let displayOutput = stdout;
                            let truncated = false;
                            const totalBytes = stdout.length;

                            if (stdout.length > DISPLAY_LIMIT) {
                                truncated = true;
                                const head = stdout.substring(0, DISPLAY_LIMIT / 2);
                                const tail = stdout.substring(stdout.length - DISPLAY_LIMIT / 2);
                                displayOutput = `${head}\n\n... [${stdout.length - DISPLAY_LIMIT} bytes truncated] ...\n\n${tail}`;
                            }

                            if (error) {
                                const execError = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string; code?: number };
                                console.error(`SSH error: ${error.message}`);
                                console.error(`SSH stderr: ${stderr}`);

                                // Check if it was a timeout
                                const isTimeout = execError.killed && execError.signal === 'SIGTERM';
                                const exitCode = execError.code ?? null;
                                const errorType = isTimeout ? 'TIMEOUT' : classifyError(exitCode, stderr);

                                const sshError: SSHError = {
                                    errorType,
                                    originalCommand: command,
                                    executedCommand: sshCommand,
                                    exitCode,
                                    stdout: displayOutput,
                                    stderr,
                                    suggestion: getSuggestion(errorType, exitCode),
                                    truncated,
                                    totalBytes,
                                };

                                resolve({
                                    content: [{ type: 'text', text: formatError(sshError) }],
                                    isError: true,
                                });
                            } else {
                                console.log(`SSH success: ${stdout.substring(0, 200)}...`);
                                const output = truncated
                                    ? `[Output: ${totalBytes} bytes, showing first and last ${DISPLAY_LIMIT / 2} bytes]\n\n${displayOutput}`
                                    : stdout;
                                resolve({
                                    content: [{ type: 'text', text: output }],
                                });
                            }
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error preparing SSH command: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            case 'ssh_exec_raw': {
                const args = request.params.arguments as {
                    credentialName: string;
                    command: string[];
                    timeout?: number;
                };
                const { credentialName, command, timeout: userTimeout } = args;

                // Validate and cap timeout
                const timeout = Math.min(userTimeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);

                try {
                    // Load credentials from database
                    const cred = await getCredentialByName(db, credentialName);
                    if (!cred) {
                        throw new Error(`Credential '${credentialName}' not found.`);
                    }
                    const { host, username, privateKeyPath } = cred;
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);
                    const privateKey = readFileSync(validatedKeyPath);

                    console.error('Executing SSH raw command for credential:', credentialName);

                    // Shell-escape each argument properly for the remote shell
                    // Using single quotes and escaping any single quotes within
                    const shellEscape = (arg: string): string => {
                        // Wrap in single quotes and escape any single quotes inside
                        return "'" + arg.replace(/'/g, "'\\''") + "'";
                    };

                    // Build the command string with proper escaping
                    const escapedCommand = command.map(shellEscape).join(' ');

                    return new Promise((resolve) => {
                        const conn = new Client();
                        let stdout = '';
                        let stderr = '';
                        let truncated = false;
                        let timeoutId: NodeJS.Timeout | null = null;

                        // Set up timeout
                        timeoutId = setTimeout(() => {
                            conn.end();
                            const sshError: SSHError = {
                                errorType: 'TIMEOUT',
                                originalCommand: command,
                                exitCode: null,
                                stdout: stdout.substring(0, DISPLAY_LIMIT),
                                stderr,
                                suggestion: getSuggestion('TIMEOUT'),
                                truncated: stdout.length > DISPLAY_LIMIT,
                            };
                            resolve({
                                content: [{ type: 'text', text: formatError(sshError) }],
                                isError: true,
                            });
                        }, timeout);

                        conn.on('ready', () => {
                            conn.exec(escapedCommand, (err, stream) => {
                                if (err) {
                                    if (timeoutId) clearTimeout(timeoutId);
                                    conn.end();
                                    resolve({
                                        content: [{ type: 'text', text: `Failed to execute command: ${err.message}` }],
                                        isError: true,
                                    });
                                    return;
                                }

                                stream.on('data', (data: Buffer) => {
                                    if (stdout.length < MAX_BUFFER) {
                                        stdout += data.toString();
                                    } else {
                                        truncated = true;
                                    }
                                });

                                stream.stderr.on('data', (data: Buffer) => {
                                    stderr += data.toString();
                                });

                                stream.on('close', (code: number) => {
                                    if (timeoutId) clearTimeout(timeoutId);
                                    conn.end();

                                    const totalBytes = stdout.length;
                                    let displayOutput = stdout;

                                    if (stdout.length > DISPLAY_LIMIT) {
                                        truncated = true;
                                        const head = stdout.substring(0, DISPLAY_LIMIT / 2);
                                        const tail = stdout.substring(stdout.length - DISPLAY_LIMIT / 2);
                                        displayOutput = `${head}\n\n... [${stdout.length - DISPLAY_LIMIT} bytes truncated] ...\n\n${tail}`;
                                    }

                                    if (code !== 0) {
                                        const errorType = classifyError(code, stderr);
                                        const sshError: SSHError = {
                                            errorType,
                                            originalCommand: command,
                                            exitCode: code,
                                            stdout: displayOutput,
                                            stderr,
                                            suggestion: getSuggestion(errorType, code),
                                            truncated,
                                            totalBytes,
                                        };

                                        resolve({
                                            content: [{ type: 'text', text: formatError(sshError) }],
                                            isError: true,
                                        });
                                    } else {
                                        const output = truncated
                                            ? `[Output: ${totalBytes} bytes, showing first and last ${DISPLAY_LIMIT / 2} bytes]\n\n${displayOutput}`
                                            : stdout;
                                        resolve({
                                            content: [{ type: 'text', text: output }],
                                        });
                                    }
                                });
                            });
                        });

                        conn.on('error', (err) => {
                            if (timeoutId) clearTimeout(timeoutId);
                            const errorType = err.message.toLowerCase().includes('authentication') ? 'AUTH_FAILURE' : 'SSH_CONNECTION';
                            const sshError: SSHError = {
                                errorType,
                                originalCommand: command,
                                exitCode: null,
                                stdout: '',
                                stderr: err.message,
                                suggestion: getSuggestion(errorType),
                            };

                            resolve({
                                content: [{ type: 'text', text: formatError(sshError) }],
                                isError: true,
                            });
                        });

                        conn.connect({
                            host,
                            username,
                            privateKey,
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error preparing SSH command: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            case 'add_credential': {
                const { name, host, username, privateKeyPath } = request.params.arguments as {
                    name: string;
                    host: string;
                    username: string;
                    privateKeyPath: string;
                };

                try {
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

                    await db.run(
                        'INSERT INTO credentials (name, host, username, privateKeyPath) VALUES (?, ?, ?, ?)',
                        [name, host, username, validatedKeyPath]
                    );

                    return {
                        content: [{
                            type: 'text',
                            text: `Credential ${name} added successfully`
                        }]
                    };
                } catch (error: unknown) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                        isError: true,
                    };
                }
            }

            case 'list_credentials': {
                const credentials = await db.all('SELECT * FROM credentials');
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(credentials, null, 2)
                    }]
                };
            }

            case 'remove_credential': {
                const { name } = request.params.arguments as { name: string };
                await db.run('DELETE FROM credentials WHERE name = ?', [name]);
                return {
                    content: [{
                        type: 'text',
                        text: `Credential ${name} removed successfully`
                    }]
                };
            }

            case 'rsync_copy': {
                const args = request.params.arguments as {
                    credentialName: string;
                    localPath: string;
                    remotePath: string;
                    direction: 'toRemote' | 'fromRemote';
                };
                console.error('DEBUG: Parsed rsync_copy args:', JSON.stringify(args)); // Log parsed args
                try {
                    const cred = await getCredentialByName(db, args.credentialName);
                    console.error('DEBUG: Fetched credential:', JSON.stringify(cred)); // Log fetched cred
                    if (!cred) {
                        throw new Error(`Credential '${args.credentialName}' not found.`);
                    }
                    // Explicitly check if privateKeyPath is a string before validating
                    if (typeof cred.privateKeyPath !== 'string') {
                        throw new Error(`Credential '${args.credentialName}' has invalid privateKeyPath: ${cred.privateKeyPath}`);
                    }
                    const validatedKeyPath = validatePrivateKeyPath(cred.privateKeyPath);
                    const sshOption = `-e "ssh -i \"${validatedKeyPath}\""`; // Ensure key path is quoted for exec
                    const remoteSpec = `\"${cred.username}@${cred.host}:${args.remotePath}\"`;

                    // Resolve localPath to an absolute path
                    const absoluteLocalPath = resolve(args.localPath);
                    console.log(`DEBUG: Resolved local path: ${absoluteLocalPath}`); // Log resolved path

                    // Ensure the local path is quoted for the exec command
                    const localSpec = `\"${absoluteLocalPath}\"`;

                    let source, destination;
                    if (args.direction === 'toRemote') {
                        source = localSpec;
                        destination = remoteSpec;
                    } else { // fromRemote
                        source = remoteSpec;
                        destination = localSpec;
                    }

                    const rsyncCommand = `rsync -avz ${sshOption} ${source} ${destination}`;
                    console.error('Executing rsync:', rsyncCommand); // Log command

                    return new Promise((resolve) => {
                        // Increased maxBuffer for rsync as well
                        exec(rsyncCommand, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
                            if (error) {
                                console.error(`rsync error: ${stderr}`);
                                console.error(`rsync stdout (partial): ${stdout}`);
                                resolve({
                                    content: [{ type: 'text', text: `rsync failed.\nError: ${error.message}\nstderr: ${stderr}\nstdout: ${stdout}` }],
                                    isError: true,
                                });
                            } else {
                                console.log(`rsync success: ${stdout}`);
                                resolve({ content: [{ type: 'text', text: `rsync completed successfully.\nDirection: ${args.direction}\nOutput:\n${stdout}` }] });
                            }
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error preparing rsync command: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            case 'scp_copy': {
                const args = request.params.arguments as {
                    credentialName: string;
                    localPath: string;
                    remotePath: string;
                    direction: 'toRemote' | 'fromRemote';
                };

                try {
                    // Load credentials from database
                    const cred = await getCredentialByName(db, args.credentialName);
                    if (!cred) {
                        throw new Error(`Credential '${args.credentialName}' not found.`);
                    }
                    const { host, username, privateKeyPath } = cred;
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

                    // Resolve localPath to absolute path
                    const absoluteLocalPath = resolve(args.localPath);

                    // Build SCP command
                    const remoteSpec = `${username}@${host}:${args.remotePath}`;
                    let scpCommand: string;

                    if (args.direction === 'toRemote') {
                        scpCommand = `scp -i "${validatedKeyPath}" -o BatchMode=yes -o ConnectTimeout=30 "${absoluteLocalPath}" "${remoteSpec}"`;
                    } else {
                        scpCommand = `scp -i "${validatedKeyPath}" -o BatchMode=yes -o ConnectTimeout=30 "${remoteSpec}" "${absoluteLocalPath}"`;
                    }

                    console.error('Executing SCP for credential:', args.credentialName);

                    return new Promise((resolve) => {
                        exec(scpCommand, { maxBuffer: MAX_BUFFER, timeout: MAX_TIMEOUT }, (error, stdout, stderr) => {
                            if (error) {
                                const exitCode = (error as NodeJS.ErrnoException & { code?: number }).code ?? null;
                                const errorType = classifyError(exitCode, stderr);
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: formatError({
                                            errorType,
                                            originalCommand: `scp ${args.direction}`,
                                            exitCode,
                                            stdout,
                                            stderr,
                                            suggestion: getSuggestion(errorType, exitCode),
                                        }),
                                    }],
                                    isError: true,
                                });
                            } else {
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: `SCP completed successfully.\nDirection: ${args.direction}\nLocal: ${absoluteLocalPath}\nRemote: ${args.remotePath}`,
                                    }],
                                });
                            }
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error preparing SCP command: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            // ===========================================
            // INTERACTIVE SESSION HANDLERS
            // ===========================================

            case 'ssh_session_start': {
                const args = request.params.arguments as {
                    credentialName: string;
                };
                const { credentialName } = args;

                try {
                    // Load credentials from database
                    const cred = await getCredentialByName(db, credentialName);
                    if (!cred) {
                        throw new Error(`Credential '${credentialName}' not found.`);
                    }
                    const { host, username, privateKeyPath } = cred;
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);
                    const privateKey = readFileSync(validatedKeyPath);
                    console.error('Starting SSH session for credential:', credentialName);

                    return new Promise((resolve) => {
                        const conn = new Client();

                        conn.on('ready', () => {
                            conn.shell({ term: 'xterm-256color' }, (err, channel) => {
                                if (err) {
                                    conn.end();
                                    resolve({
                                        content: [{ type: 'text', text: `Failed to open shell: ${err.message}` }],
                                        isError: true,
                                    });
                                    return;
                                }

                                const sessionId = randomUUID();
                                const session: SSHSession = {
                                    id: sessionId,
                                    host,
                                    username,
                                    conn,
                                    channel,
                                    outputBuffer: '',
                                    createdAt: new Date(),
                                    lastActivity: new Date(),
                                };

                                channel.on('data', (data: Buffer) => {
                                    session.outputBuffer += data.toString();
                                    // Cap buffer size
                                    if (session.outputBuffer.length > MAX_SESSION_BUFFER) {
                                        session.outputBuffer = session.outputBuffer.slice(-MAX_SESSION_BUFFER);
                                    }
                                    session.lastActivity = new Date();
                                });

                                channel.stderr.on('data', (data: Buffer) => {
                                    session.outputBuffer += data.toString();
                                    if (session.outputBuffer.length > MAX_SESSION_BUFFER) {
                                        session.outputBuffer = session.outputBuffer.slice(-MAX_SESSION_BUFFER);
                                    }
                                    session.lastActivity = new Date();
                                });

                                channel.on('close', () => {
                                    activeSessions.delete(sessionId);
                                });

                                activeSessions.set(sessionId, session);

                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: JSON.stringify({
                                            sessionId,
                                            host,
                                            username,
                                            message: 'Interactive session started. Use ssh_session_send to send commands, ssh_session_read to get output, ssh_session_end to close.',
                                        }, null, 2),
                                    }],
                                });
                            });
                        });

                        conn.on('error', (err) => {
                            const errorType = err.message.toLowerCase().includes('authentication') ? 'AUTH_FAILURE' : 'SSH_CONNECTION';
                            resolve({
                                content: [{
                                    type: 'text',
                                    text: formatError({
                                        errorType,
                                        originalCommand: 'ssh_session_start',
                                        stdout: '',
                                        stderr: err.message,
                                        suggestion: getSuggestion(errorType),
                                    }),
                                }],
                                isError: true,
                            });
                        });

                        conn.connect({
                            host,
                            username,
                            privateKey,
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            case 'ssh_session_send': {
                const args = request.params.arguments as {
                    sessionId: string;
                    input: string;
                };
                const { sessionId, input } = args;

                const session = activeSessions.get(sessionId);
                if (!session) {
                    return {
                        content: [{
                            type: 'text',
                            text: formatError({
                                errorType: 'SESSION_NOT_FOUND',
                                originalCommand: 'ssh_session_send',
                                stdout: '',
                                stderr: `Session ${sessionId} not found`,
                                suggestion: getSuggestion('SESSION_NOT_FOUND'),
                            }),
                        }],
                        isError: true,
                    };
                }

                session.channel.write(input);
                session.lastActivity = new Date();

                return {
                    content: [{
                        type: 'text',
                        text: `Sent ${input.length} bytes to session ${sessionId}`,
                    }],
                };
            }

            case 'ssh_session_read': {
                const args = request.params.arguments as {
                    sessionId: string;
                    clear?: boolean;
                };
                const { sessionId, clear = true } = args;

                const session = activeSessions.get(sessionId);
                if (!session) {
                    return {
                        content: [{
                            type: 'text',
                            text: formatError({
                                errorType: 'SESSION_NOT_FOUND',
                                originalCommand: 'ssh_session_read',
                                stdout: '',
                                stderr: `Session ${sessionId} not found`,
                                suggestion: getSuggestion('SESSION_NOT_FOUND'),
                            }),
                        }],
                        isError: true,
                    };
                }

                const output = session.outputBuffer;
                if (clear) {
                    session.outputBuffer = '';
                }

                return {
                    content: [{
                        type: 'text',
                        text: output || '[No new output]',
                    }],
                };
            }

            case 'ssh_session_end': {
                const args = request.params.arguments as {
                    sessionId: string;
                };
                const { sessionId } = args;

                const session = activeSessions.get(sessionId);
                if (!session) {
                    return {
                        content: [{
                            type: 'text',
                            text: 'Session not found or already closed.',
                        }],
                    };
                }

                try {
                    session.channel.close();
                    session.conn.end();
                } catch (e) {
                    // Ignore cleanup errors
                }
                activeSessions.delete(sessionId);

                return {
                    content: [{
                        type: 'text',
                        text: `Session ${sessionId} closed successfully.`,
                    }],
                };
            }

            case 'ssh_session_list': {
                const sessions = Array.from(activeSessions.values()).map(s => ({
                    sessionId: s.id,
                    host: s.host,
                    username: s.username,
                    createdAt: s.createdAt.toISOString(),
                    lastActivity: s.lastActivity.toISOString(),
                    bufferSize: s.outputBuffer.length,
                }));

                return {
                    content: [{
                        type: 'text',
                        text: sessions.length > 0
                            ? JSON.stringify(sessions, null, 2)
                            : 'No active sessions.',
                    }],
                };
            }

            // ===========================================
            // PORT FORWARDING HANDLERS
            // ===========================================

            case 'ssh_tunnel_start': {
                const args = request.params.arguments as {
                    credentialName: string;
                    type?: TunnelType;
                    localPort: number;
                    remoteHost: string;
                    remotePort: number;
                };
                const {
                    credentialName,
                    type = 'local',
                    localPort, remoteHost, remotePort
                } = args;

                try {
                    // Load credentials from database
                    const cred = await getCredentialByName(db, credentialName);
                    if (!cred) {
                        throw new Error(`Credential '${credentialName}' not found.`);
                    }
                    const { host, username, privateKeyPath } = cred;
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);
                    const privateKey = readFileSync(validatedKeyPath);
                    console.error('Starting SSH tunnel for credential:', credentialName);

                    return new Promise((resolve) => {
                        const conn = new Client();

                        conn.on('ready', () => {
                            if (type === 'local') {
                                // Local forwarding: -L localPort:remoteHost:remotePort
                                const server = createServer((socket: Socket) => {
                                    conn.forwardOut(
                                        '127.0.0.1',
                                        localPort,
                                        remoteHost,
                                        remotePort,
                                        (err, stream) => {
                                            if (err) {
                                                socket.end();
                                                return;
                                            }
                                            socket.pipe(stream).pipe(socket);
                                        }
                                    );
                                });

                                server.listen(localPort, '127.0.0.1', () => {
                                    const tunnelId = randomUUID();
                                    const tunnel: SSHTunnel = {
                                        id: tunnelId,
                                        type: 'local',
                                        host,
                                        username,
                                        localPort,
                                        remoteHost,
                                        remotePort,
                                        conn,
                                        server,
                                        createdAt: new Date(),
                                    };

                                    activeTunnels.set(tunnelId, tunnel);

                                    resolve({
                                        content: [{
                                            type: 'text',
                                            text: JSON.stringify({
                                                tunnelId,
                                                type: 'local',
                                                binding: `127.0.0.1:${localPort} -> ${remoteHost}:${remotePort}`,
                                                message: `Local tunnel started. Connect to localhost:${localPort} to access ${remoteHost}:${remotePort} via ${host}`,
                                            }, null, 2),
                                        }],
                                    });
                                });

                                server.on('error', (err: NodeJS.ErrnoException) => {
                                    conn.end();
                                    const message = err.code === 'EADDRINUSE'
                                        ? `Port ${localPort} is already in use. Choose a different port.`
                                        : `Failed to bind local port ${localPort}: ${err.message}`;
                                    resolve({
                                        content: [{ type: 'text', text: message }],
                                        isError: true,
                                    });
                                });

                            } else {
                                // Remote forwarding: -R remotePort:localHost:localPort
                                conn.forwardIn('0.0.0.0', remotePort, (err) => {
                                    if (err) {
                                        conn.end();
                                        resolve({
                                            content: [{
                                                type: 'text',
                                                text: `Failed to set up remote forwarding: ${err.message}`,
                                            }],
                                            isError: true,
                                        });
                                        return;
                                    }

                                    const tunnelId = randomUUID();
                                    const tunnel: SSHTunnel = {
                                        id: tunnelId,
                                        type: 'remote',
                                        host,
                                        username,
                                        localPort,
                                        remoteHost,
                                        remotePort,
                                        conn,
                                        createdAt: new Date(),
                                    };

                                    activeTunnels.set(tunnelId, tunnel);

                                    resolve({
                                        content: [{
                                            type: 'text',
                                            text: JSON.stringify({
                                                tunnelId,
                                                type: 'remote',
                                                binding: `${host}:${remotePort} -> 127.0.0.1:${localPort}`,
                                                message: `Remote tunnel started. Connections to ${host}:${remotePort} will forward to localhost:${localPort}`,
                                            }, null, 2),
                                        }],
                                    });
                                });

                                conn.on('tcp connection', (info, accept, reject) => {
                                    const stream = accept();
                                    const socket = new Socket();
                                    socket.connect(localPort, '127.0.0.1', () => {
                                        stream.pipe(socket).pipe(stream);
                                    });
                                    socket.on('error', () => {
                                        stream.close();
                                    });
                                });
                            }
                        });

                        conn.on('error', (err) => {
                            const errorType = err.message.toLowerCase().includes('authentication') ? 'AUTH_FAILURE' : 'SSH_CONNECTION';
                            resolve({
                                content: [{
                                    type: 'text',
                                    text: formatError({
                                        errorType,
                                        originalCommand: 'ssh_tunnel_start',
                                        stdout: '',
                                        stderr: err.message,
                                        suggestion: getSuggestion(errorType),
                                    }),
                                }],
                                isError: true,
                            });
                        });

                        conn.connect({
                            host,
                            username,
                            privateKey,
                        });
                    });
                } catch (error: unknown) {
                    return {
                        content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
                        isError: true,
                    };
                }
            }

            case 'ssh_tunnel_list': {
                const tunnels = Array.from(activeTunnels.values()).map(t => ({
                    tunnelId: t.id,
                    type: t.type,
                    host: t.host,
                    localPort: t.localPort,
                    remoteHost: t.remoteHost,
                    remotePort: t.remotePort,
                    createdAt: t.createdAt.toISOString(),
                    binding: t.type === 'local'
                        ? `127.0.0.1:${t.localPort} -> ${t.remoteHost}:${t.remotePort}`
                        : `${t.host}:${t.remotePort} -> 127.0.0.1:${t.localPort}`,
                }));

                return {
                    content: [{
                        type: 'text',
                        text: tunnels.length > 0
                            ? JSON.stringify(tunnels, null, 2)
                            : 'No active tunnels.',
                    }],
                };
            }

            case 'ssh_tunnel_stop': {
                const args = request.params.arguments as {
                    tunnelId: string;
                };
                const { tunnelId } = args;

                const tunnel = activeTunnels.get(tunnelId);
                if (!tunnel) {
                    return {
                        content: [{
                            type: 'text',
                            text: formatError({
                                errorType: 'TUNNEL_NOT_FOUND',
                                originalCommand: 'ssh_tunnel_stop',
                                stdout: '',
                                stderr: `Tunnel ${tunnelId} not found`,
                                suggestion: getSuggestion('TUNNEL_NOT_FOUND'),
                            }),
                        }],
                        isError: true,
                    };
                }

                try {
                    if (tunnel.server) {
                        tunnel.server.close();
                    }
                    tunnel.conn.end();
                } catch (e) {
                    // Ignore cleanup errors
                }
                activeTunnels.delete(tunnelId);

                return {
                    content: [{
                        type: 'text',
                        text: `Tunnel ${tunnelId} closed successfully.`,
                    }],
                };
            }

            default:
                throw new Error('Unknown tool');
        }
    });
}

setupToolHandlers();

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('SSH MCP server running on stdio');
}

run().catch(console.error);
