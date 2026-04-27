import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { Database } from 'sqlite';
import { Client, type ConnectConfig } from 'ssh2';
import { DEFAULT_TIMEOUT, DISPLAY_LIMIT, MAX_BUFFER, MAX_TIMEOUT } from '../constants.js';
import { getCredentialByName, validatePrivateKeyPath } from '../db.js';
import { classifyError, formatError, getSuggestion } from '../errors.js';
import type { Credential, SSHError } from '../types.js';

type ToolResult = {
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
};

type TransferDirection = 'toRemote' | 'fromRemote';

function requireString(value: unknown, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} must be a non-empty string`);
    }
    if (value.includes('\0')) {
        throw new Error(`${name} must not contain NUL bytes`);
    }
    return value;
}

function requireDirection(value: unknown): TransferDirection {
    if (value !== 'toRemote' && value !== 'fromRemote') {
        throw new Error('direction must be "toRemote" or "fromRemote"');
    }
    return value;
}

function normalizeTimeout(value: unknown): number {
    if (value === undefined) {
        return DEFAULT_TIMEOUT;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error('timeout must be a positive number');
    }
    return Math.min(value, MAX_TIMEOUT);
}

function validateCredentialEndpoint(cred: Credential) {
    requireString(cred.host, 'credential host');
    requireString(cred.username, 'credential username');

    if (!/^[A-Za-z0-9_.:-]+$/.test(cred.host)) {
        throw new Error(`Credential '${cred.name}' has an invalid host`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(cred.username)) {
        throw new Error(`Credential '${cred.name}' has an invalid username`);
    }
}

function validateRemotePath(path: unknown, name = 'remotePath') {
    const remotePath = requireString(path, name);
    if (/[\r\n]/.test(remotePath)) {
        throw new Error(`${name} must not contain newlines`);
    }
    return remotePath;
}

function validateRsyncPath(path: unknown, name: string) {
    const rsyncPath = validateRemotePath(path, name);
    if (/[`$"';\\|&<>]/.test(rsyncPath)) {
        throw new Error(`${name} contains shell metacharacters that are not supported by rsync_copy`);
    }
    return rsyncPath;
}

function validateRsyncTransportPath(path: string) {
    if (!/^[A-Za-z0-9_./~+@%:=-]+$/.test(path)) {
        throw new Error('privateKeyPath contains characters that are not supported by rsync_copy');
    }
}

function shellQuote(value: string): string {
    return "'" + value.replace(/'/g, "'\\''") + "'";
}

function displayOutput(stdout: string) {
    let output = stdout;
    let truncated = false;
    const totalBytes = stdout.length;

    if (stdout.length > DISPLAY_LIMIT) {
        truncated = true;
        const head = stdout.substring(0, DISPLAY_LIMIT / 2);
        const tail = stdout.substring(stdout.length - DISPLAY_LIMIT / 2);
        output = `${head}\n\n... [${stdout.length - DISPLAY_LIMIT} bytes truncated] ...\n\n${tail}`;
    }

    return { output, truncated, totalBytes };
}

function appendCapped(current: string, chunk: Buffer) {
    if (current.length >= MAX_BUFFER) {
        return { value: current, truncated: true };
    }
    const next = current + chunk.toString();
    if (next.length > MAX_BUFFER) {
        return { value: next.slice(0, MAX_BUFFER), truncated: true };
    }
    return { value: next, truncated: false };
}

async function loadCredential(db: Database, credentialName: string) {
    const cred = await getCredentialByName(db, credentialName);
    if (!cred) {
        throw new Error(`Credential '${credentialName}' not found.`);
    }
    validateCredentialEndpoint(cred);
    const validatedKeyPath = validatePrivateKeyPath(cred.privateKeyPath);
    const privateKey = readFileSync(validatedKeyPath);
    const config: ConnectConfig = {
        host: cred.host,
        username: cred.username,
        privateKey,
        readyTimeout: 30000,
    };
    return { cred, validatedKeyPath, config };
}

function runSshCommand(config: ConnectConfig, originalCommand: string | string[], remoteCommand: string, timeout: number): Promise<ToolResult> {
    return new Promise((resolve) => {
        const conn = new Client();
        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let settled = false;

        const finish = (result: ToolResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            conn.end();
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
            const { output } = displayOutput(stdout);
            finish({
                content: [{
                    type: 'text',
                    text: formatError({
                        errorType: 'TIMEOUT',
                        originalCommand,
                        exitCode: null,
                        stdout: output,
                        stderr,
                        suggestion: getSuggestion('TIMEOUT'),
                        truncated: stdoutTruncated || stderrTruncated || stdout.length > DISPLAY_LIMIT,
                    }),
                }],
                isError: true,
            });
        }, timeout);

        conn.on('ready', () => {
            conn.exec(remoteCommand, (err, stream) => {
                if (err) {
                    finish({
                        content: [{ type: 'text', text: `Failed to execute command: ${err.message}` }],
                        isError: true,
                    });
                    return;
                }

                stream.on('data', (data: Buffer) => {
                    const next = appendCapped(stdout, data);
                    stdout = next.value;
                    stdoutTruncated = stdoutTruncated || next.truncated;
                });

                stream.stderr.on('data', (data: Buffer) => {
                    const next = appendCapped(stderr, data);
                    stderr = next.value;
                    stderrTruncated = stderrTruncated || next.truncated;
                });

                stream.on('close', (code: number | null) => {
                    const { output, truncated, totalBytes } = displayOutput(stdout);
                    if (code !== 0) {
                        const errorType = classifyError(code, stderr);
                        const sshError: SSHError = {
                            errorType,
                            originalCommand,
                            executedCommand: remoteCommand,
                            exitCode: code,
                            stdout: output,
                            stderr,
                            suggestion: getSuggestion(errorType, code),
                            truncated: truncated || stdoutTruncated || stderrTruncated,
                            totalBytes,
                        };

                        finish({
                            content: [{ type: 'text', text: formatError(sshError) }],
                            isError: true,
                        });
                    } else {
                        const text = truncated
                            ? `[Output: ${totalBytes} bytes, showing first and last ${DISPLAY_LIMIT / 2} bytes]\n\n${output}`
                            : stdout;
                        finish({
                            content: [{ type: 'text', text }],
                        });
                    }
                });
            });
        });

        conn.on('error', (err) => {
            const errorType = err.message.toLowerCase().includes('authentication') ? 'AUTH_FAILURE' : 'SSH_CONNECTION';
            finish({
                content: [{
                    type: 'text',
                    text: formatError({
                        errorType,
                        originalCommand,
                        exitCode: null,
                        stdout: '',
                        stderr: err.message,
                        suggestion: getSuggestion(errorType),
                    }),
                }],
                isError: true,
            });
        });

        conn.connect(config);
    });
}

