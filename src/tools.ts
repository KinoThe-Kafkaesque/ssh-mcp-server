export const tools = [
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
        description: 'Execute command over SSH with array arguments that are safely quoted for the remote shell',
        inputSchema: {
            type: 'object',
            properties: {
                credentialName: { type: 'string', description: 'Name of stored credential to use' },
                command: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Command as argv-style array, e.g., ["grep", "-E", "pattern|other", "file.txt"]',
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
        description: 'Copy a single file between local and remote server via SFTP (simpler than rsync for single files)',
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
];
