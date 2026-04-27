#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSshServer } from './server.js';

async function run() {
    const server = createSshServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('SSH MCP server running on stdio');
}

run().catch(console.error);
