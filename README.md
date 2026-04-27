# SSH MCP Server

[![smithery badge](https://smithery.ai/badge/@KinoThe-Kafkaesque/ssh-mcp-server)](https://smithery.ai/server/@KinoThe-Kafkaesque/ssh-mcp-server)

A Model Context Protocol (MCP) server implementation that provides SSH
capabilities. This server allows for secure remote access and execution through
the MCP protocol.

## Features

- SSH server implementation using MCP protocol
- SQLite database integration for data persistence
- TypeScript implementation for type safety and better development experience

## Prerequisites

- Node.js 18 or higher
- npm or yarn package manager
- TypeScript knowledge for development

## Installation

### Installing via Smithery

To install SSH Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@KinoThe-Kafkaesque/ssh-mcp-server):

```bash
npx -y @smithery/cli install @KinoThe-Kafkaesque/ssh-mcp-server --client claude
```

### Manual Installation
1. Clone the repository:

```bash
git clone <repository-url>
cd ssh-server
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

## Usage

### Configuration

The server uses a SQLite database (`ssh.db`) to store SSH credentials. The
database file will be created automatically when the server starts.

### Tools

The server stores named credentials, then every remote action refers to a
`credentialName`. `privateKeyPath` must point to an existing private key.

- `add_credential`: save `{ "name", "host", "username", "privateKeyPath" }`.
- `list_credentials`: list stored credential records.
- `remove_credential`: delete `{ "name" }`.
- `ssh_exec`: run a shell command with `{ "credentialName", "command", "timeout" }`.
- `ssh_exec_raw`: run an argv-style command array, for example `{ "credentialName": "prod", "command": ["grep", "-E", "foo|bar", "/var/log/app.log"] }`.
- `scp_copy`: copy one file over SFTP with `{ "credentialName", "localPath", "remotePath", "direction" }`.
- `rsync_copy`: copy directories or larger trees with rsync and the same transfer shape.
- `ssh_session_start`, `ssh_session_send`, `ssh_session_read`, `ssh_session_end`, `ssh_session_list`: manage interactive SSH sessions.
- `ssh_tunnel_start`, `ssh_tunnel_list`, `ssh_tunnel_stop`: manage local or remote port-forwarding tunnels.

Example:

```json
{
  "tool_name": "ssh_exec",
  "arguments": {
    "credentialName": "prod",
    "command": "uptime",
    "timeout": 120000
  }
}
```

### Starting the server

```bash
npm start
```

The server will start running on the configured port (default settings can be
modified in the source code).

## Project Structure

- `src/` - Source code directory
- `build/` - Compiled JavaScript output
- `node_modules/` - Project dependencies

## Dependencies

- `@modelcontextprotocol/sdk`: MCP protocol implementation
- `sqlite3`: SQLite database driver
- `typescript`: Development dependency for TypeScript support

## Development

To make changes to the project:

1. Make your changes in the `src/` directory
2. Rebuild the project:

```bash
npm run build
```

3. Start the server to test your changes:

```bash
npm start
```

## License

MIT

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
