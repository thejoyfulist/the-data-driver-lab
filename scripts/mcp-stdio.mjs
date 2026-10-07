#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createF1McpServer } from '../src/lib/mcp/server.mjs';

let server;
try {
  server = createF1McpServer({ apiBase: process.env.TDD_API_BASE || 'https://api.thedatadriver.app' });
} catch {
  console.error('Invalid TDD_API_BASE. Set it to an http(s) origin only, for example https://api.thedatadriver.app (no path, query or credentials).');
  process.exit(2);
}
await server.connect(new StdioServerTransport());
