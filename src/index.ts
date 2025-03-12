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
import { existsSync } from 'fs';
import { resolve } from 'path';

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
      privateKeyPath TEXT NOT NULL
    )
  `);

    return db;
}

// Validate private key path
function validatePrivateKeyPath(path: string): string {
    const resolvedPath = resolve(path);
    if (!existsSync(resolvedPath)) {
        throw new Error(`Private key file not found at path: ${resolvedPath}`);
    }
    return resolvedPath;
}

const server = new Server(
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

// Setup tool handlers
function setupToolHandlers() {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
            {
                name: 'ssh_exec',
                description: 'Execute command over SSH using private key file path',
                inputSchema: {
                    type: 'object',
                    properties: {
                        host: { type: 'string' },
                        command: { type: 'string' },
                        username: { type: 'string' },
                        privateKeyPath: { type: 'string' },
                    },
                    required: ['host', 'command', 'username', 'privateKeyPath'],
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
        ],
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const db = await initDb();

        switch (request.params.name) {
            case 'ssh_exec': {
                const args = request.params.arguments as {
                    host: string;
                    command: string;
                    username: string;
                    privateKeyPath: string;
                };
                const { host, command, username, privateKeyPath } = args;

                try {
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

                    return new Promise((resolve, reject) => {
                        const sshCommand = `ssh -i "${validatedKeyPath}" ${username}@${host} "${command}"`;

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
                } catch (error: unknown) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                        isError: true,
                    };
                }
            }

            case 'add_credential': {
                const { name, host, username, privateKeyPath } = request.params.arguments as {
                    name: string;
                    host: string;
                    username: string;
                    privateKeyPath: string;
                };

                try {
                    const validatedKeyPath = validatePrivateKeyPath(privateKeyPath);

                    await db.run(
                        'INSERT INTO credentials (name, host, username, privateKeyPath) VALUES (?, ?, ?, ?)',
                        [name, host, username, validatedKeyPath]
                    );

                    return {
                        content: [{
                            type: 'text',
                            text: `Credential ${name} added successfully`
                        }]
                    };
                } catch (error: unknown) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
                        }],
                        isError: true,
                    };
                }
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

setupToolHandlers();

async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('SSH MCP server running on stdio');
}

run().catch(console.error);
