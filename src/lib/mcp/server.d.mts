export function handleMcpRequest(request: Request, options?: { apiBase?: string; fetchJson?: (path: string) => Promise<{status: number; body: unknown}> }): Promise<Response>;
export function createF1McpServer(options?: { apiBase?: string; fetchJson?: (path: string) => Promise<{status: number; body: unknown}> }): import('@modelcontextprotocol/sdk/server/mcp.js').McpServer;
export function createMcpFetcher(base?: string, fetchImpl?: typeof fetch): (path: string) => Promise<{status: number; body: unknown}>;
export function searchEntities(query: string, runner: {call: (name: string, input: unknown) => Promise<any>}): Promise<{results: {id: string; title: string; url: string}[]}>;
export function fetchEntity(id: string, runner: {call: (name: string, input: unknown) => Promise<any>}): Promise<any>;
export function allowMcpRequest(ip: string, now?: number): boolean;
export declare const MCP_INSTRUCTIONS: string;
