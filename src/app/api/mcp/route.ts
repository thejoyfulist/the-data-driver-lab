import { handleMcpRequest } from '@/lib/mcp/server.mjs';
import { apiBase } from '@/lib/config';

export const runtime = 'nodejs';
export const maxDuration = 15;

const handle = (request: Request) => handleMcpRequest(request, { apiBase: apiBase() });
export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
