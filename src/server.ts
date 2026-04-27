import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initDb } from './db.js';
import { handleToolCall } from './handlers/index.js';
import { startSessionCleanup } from './state.js';
import { tools } from './tools.js';

export function createSshServer() {
    const server = new Server(
        {
            name: 'ssh-server',
            version: '0.1.0',
        },
        {
            capabilities: {
                tools: {},
            },
        },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const db = await initDb();
        console.error('DEBUG: CallToolRequest handler entered for tool:', request.params.name);
        console.error('DEBUG: Tool arguments received');

        return handleToolCall(request.params.name, request.params.arguments, db);
    });

    startSessionCleanup();

    return server;
}
