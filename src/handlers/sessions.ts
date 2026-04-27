import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import type { Database } from 'sqlite';
import { Client } from 'ssh2';
import { getCredentialByName, validatePrivateKeyPath } from '../db.js';
import { formatError, getSuggestion } from '../errors.js';
import { activeSessions, MAX_SESSION_BUFFER } from '../state.js';
import type { SSHSession } from '../types.js';

export async function handleSessionStart(args: unknown, db: Database) {
    const { credentialName } = args as {
        credentialName: string;
    };

    try {
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

export function handleSessionSend(args: unknown) {
    const { sessionId, input } = args as {
        sessionId: string;
        input: string;
    };

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

export function handleSessionRead(args: unknown) {
    const { sessionId, clear = true } = args as {
        sessionId: string;
        clear?: boolean;
    };

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

export function handleSessionEnd(args: unknown) {
    const { sessionId } = args as {
        sessionId: string;
    };

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
        // Ignore cleanup errors.
    }
    activeSessions.delete(sessionId);

    return {
        content: [{
            type: 'text',
            text: `Session ${sessionId} closed successfully.`,
        }],
    };
}

export function handleSessionList() {
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
