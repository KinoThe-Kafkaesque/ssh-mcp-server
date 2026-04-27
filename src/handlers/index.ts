import type { Database } from 'sqlite';
import {
    handleRsyncCopy,
    handleScpCopy,
    handleSshExec,
    handleSshExecRaw,
} from './commands.js';
import {
    handleAddCredential,
    handleListCredentials,
    handleRemoveCredential,
} from './credentials.js';
import {
    handleSessionEnd,
    handleSessionList,
    handleSessionRead,
    handleSessionSend,
    handleSessionStart,
} from './sessions.js';
import {
    handleTunnelList,
    handleTunnelStart,
    handleTunnelStop,
} from './tunnels.js';

export async function handleToolCall(toolName: string, args: unknown, db: Database): Promise<any> {
    switch (toolName) {
        case 'ssh_exec':
            return handleSshExec(args, db);
        case 'ssh_exec_raw':
            return handleSshExecRaw(args, db);
        case 'add_credential':
            return handleAddCredential(args, db);
        case 'list_credentials':
            return handleListCredentials(db);
        case 'remove_credential':
            return handleRemoveCredential(args, db);
        case 'rsync_copy':
            return handleRsyncCopy(args, db);
        case 'scp_copy':
            return handleScpCopy(args, db);
        case 'ssh_session_start':
            return handleSessionStart(args, db);
        case 'ssh_session_send':
            return handleSessionSend(args);
        case 'ssh_session_read':
            return handleSessionRead(args);
        case 'ssh_session_end':
            return handleSessionEnd(args);
        case 'ssh_session_list':
            return handleSessionList();
        case 'ssh_tunnel_start':
            return handleTunnelStart(args, db);
        case 'ssh_tunnel_list':
            return handleTunnelList();
        case 'ssh_tunnel_stop':
            return handleTunnelStop(args);
        default:
            throw new Error('Unknown tool');
    }
}
