import type { Server as NetServer } from 'net';
import type { Client, ClientChannel } from 'ssh2';

export type SSHErrorType =
    | 'SHELL_PARSE_ERROR'
    | 'SSH_CONNECTION'
    | 'AUTH_FAILURE'
    | 'COMMAND_FAILED'
    | 'TIMEOUT'
    | 'BUFFER_EXCEEDED'
    | 'SESSION_NOT_FOUND'
    | 'TUNNEL_NOT_FOUND';

export interface SSHError {
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

export interface Credential {
    id?: number;
    name: string;
    host: string;
    username: string;
    privateKeyPath: string;
}

export interface SSHSession {
    id: string;
    host: string;
    username: string;
    conn: Client;
    channel: ClientChannel;
    outputBuffer: string;
    createdAt: Date;
    lastActivity: Date;
}

export type TunnelType = 'local' | 'remote';

export interface SSHTunnel {
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
