import type { SSHError, SSHErrorType } from './types.js';

export function classifyError(exitCode: number | null, stderr: string): SSHErrorType {
    const stderrLower = stderr.toLowerCase();

    if (stderrLower.includes('connection refused') ||
        stderrLower.includes('no route to host') ||
        stderrLower.includes('network is unreachable') ||
        stderrLower.includes('connection timed out') ||
        stderrLower.includes('could not resolve hostname')) {
        return 'SSH_CONNECTION';
    }

    if (stderrLower.includes('permission denied') ||
        stderrLower.includes('authentication failed') ||
        stderrLower.includes('no more authentication methods') ||
        stderrLower.includes('host key verification failed') ||
        stderrLower.includes('publickey')) {
        return 'AUTH_FAILURE';
    }

    if (stderrLower.includes('syntax error') ||
        stderrLower.includes('unexpected') ||
        stderrLower.includes('unterminated') ||
        stderrLower.includes('bad substitution') ||
        stderrLower.includes('command not found')) {
        return 'SHELL_PARSE_ERROR';
    }

    if (exitCode === null || stderrLower.includes('timed out')) {
        return 'TIMEOUT';
    }

    return 'COMMAND_FAILED';
}

export function getSuggestion(errorType: SSHErrorType, exitCode?: number | null): string {
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

export function formatError(error: SSHError): string {
    const safeError = {
        ...error,
        executedCommand: error.executedCommand ? '[hidden]' : undefined,
    };
    return JSON.stringify(safeError, null, 2);
}
