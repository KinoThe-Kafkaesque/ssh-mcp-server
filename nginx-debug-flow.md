# Nginx Typo Debugging Flow with SSH Tools

```mermaid
sequenceDiagram
    participant U as User
    participant G as Grok (LLM)
    participant S as SSH MCP Server
    participant R as Remote Server

    U->>G: "Help me debug my Nginx config typo"
    G->>S: Call ssh_exec: "cat /etc/nginx/nginx.conf" <br>(host: remote.example.com, username: user, privateKeyPath: ~/.ssh/id_rsa)
    S->>R: SSH: cat /etc/nginx/nginx.conf
    R-->>S: Config file contents with typo: "srever" instead of "server"
    S-->>G: Returns config file contents
    G->>U: Shows config: "I found a typo: 'srever' should be 'server' in line 10"
    U->>G: "Can you fix it with 'sed'?"
    G->>S: Call ssh_exec: "sed -i 's/srever/server/' /etc/nginx/nginx.conf" <br>(same credentials)
    S->>R: SSH: Executes sed command to fix typo
    R-->>S: Command executed successfully
    S-->>G: Success response
    G->>S: Call ssh_exec: "cat /etc/nginx/nginx.conf" <br>(to verify fix)
    S->>R: SSH: cat /etc/nginx/nginx.conf
    R-->>S: Updated config with "server"
    S-->>G: Returns updated config
    G->>S: Call ssh_exec: "nginx -t && cat /var/log/nginx/error.log | tail -n 10"
    S->>R: SSH: Tests config and reads last 10 log lines
    R-->>S: "nginx: configuration file /etc/nginx/nginx.conf test is successful" <br> + log output
    S-->>G: Returns test result and logs
    G->>U: "Fix applied successfully. Config test passed. Recent logs show no errors."
```

## Typo Debugging Scenario

1. **SSH Tool Usage** (Green):
   - Execute diagnostic commands
   - Edit configuration files
   - Service management
   - Secure credential storage

2. **Debugging Flow**:
   1. User reports unexpected 500 errors
   2. Model checks error logs via SSH: `grep error /var/log/nginx/error.log`
   3. Identifies "unknowndirective" typo in config
   4. Models directs config edit:
      `sed -i 's/unknowndirective/known_directive/g' /etc/nginx/nginx.conf`
   5. Validate configuration with `nginx -t`
   6. Graceful restart: `systemctl reload nginx`
   7. Confirm site functionality restored
