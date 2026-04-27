import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { createServer, Socket } from 'net';
import type { Database } from 'sqlite';
import { Client } from 'ssh2';
import { getCredentialByName, validatePrivateKeyPath } from '../db.js';
import { formatError, getSuggestion } from '../errors.js';
import { activeTunnels } from '../state.js';
import type { SSHTunnel, TunnelType } from '../types.js';

export async function handleTunnelStart(args: unknown, db: Database) {
    const tunnelArgs = args as {
        credentialName: string;
        type?: TunnelType;
        localPort: number;
        remoteHost: string;
        remotePort: number;
    };
    const {
        credentialName,
        type = 'local',
        localPort,
        remoteHost,
        remotePort,
    } = tunnelArgs;

    try {
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
                            },
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

export function handleTunnelList() {
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

export function handleTunnelStop(args: unknown) {
    const { tunnelId } = args as {
        tunnelId: string;
    };

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
        // Ignore cleanup errors.
    }
    activeTunnels.delete(tunnelId);

    return {
        content: [{
            type: 'text',
            text: `Tunnel ${tunnelId} closed successfully.`,
        }],
    };
}
