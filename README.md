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

- Node.js (v16 or higher recommended)
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

The server provides the following tools:

#### ssh_exec

Execute a command over SSH.

**Input Parameters:**

- `host`: The host to connect to. (required)
- `command`: The command to execute. (required)
- `username`: The username to use for the SSH connection. (required)
- `privateKeyPath`: The path to the private key file. (required)

**Example Usage:**

```json
{
    "tool_name": "ssh_exec",
    "arguments": {
        "host": "example.com",
        "command": "ls -l",
        "username": "user",
        "privateKeyPath": "/path/to/private/key"
    }
}
```

**Note:** The `privateKeyPath` must be a valid path to a private key file.

#### add_credential

Add a new SSH credential.

**Input Parameters:**

- `name`: The name of the credential. (required)
- `host`: The host to connect to. (required)
- `username`: The username to use for the SSH connection. (required)
- `privateKeyPath`: The path to the private key file. (required)

**Example Usage:**

```json
{
    "tool_name": "add_credential",
    "arguments": {
        "name": "my_credential",
        "host": "example.com",
        "username": "user",
        "privateKeyPath": "/path/to/private/key"
    }
}
```

**Note:** The `privateKeyPath` must be a valid path to a private key file.

#### list_credentials

List all stored SSH credentials.

**Input Parameters:**

- None

**Example Usage:**

```json
{
    "tool_name": "list_credentials",
    "arguments": {}
}
```

#### remove_credential

Remove a stored SSH credential.

**Input Parameters:**

- `name`: The name of the credential to remove. (required)

**Example Usage:**

```json
{
    "tool_name": "remove_credential",
    "arguments": {
        "name": "my_credential"
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

ISC

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
