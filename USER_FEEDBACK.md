# SSH MCP Server - User Experience Feedback

Real-world usage feedback from an extensive session managing a Freqtrade trading bot deployment.

**Test Duration:** ~2 hours
**Commands Executed:** ~50+
**Use Case:** VPS management, backtesting, file sync, service management

---

## Overall Rating: 5.5/10

| Aspect | Score | Summary |
|--------|-------|---------|
| Flexibility | 6/10 | Covers basics, missing advanced features |
| Ease of Use | 4/10 | Shell escaping is a nightmare |
| Error Handling | 5/10 | Functional but cryptic messages |
| Security | 7/10 | Decent, key-based authentication |

---

## 1. Flexibility (6/10)

### What Works Well

- **Basic command execution** - Simple commands work fine
- **rsync integration** - File transfers work reliably
- **Credential storage** - Convenient for repeated use
- **Cross-platform** - Works from any MCP client

### What's Missing

| Feature | Impact | Use Case |
|---------|--------|----------|
| Interactive/PTY support | HIGH | Can't run `htop`, `vim`, `less` |
| Streaming output | HIGH | Can't see progress of long commands |
| Background job management | MEDIUM | Can't cancel running commands |
| Port forwarding/tunnels | MEDIUM | Can't access remote web services |
| SCP for single files | LOW | rsync is overkill for small files |
| SSH agent support | LOW | Can't use passphrase-protected keys |

### Feature Requests

```typescript
// 1. Raw command mode (array instead of string)
ssh_exec_raw({
  host: "...",
  command: ["grep", "-E", "pattern|other", "file.txt"],
  // No shell escaping needed!
})

// 2. Interactive session
ssh_session_start({ host: "..." }) // Returns session ID
ssh_session_send({ sessionId: "...", input: "ls\n" })
ssh_session_read({ sessionId: "..." })
ssh_session_end({ sessionId: "..." })

// 3. Port forwarding
ssh_tunnel({
  host: "...",
  localPort: 8080,
  remotePort: 3000,
})
```

---

## 2. Ease of Use (4/10)

### The Shell Escaping Problem

The biggest pain point. The current implementation wraps commands in:

```typescript
// From src/index.ts line 166-168:
const escapedCommand = command.replace(/'/g, "'\\''");
const sshCommand = `ssh -i "${validatedKeyPath}" ${username}@${host} "bash -ic '${escapedCommand}'"`;
```

This causes **cascading escaping hell** when commands contain:
- Single quotes
- Double quotes
- Pipes in regex patterns
- Dollar signs
- Backticks

### Commands That Failed

```bash
# 1. Grep with pipe in pattern
grep -E "strategy|AggressiveEMA|Started"
# Error: /bin/sh: 1: AggressiveEMA: not found

# 2. Nested quotes
echo "text with 'quotes'"
# Error: unexpected EOF while looking for matching `''

# 3. Python one-liners
python -c "print('hello')"
# Error: Syntax error: "(" unexpected

# 4. Sed commands
sed -i 's/old/new/' file.txt
# Error: Syntax error due to quote escaping

# 5. Heredocs
cat << 'EOF'
content
EOF
# Error: Complete failure

# 6. JSON in commands
echo '{"key": "value"}'
# Error: Brace expansion issues
```

### Commands That Worked

```bash
# Simple commands
ls -la
cat /etc/hostname
systemctl status freqtrade
sudo apt update
cd /path && command  # Basic chaining
```

### Workaround Pattern

For complex commands, I had to:

1. Write file locally
2. rsync to VPS
3. Execute the file (single simple command)

```typescript
// Instead of complex inline command:
// ssh_exec({ command: "complex 'quoted' | piped | command" })

// Do this:
// 1. Write script locally
Write({ file_path: "/tmp/script.sh", content: "..." })

// 2. Sync to VPS
rsync_copy({ localPath: "/tmp/script.sh", remotePath: "/tmp/script.sh", direction: "toRemote" })

