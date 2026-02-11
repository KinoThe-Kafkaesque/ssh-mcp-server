# SSH MCP Server - Test Specification

## Overview

This document specifies test cases for all SSH MCP Server tools. Tests should be run against a configured credential (e.g., `vps1`).

---

## Prerequisites

- A valid SSH credential stored via `add_credential`
- Remote server accessible with SSH key authentication
- Local temp directory writable (`/tmp`)

---

## 1. Credential Management Tools

### 1.1 `add_credential`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Add valid credential | `{ name: "test-server", host: "192.168.1.1", username: "user", privateKeyPath: "/path/to/key" }` | Success message |
| Add duplicate name | Same name as existing | Error: unique constraint |
| Invalid key path | Non-existent path | Error: key file not found |

### 1.2 `list_credentials`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| List all credentials | `{}` | JSON array of credentials |
| Empty database | `{}` | Empty array `[]` |

### 1.3 `remove_credential`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Remove existing | `{ name: "test-server" }` | Success message |
| Remove non-existent | `{ name: "unknown" }` | Success (no error) |

---

## 2. Command Execution Tools

### 2.1 `ssh_exec`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Simple command | `{ credentialName: "vps1", command: "echo hello" }` | `hello` |
| Command with output | `{ credentialName: "vps1", command: "uptime" }` | Uptime string |
| Invalid credential | `{ credentialName: "unknown", command: "ls" }` | Error: credential not found |
| Command failure | `{ credentialName: "vps1", command: "exit 1" }` | Error with exit code 1 |
| Timeout test | `{ credentialName: "vps1", command: "sleep 5", timeout: 1000 }` | Error: TIMEOUT |
| Large output | `{ credentialName: "vps1", command: "seq 1 100000" }` | Truncated output with indicator |

### 2.2 `ssh_exec_raw`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Simple command | `{ credentialName: "vps1", command: ["echo", "hello"] }` | `hello` |
| Grep with pipe pattern | `{ credentialName: "vps1", command: ["grep", "-E", "root\|ubuntu", "/etc/passwd"] }` | Matching lines |
| Single quotes in arg | `{ credentialName: "vps1", command: ["echo", "it's working"] }` | `it's working` |
| Double quotes in arg | `{ credentialName: "vps1", command: ["echo", "say \"hello\""] }` | `say "hello"` |
| Dollar sign (literal) | `{ credentialName: "vps1", command: ["echo", "$HOME"] }` | `$HOME` (literal) |
| Python one-liner | `{ credentialName: "vps1", command: ["python3", "-c", "print('test')"] }` | `test` |
| Complex regex | `{ credentialName: "vps1", command: ["grep", "-E", "^[a-z]+:", "/etc/passwd"] }` | Matching lines |

---

## 3. File Transfer Tools

### 3.1 `scp_copy`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Upload file | `{ credentialName: "vps1", localPath: "/tmp/test.txt", remotePath: "/tmp/test.txt", direction: "toRemote" }` | Success message |
| Download file | `{ credentialName: "vps1", localPath: "/tmp/downloaded.txt", remotePath: "/tmp/test.txt", direction: "fromRemote" }` | Success message |
| Non-existent local file | `{ ..., localPath: "/nonexistent", direction: "toRemote" }` | Error |
| Non-existent remote file | `{ ..., remotePath: "/nonexistent", direction: "fromRemote" }` | Error |
| Invalid credential | `{ credentialName: "unknown", ... }` | Error: credential not found |

### 3.2 `rsync_copy`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Sync directory to remote | `{ credentialName: "vps1", localPath: "/tmp/testdir/", remotePath: "/tmp/testdir/", direction: "toRemote" }` | Success with rsync output |
| Sync from remote | `{ credentialName: "vps1", localPath: "/tmp/pulled/", remotePath: "/tmp/testdir/", direction: "fromRemote" }` | Success with rsync output |
| Invalid credential | `{ credentialName: "unknown", ... }` | Error: credential not found |

---

## 4. Interactive Session Tools

### 4.1 `ssh_session_start`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Start session | `{ credentialName: "vps1" }` | JSON with sessionId |
| Invalid credential | `{ credentialName: "unknown" }` | Error: credential not found |

### 4.2 `ssh_session_send`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Send command | `{ sessionId: "<valid>", input: "ls\n" }` | Success: bytes sent |
| Invalid session | `{ sessionId: "invalid-uuid", input: "ls\n" }` | Error: SESSION_NOT_FOUND |