function runProcess(command: string, args: string[], timeout: number): Promise<ToolResult> {
    return new Promise((resolve) => {
        const child = spawn(command, args, {
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let stdoutTruncated = false;
        let stderrTruncated = false;
        let settled = false;

        const finish = (result: ToolResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
            child.kill('SIGTERM');
            finish({
                content: [{
                    type: 'text',
                    text: formatError({
                        errorType: 'TIMEOUT',
                        originalCommand: `${command} ${args[0] ?? ''}`.trim(),
                        exitCode: null,
                        stdout,
                        stderr,
                        suggestion: getSuggestion('TIMEOUT'),
                        truncated: stdoutTruncated || stderrTruncated,
                    }),
                }],
                isError: true,
            });
        }, timeout);

        child.stdout.on('data', (data: Buffer) => {
            const next = appendCapped(stdout, data);
            stdout = next.value;
            stdoutTruncated = stdoutTruncated || next.truncated;
        });

        child.stderr.on('data', (data: Buffer) => {
            const next = appendCapped(stderr, data);
            stderr = next.value;
            stderrTruncated = stderrTruncated || next.truncated;
        });

        child.on('error', (error) => {
            finish({
                content: [{ type: 'text', text: `${command} failed to start: ${error.message}` }],
                isError: true,
            });
        });

        child.on('close', (code) => {
            if (settled) {
                return;
            }
            if (code !== 0) {
                const errorType = classifyError(code, stderr);
                finish({
                    content: [{
                        type: 'text',
                        text: formatError({
                            errorType,
                            originalCommand: command,
                            exitCode: code,
                            stdout,
                            stderr,
                            suggestion: getSuggestion(errorType, code),
                            truncated: stdoutTruncated || stderrTruncated,
                        }),
                    }],
                    isError: true,
                });
                return;
            }

            finish({
                content: [{ type: 'text', text: stdout }],
            });
        });
    });
}

function runSftpCopy(config: ConnectConfig, localPath: string, remotePath: string, direction: TransferDirection): Promise<ToolResult> {
    return new Promise((resolve) => {
        const conn = new Client();
        let settled = false;

        const finish = (result: ToolResult) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timeoutId);
            conn.end();
            resolve(result);
        };

        const timeoutId = setTimeout(() => {
            finish({
                content: [{
                    type: 'text',
                    text: formatError({
                        errorType: 'TIMEOUT',
                        originalCommand: `sftp ${direction}`,
                        exitCode: null,
                        stdout: '',
                        stderr: 'SFTP transfer timed out',
                        suggestion: getSuggestion('TIMEOUT'),
                    }),
                }],
                isError: true,
            });
        }, MAX_TIMEOUT);

        conn.on('ready', () => {
            conn.sftp((err, sftp) => {
                if (err) {
                    finish({
                        content: [{ type: 'text', text: `Failed to start SFTP: ${err.message}` }],
                        isError: true,
                    });
                    return;
                }

                const callback = (transferError: Error | null | undefined) => {
                    if (transferError) {
                        finish({
                            content: [{
                                type: 'text',
                                text: formatError({
                                    errorType: 'COMMAND_FAILED',
                                    originalCommand: `sftp ${direction}`,
                                    exitCode: null,
                                    stdout: '',
                                    stderr: transferError.message,
                                    suggestion: 'Verify the source path exists and the destination is writable.',
                                }),
                            }],
                            isError: true,
                        });
                        return;
                    }

                    finish({
                        content: [{
                            type: 'text',
                            text: `SFTP transfer completed successfully.\nDirection: ${direction}\nLocal: ${localPath}\nRemote: ${remotePath}`,
                        }],
                    });
                };

                if (direction === 'toRemote') {
                    sftp.fastPut(localPath, remotePath, callback);
                } else {
                    sftp.fastGet(remotePath, localPath, callback);
                }
            });
        });

        conn.on('error', (err) => {
            const errorType = err.message.toLowerCase().includes('authentication') ? 'AUTH_FAILURE' : 'SSH_CONNECTION';
            finish({
                content: [{
                    type: 'text',
                    text: formatError({
                        errorType,
                        originalCommand: `sftp ${direction}`,
                        stdout: '',
                        stderr: err.message,
                        suggestion: getSuggestion(errorType),
                    }),
                }],
                isError: true,
            });
        });

        conn.connect(config);
    });
}