// 3. Execute
ssh_exec({ command: "bash /tmp/script.sh" })
```

This worked but added significant friction.

### Success Rate by Command Type

| Command Type | Success Rate | Notes |
|--------------|--------------|-------|
| Simple commands | 95% | `ls`, `cat`, `systemctl` |
| Commands with flags | 90% | `grep -r`, `find -name` |
| Piped commands | 70% | Simple pipes work |
| Commands with quotes | 30% | Major issues |
| Regex patterns | 20% | Pipes in regex fail |
| Python/sed one-liners | 10% | Almost always fail |
| Heredocs | 0% | Never worked |

---

## 3. Error Handling (5/10)

### What Works

- Returns both stdout and stderr
- Shows when commands fail
- Includes exit codes in error context

### What Doesn't Work

#### Cryptic Shell Errors

```
Error: /bin/sh: 1: Syntax error: "(" unexpected
```

This doesn't tell you:
- Which part of the command failed
- What the actual executed command was
- How to fix it

#### No Distinction Between Error Types

```
SSH command failed.
Error: Command failed: ssh -i "..." user@host "bash -ic '...'"
```

Can't tell if:
- SSH connection failed
- Authentication failed
- Remote command failed
- Shell parsing failed

### Suggested Improvements

```typescript
// Better error structure
{
  errorType: "SHELL_PARSE_ERROR" | "SSH_CONNECTION" | "AUTH_FAILURE" | "COMMAND_FAILED",
  originalCommand: "...",
  executedCommand: "ssh -i ... bash -ic '...'",
  exitCode: 127,
  stdout: "...",
  stderr: "...",
  suggestion: "Try escaping single quotes or use ssh_exec_raw"
}
```

---

## 4. Security (7/10)

### Good Practices

- **SSH key authentication** - No passwords stored
- **Key path validation** - Checks file exists
- **No key content exposure** - Only path stored
- **SQLite for credentials** - Local storage

### Concerns

| Issue | Severity | Notes |
|-------|----------|-------|
| Key path in every call | LOW | Visible in logs |
| No SSH agent support | MEDIUM | Can't use passphrase keys |
| No host key verification status | MEDIUM | Silent MITM possible |
| Plain text credential storage | MEDIUM | SQLite unencrypted |

### Suggestions

```typescript
// 1. Allow credential reference only
ssh_exec({
  credentialName: "vps1",  // Don't expose key path
  command: "ls"
})

// 2. Host key verification
ssh_exec({
  host: "...",
  strictHostKeyChecking: true,  // Fail on unknown hosts
})

// 3. Encrypted credential storage
// Use OS keychain or encrypted SQLite
```

---

## 5. Specific Bugs Encountered

### Bug 1: rsync Creates Nested Directories

When syncing a directory:

```typescript
rsync_copy({
  localPath: "/path/to/strategies/",
  remotePath: "/path/to/strategies/",
  direction: "toRemote"
})
```

Created `/path/to/strategies/strategies/` (nested) instead of syncing contents.

**Workaround:** Had to manually move files after sync.

### Bug 2: Large Output Truncation

Commands with large output get truncated without clear indication:

```
Error: result (58,626 characters) exceeds maximum allowed tokens
```

**Workaround:** Pipe to `tail -n 20` or write to file and read separately.

### Bug 3: Timeout Handling

Long-running commands sometimes fail silently. No way to:
- Set custom timeout
- See partial output
- Cancel running command

---

## 6. Recommendations

### Quick Wins (Easy to Implement)

1. **Add `ssh_exec_raw` tool** - Accept command as array, bypass shell escaping
2. **Better error messages** - Include executed command and error type
3. **Configurable timeout** - Add timeout parameter to ssh_exec
4. **Output streaming** - Return partial output for long commands

### Medium Effort

1. **Fix rsync directory handling** - Don't create nested dirs
2. **Add credential-based ssh_exec** - Don't require key path every time
3. **Host key verification option** - Security improvement

### Long Term

1. **Interactive session support** - PTY allocation
2. **Port forwarding** - SSH tunnels
3. **SSH agent integration** - Passphrase-protected keys

---

## 7. Usage Tips (Workarounds)

### For Complex Commands

```typescript
// DON'T: Inline complex commands
ssh_exec({ command: "grep -E 'foo|bar' file | head -5" })

// DO: Write script, sync, execute
Write({ path: "/tmp/cmd.sh", content: "grep -E 'foo|bar' file | head -5" })
rsync_copy({ localPath: "/tmp/cmd.sh", remotePath: "/tmp/cmd.sh", direction: "toRemote" })
ssh_exec({ command: "bash /tmp/cmd.sh" })
```

### For Config File Updates

```typescript
// DON'T: Use sed/heredoc over SSH
ssh_exec({ command: "sed -i 's/old/new/' config.json" })

// DO: Edit locally and sync
Edit({ file_path: "/local/config.json", old_string: "old", new_string: "new" })
rsync_copy({ localPath: "/local/config.json", remotePath: "/remote/config.json", direction: "toRemote" })
```

### For Viewing Output

```typescript
// DON'T: Cat large files
ssh_exec({ command: "cat /var/log/syslog" })

// DO: Use tail or redirect
ssh_exec({ command: "tail -100 /var/log/syslog" })
// OR
ssh_exec({ command: "cat /var/log/syslog > /tmp/output.txt" })
rsync_copy({ remotePath: "/tmp/output.txt", localPath: "/tmp/output.txt", direction: "fromRemote" })
```

---

## 8. Session Statistics

| Metric | Value |
|--------|-------|
| Total commands attempted | ~50 |
| Successful on first try | ~30 (60%) |
| Failed due to escaping | ~15 (30%) |
| Required workaround | ~12 (24%) |
| Used rsync as escape hatch | ~8 times |

---

*Feedback collected: 2025-12-18*
*MCP Server Version: 0.1.0*
*Client: Claude Code CLI*
