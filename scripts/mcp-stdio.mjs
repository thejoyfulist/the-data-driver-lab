#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createF1McpServer } from '../src/lib/mcp/server.mjs';

const server = createF1McpServer({ apiBase: process.env.TDD_API_BASE || 'https://api.thedatadriver.app' });
await server.connect(new StdioServerTransport());