export async function handleSshExec(args: unknown, db: Database) {
    const execArgs = args as {
        credentialName: unknown;
        command: unknown;
        timeout?: unknown;
    };

    try {
        const credentialName = requireString(execArgs.credentialName, 'credentialName');
        const command = requireString(execArgs.command, 'command');
        const timeout = normalizeTimeout(execArgs.timeout);
        const { config } = await loadCredential(db, credentialName);

        console.error('Executing SSH command for credential:', credentialName);
        return runSshCommand(config, command, `bash -ic ${shellQuote(command)}`, timeout);
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `Error preparing SSH command: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
}

export async function handleSshExecRaw(args: unknown, db: Database) {
    const execArgs = args as {
        credentialName: unknown;
        command: unknown;
        timeout?: unknown;
    };

    try {
        const credentialName = requireString(execArgs.credentialName, 'credentialName');
        if (!Array.isArray(execArgs.command) || execArgs.command.length === 0) {
            throw new Error('command must be a non-empty string array');
        }
        const command = execArgs.command.map((part, index) => requireString(part, `command[${index}]`));
        const timeout = normalizeTimeout(execArgs.timeout);
        const { config } = await loadCredential(db, credentialName);

        console.error('Executing SSH argv-style command for credential:', credentialName);
        return runSshCommand(config, command, command.map(shellQuote).join(' '), timeout);
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `Error preparing SSH command: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
}

export async function handleRsyncCopy(args: unknown, db: Database) {
    const copyArgs = args as {
        credentialName: unknown;
        localPath: unknown;
        remotePath: unknown;
        direction: unknown;
    };

    try {
        const credentialName = requireString(copyArgs.credentialName, 'credentialName');
        const localPath = requireString(copyArgs.localPath, 'localPath');
        const remotePath = validateRsyncPath(copyArgs.remotePath, 'remotePath');
        const direction = requireDirection(copyArgs.direction);
        const { cred, validatedKeyPath } = await loadCredential(db, credentialName);

        validateRsyncTransportPath(validatedKeyPath);

        const absoluteLocalPath = resolve(localPath);
        const remoteSpec = `${cred.username}@${cred.host}:${remotePath}`;
        const sshTransport = `ssh -i ${validatedKeyPath} -o BatchMode=yes -o ConnectTimeout=30`;
        const source = direction === 'toRemote' ? absoluteLocalPath : remoteSpec;
        const destination = direction === 'toRemote' ? remoteSpec : absoluteLocalPath;
        const rsyncArgs = ['-avz', '--protect-args', '-e', sshTransport, source, destination];

        console.error('Executing rsync for credential:', credentialName);
        const result = await runProcess('rsync', rsyncArgs, MAX_TIMEOUT);
        if (result.isError) {
            return result;
        }

        return {
            content: [{
                type: 'text',
                text: `rsync completed successfully.\nDirection: ${direction}\nOutput:\n${result.content[0]?.text ?? ''}`,
            }],
        };
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `Error preparing rsync command: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
}

export async function handleScpCopy(args: unknown, db: Database) {
    const copyArgs = args as {
        credentialName: unknown;
        localPath: unknown;
        remotePath: unknown;
        direction: unknown;
    };

    try {
        const credentialName = requireString(copyArgs.credentialName, 'credentialName');
        const localPath = resolve(requireString(copyArgs.localPath, 'localPath'));
        const remotePath = validateRemotePath(copyArgs.remotePath);
        const direction = requireDirection(copyArgs.direction);
        const { config } = await loadCredential(db, credentialName);

        console.error('Executing SFTP transfer for credential:', credentialName);
        return runSftpCopy(config, localPath, remotePath, direction);
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `Error preparing SFTP transfer: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
        };
    }
}
