# SSH MCP Server - Claude Code Guide

## Project Overview

SSH MCP Server is a Model Context Protocol server that provides SSH-related tools for remote server management. It enables secure command execution, file transfers, interactive sessions, and port forwarding through stored credentials.

## Architecture

```
src/index.ts          # Main server implementation (all tools)
~/ssh.db              # SQLite database for credentials (user home dir)
```

## Available Tools

### Credential Management
- `add_credential` - Store SSH credentials (name, host, username, keyPath)
- `list_credentials` - List all stored credentials
- `remove_credential` - Delete a stored credential

### Command Execution
- `ssh_exec` - Execute command via SSH (uses shell, supports env)
- `ssh_exec_raw` - Execute command as array (no shell escaping issues)

### File Transfer
- `scp_copy` - Copy single files (simpler, faster)
- `rsync_copy` - Sync directories (incremental, better for large transfers)

### Interactive Sessions
- `ssh_session_start` - Start PTY session (for vim, htop, etc.)
- `ssh_session_send` - Send input to session
- `ssh_session_read` - Read session output
- `ssh_session_list` - List active sessions
- `ssh_session_end` - Close session

### Port Forwarding
- `ssh_tunnel_start` - Create SSH tunnel (local or remote)
- `ssh_tunnel_list` - List active tunnels
- `ssh_tunnel_stop` - Close tunnel

## Key Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `ssh2` - Native SSH2 client for sessions, tunnels, and raw exec
- `sqlite3` / `sqlite` - Credential storage

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm start            # Run server
```

## Testing

See [TEST_SPEC.md](./TEST_SPEC.md) for comprehensive test cases covering:
- All tool functionality
- Error handling and classification
- Security validation
- Integration test sequence

## Security Notes

- Credentials loaded from DB, not passed through tool arguments
- Sensitive data (host, key path) hidden in error messages
- Only credential names logged, not connection details
- SSH keys validated for existence before use

## Error Types

| Type | Meaning |
|------|---------|
| `SSH_CONNECTION` | Network/host unreachable |
| `AUTH_FAILURE` | Key/permission issues |
| `SHELL_PARSE_ERROR` | Command syntax errors |
| `COMMAND_FAILED` | Non-zero exit code |
| `TIMEOUT` | Command exceeded timeout |
| `SESSION_NOT_FOUND` | Invalid session ID |
| `TUNNEL_NOT_FOUND` | Invalid tunnel ID |

## Common Patterns

### Execute command with special characters
```typescript
// Use ssh_exec_raw for grep patterns, quotes, etc.
ssh_exec_raw({
  credentialName: "myserver",
  command: ["grep", "-E", "error|warning", "/var/log/syslog"]
})
```

### File transfer workflow
```typescript
// Single file: use scp_copy
scp_copy({ credentialName: "myserver", localPath: "/tmp/file.txt", remotePath: "/tmp/file.txt", direction: "toRemote" })

// Directory: use rsync_copy
rsync_copy({ credentialName: "myserver", localPath: "/local/dir/", remotePath: "/remote/dir/", direction: "toRemote" })
```

### Interactive session workflow
```typescript
// 1. Start session
const { sessionId } = ssh_session_start({ credentialName: "myserver" })

// 2. Send commands
ssh_session_send({ sessionId, input: "htop\n" })

// 3. Read output
ssh_session_read({ sessionId })

// 4. Close when done
ssh_session_end({ sessionId })
```