### 4.3 `ssh_session_read`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Read output | `{ sessionId: "<valid>" }` | Session output buffer |
| Read with clear=false | `{ sessionId: "<valid>", clear: false }` | Output (buffer retained) |
| Read empty buffer | `{ sessionId: "<valid>" }` | `[No new output]` |
| Invalid session | `{ sessionId: "invalid-uuid" }` | Error: SESSION_NOT_FOUND |

### 4.4 `ssh_session_list`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| List active sessions | `{}` | JSON array of sessions |
| No active sessions | `{}` | `No active sessions.` |

### 4.5 `ssh_session_end`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| End valid session | `{ sessionId: "<valid>" }` | Success message |
| End invalid session | `{ sessionId: "invalid-uuid" }` | Session not found message |
| End already closed | `{ sessionId: "<closed>" }` | Session not found message |

---

## 5. Port Forwarding Tools

### 5.1 `ssh_tunnel_start`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Local tunnel | `{ credentialName: "vps1", localPort: 19999, remoteHost: "localhost", remotePort: 22 }` | JSON with tunnelId |
| Local tunnel (explicit type) | `{ credentialName: "vps1", type: "local", localPort: 19998, remoteHost: "localhost", remotePort: 80 }` | JSON with tunnelId |
| Remote tunnel | `{ credentialName: "vps1", type: "remote", localPort: 3000, remoteHost: "localhost", remotePort: 9999 }` | JSON with tunnelId |
| Port in use | `{ credentialName: "vps1", localPort: 22, ... }` | Error: EADDRINUSE |
| Invalid credential | `{ credentialName: "unknown", ... }` | Error: credential not found |

### 5.2 `ssh_tunnel_list`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| List active tunnels | `{}` | JSON array of tunnels |
| No active tunnels | `{}` | `No active tunnels.` |

### 5.3 `ssh_tunnel_stop`

| Test Case | Input | Expected Output |
|-----------|-------|-----------------|
| Stop valid tunnel | `{ tunnelId: "<valid>" }` | Success message |
| Stop invalid tunnel | `{ tunnelId: "invalid-uuid" }` | Error: TUNNEL_NOT_FOUND |

---

## 6. Error Handling Tests

### 6.1 Error Classification

| Scenario | Expected errorType |
|----------|-------------------|
| Connection refused | `SSH_CONNECTION` |
| Host unreachable | `SSH_CONNECTION` |
| Permission denied | `AUTH_FAILURE` |
| Invalid key | `AUTH_FAILURE` |
| Command syntax error | `SHELL_PARSE_ERROR` |
| Command not found | `SHELL_PARSE_ERROR` |
| Non-zero exit code | `COMMAND_FAILED` |
| Timeout exceeded | `TIMEOUT` |
| Output buffer exceeded | `BUFFER_EXCEEDED` |

### 6.2 Error Response Format

All errors should return JSON with:
```json
{
  "errorType": "<type>",
  "originalCommand": "<command>",
  "executedCommand": "[hidden]",
  "exitCode": <number|null>,
  "stdout": "<partial output>",
  "stderr": "<error output>",
  "suggestion": "<helpful message>"
}
```

---

## 7. Security Tests

### 7.1 Credential Protection

| Test Case | Verification |
|-----------|--------------|
| Error messages | No host/IP in error output |
| Error messages | No username in error output |
| Error messages | No key path in error output |
| Logs | Only credential name logged, not details |

### 7.2 Input Validation

| Test Case | Input | Expected |
|-----------|-------|----------|
| SQL injection in credential name | `{ name: "'; DROP TABLE credentials;--" }` | Safe handling |
| Path traversal in key path | `{ privateKeyPath: "../../etc/passwd" }` | Resolved path validation |

---

## 8. Integration Test Sequence

Run these tests in order to verify full functionality:

```
1. add_credential (create "test-cred")
2. list_credentials (verify it appears)
3. ssh_exec (simple command)
4. ssh_exec_raw (grep with pipe pattern)
5. scp_copy toRemote (upload test file)
6. scp_copy fromRemote (download test file)
7. ssh_session_start (get sessionId)
8. ssh_session_send (send "whoami\n")
9. ssh_session_read (verify output)
10. ssh_session_list (verify session listed)
11. ssh_session_end (close session)
12. ssh_tunnel_start (create tunnel)
13. ssh_tunnel_list (verify tunnel listed)
14. ssh_tunnel_stop (close tunnel)
15. remove_credential (cleanup)
```

---

## 9. Performance Benchmarks

| Operation | Expected Time |
|-----------|---------------|
| ssh_exec (simple command) | < 2s |
| ssh_exec_raw (simple command) | < 2s |
| scp_copy (1KB file) | < 3s |
| ssh_session_start | < 3s |
| ssh_tunnel_start | < 3s |

---

## Revision History

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-18 | 1.0 | Initial test specification |
