#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { exec } from 'child_process';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Initialize database
async function initDb() {
    const db = await open({
        filename: './ssh.db',
        driver: sqlite3.Database
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      host TEXT NOT NULL,
      username TEXT NOT NULL,
      privateKey TEXT NOT NULL
    )
  `);

    return db;
}

class SshServer {
    private server: Server;

    constructor() {
        this.server = new Server(
            {
                name: 'ssh-server',
                version: '0.1.0',
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupToolHandlers();
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'ssh_exec',
                    description: 'Execute command over SSH',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            host: { type: 'string' },
                            command: { type: 'string' },
                            username: { type: 'string' },
                            privateKey: { type: 'string' },
                        },
                        required: ['host', 'command', 'username', 'privateKey'],
                    },
                },
                {
                    name: 'add_credential',
                    description: 'Add a new SSH credential',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            host: { type: 'string' },
                            username: { type: 'string' },
                            privateKey: { type: 'string' },
                        },
                        required: ['name', 'host', 'username', 'privateKey'],
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
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const db = await initDb();

            switch (request.params.name) {
                case 'ssh_exec': {
                    const args = request.params.arguments as {
                        host: string;
                        command: string;
                        username: string;
                        privateKey: string;
                    };
                    const { host, command, username, privateKey } = args;

                    return new Promise((resolve, reject) => {
                        const sshCommand = `ssh -i ${privateKey} ${username}@${host} "${command}"`;

                        exec(sshCommand, (error, stdout, stderr) => {
                            if (error) {
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: `SSH error: ${stderr}`,
                                    }],
                                    isError: true,
                                });
                            } else {
                                resolve({
                                    content: [{
                                        type: 'text',
                                        text: stdout,
                                    }],
                                });
                            }
                        });
                    });
                }

                case 'add_credential': {
                    const { name, host, username, privateKey } = request.params.arguments as {
                        name: string;
                        host: string;
                        username: string;
                        privateKey: string;
                    };

                    await db.run(
                        'INSERT INTO credentials (name, host, username, privateKey) VALUES (?, ?, ?, ?)',
                        [name, host, username, privateKey]
                    );

                    return {
                        content: [{
                            type: 'text',
                            text: `Credential ${name} added successfully`
                        }]
                    };
                }

                case 'list_credentials': {
                    const credentials = await db.all('SELECT * FROM credentials');
                    return {
                        content: [{
                            type: 'text',
                            text: JSON.stringify(credentials, null, 2)
                        }]
                    };
                }

                case 'remove_credential': {
                    const { name } = request.params.arguments as { name: string };
                    await db.run('DELETE FROM credentials WHERE name = ?', [name]);
                    return {
                        content: [{
                            type: 'text',
                            text: `Credential ${name} removed successfully`
                        }]
                    };
                }

                default:
                    throw new Error('Unknown tool');
            }
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('SSH MCP server running on stdio');
    }
}

const server = new SshServer();
server.run().catch(console.error);
