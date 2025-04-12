#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';
import { existsSync } from 'fs';
import { resolve, join } from 'path';
import os from 'os'; // Import os module
import fs from 'fs/promises'; // Import fs promises

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
                description: 'Execute command over SSH using private key file path',
                inputSchema: {
                    type: 'object',
                    properties: {
                        host: { type: 'string' },
                        command: { type: 'string' },
                        username: { type: 'string' },
                        privateKeyPath: { type: 'string' },
                    },
                    required: ['host', 'command', 'username', 'privateKeyPath'],
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
                description: 'Copy files/directories between local and remote server via rsync',
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
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const db = await initDb();
        console.error('DEBUG: CallToolRequest handler entered for tool:', request.params.name);
        console.error('DEBUG: Raw arguments:', JSON.stringify(request.params.arguments)); // Log raw args

        switch (request.params.name) {
            case 'ssh_exec': {
                const args = request.params.arguments as {
                    host: string;
                    command: string;
                    username: string;
                    privateKeyPath: string;
                };
                const { host, command, username, privateKeyPath } = args;

                try {
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);
                    // Escape single quotes in the command for bash -ic
                    const escapedCommand = command.replace(/'/g, "'\\''");
                    // Wrap the command in bash -ic '...' to load shell environment
                    const sshCommand = `ssh -i "${validatedKeyPath}" ${username}@${host} "bash -ic '${escapedCommand}'"`;
                    console.error('Executing SSH command:', sshCommand); // Log the modified command

                    return new Promise((resolve) => {
                        // Increased maxBuffer size for potentially larger output from env loading
                        exec(sshCommand, { maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
                            if (error) {
                                // Log both stdout and stderr on error for better debugging
                                console.error(`SSH error: ${error.message}`);
                                console.error(`SSH stderr: ${stderr}`);
                                console.error(`SSH stdout (partial): ${stdout}`);
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: `SSH command failed.\nError: ${error.message}\nstderr: ${stderr}\nstdout: ${stdout}`,
                                    }],
                                    isError: true,
                                });
                            } else {
                                console.log(`SSH success: ${stdout}`);
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: stdout,
                                    }],
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
