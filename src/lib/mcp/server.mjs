import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { F1_TOOLS, createF1ToolRunner, DEFAULT_PUBLIC_API_ORIGIN } from '../f1-tools/catalogue.mjs';
import { isAllowedProxyPath } from '../proxy-allowlist.mjs';

export const MCP_INSTRUCTIONS = 'The Data Driver provides public, read-only F1 data. Official results, calendars and standings come from official sources. Historical OpenF1 analysis is non-official enrichment under CC BY-NC-SA 4.0, for non-commercial use. Cite the source URL in each result, preserve availability/reason, and never invent missing facts.';
const MAX_REQUEST_BYTES = 8_192;
const MAX_UPSTREAM_BYTES = 2_000_000;
const WINDOW_MS = 60_000;
// Best effort per-instance safeguards; platform firewall must enforce a shared limit.
const MAX_REQUESTS_PER_WINDOW = 300;
const MAX_INSTANCE_REQUESTS_PER_WINDOW = 3_000;
const buckets = new Map();
let instanceBucket = { count: 0, until: 0 };
let nextSweep = 0;

export function allowMcpRequest(ip, now = Date.now()) {
  if (now >= nextSweep) {
    for (const [key, value] of buckets) if (value.until <= now) buckets.delete(key);
    nextSweep = now + WINDOW_MS;
  }
  if (instanceBucket.until <= now) instanceBucket = { count: 0, until: now + WINDOW_MS };
  if (instanceBucket.count >= MAX_INSTANCE_REQUESTS_PER_WINDOW) return false;
  const key = ip || 'unknown';
  const bucket = buckets.get(key);
  if (!bucket || bucket.until <= now) { buckets.set(key, { count: 1, until: now + WINDOW_MS }); instanceBucket.count += 1; return true; }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) return false;
  bucket.count += 1;
  instanceBucket.count += 1;
  return true;
}

function apiOrigin(base) {
  const url = new URL(base || DEFAULT_PUBLIC_API_ORIGIN);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid API base URL.');
  return url.origin;
}

export function createMcpFetcher(base = DEFAULT_PUBLIC_API_ORIGIN, fetchImpl = fetch) {
  const origin = apiOrigin(base);
  return async (path) => {
    const segments = path.replace(/^\//, '').split('/');
    if (!isAllowedProxyPath('GET', segments)) return { status: 404, body: { status: 'error', error: { message: 'Path not allowed.' } } };
    try {
      const response = await fetchImpl(`${origin}${path}`, { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8_000), cache: 'no-store', redirect: 'error' });
      if (Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES) throw new Error('Upstream response too large.');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty upstream response.');
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_UPSTREAM_BYTES) { await reader.cancel(); throw new Error('Upstream response too large.'); }
        chunks.push(value);
      }
      const raw = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
      if (response.status >= 500) return { status: response.status, body: { status: 'error', error: { message: 'Upstream API unavailable.' } } };
      return { status: response.status, body: JSON.parse(new TextDecoder().decode(raw)) };
    } catch (error) {
      return { status: 502, body: { status: 'error', error: { message: 'Upstream API unavailable.' } } };
    }
  };
}

function result(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function yearFromQuery(query) {
  const match = query.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : new Date().getUTCFullYear();
}

function documentTitle(name, season) {
  return /\b(?:19|20)\d{2}\b/.test(name) ? name : `${name} (${season})`;
}

function upstreamError(value) {
  return { error: { status: value.error?.status ?? null, message: 'Upstream API unavailable.' } };
}

export async function searchEntities(query, runner) {
  const season = yearFromQuery(query);
  const name = query.replace(/\b(19\d{2}|20\d{2})\b/g, '').trim();
  const [races, drivers] = await Promise.all([
    runner.call('f1_resolve_race', { season, query: name || query }),
    runner.call('f1_resolve_driver', { season, query: name || query }),
  ]);
  if (!races.ok && races.error?.status !== 404) return upstreamError(races);
  if (!drivers.ok && drivers.error?.status !== 404) return upstreamError(drivers);
  const results = [];
  for (const race of races.ok ? races.data?.candidates ?? [] : []) {
    if (Number.isInteger(race.api_round)) results.push({ id: `race:${season}:${race.api_round}`, title: documentTitle(race.name, season), url: `${new URL(races.source.api_url).origin}/v1/f1/races/${season}/${race.api_round}/results` });
  }
  for (const driver of drivers.ok ? drivers.data?.candidates ?? [] : []) {
    if (Number.isInteger(driver.driver_id)) results.push({ id: `driver:${season}:${driver.driver_id}`, title: documentTitle(driver.name, season), url: `${new URL(drivers.source.api_url).origin}/v1/f1/standings/drivers/${season}` });
  }
  return { results: results.slice(0, 10) };
}

export async function fetchEntity(id, runner) {
  const match = /^(race|driver):(19\d{2}|20\d{2}):(\d{1,4})$/.exec(id);
  if (!match) return null;
  const [, type, seasonText, numberText] = match;
  const season = Number(seasonText);
  const number = Number(numberText);
  if (type === 'race') {
    const data = await runner.call('f1_calendar', { season });
    if (!data.ok) return data.error?.status === 404 ? null : upstreamError(data);
    const race = data.data?.races?.find((row) => row.api_round === number);
    if (!race) return null;
    const document = { id, title: documentTitle(race.name, season), text: JSON.stringify({ race, source: data.source, availability: data.availability, reason: data.reason }), url: `${new URL(data.source.api_url).origin}/v1/f1/races/${season}/${number}/results`, metadata: { source: data.source.name, licence: data.source.licence } };
    return document;
  }
  const data = await runner.call('f1_driver_standings', { season, limit: 30 });
  if (!data.ok) return data.error?.status === 404 ? null : upstreamError(data);
  const driver = data.data?.standings?.find((row) => row.driver_id === number);
  if (!driver) return null;
  return { id, title: documentTitle(driver.name, season), text: JSON.stringify({ driver, source: data.source, availability: data.availability, reason: data.reason }), url: data.source.api_url, metadata: { source: data.source.name, licence: data.source.licence } };
}

export function createF1McpServer({ apiBase = DEFAULT_PUBLIC_API_ORIGIN, fetchJson = createMcpFetcher(apiBase) } = {}) {
  const server = new McpServer({ name: 'The Data Driver — F1 data', version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS });
  const runner = createF1ToolRunner({ fetchJson, publicOrigin: apiOrigin(apiBase) });
  for (const tool of F1_TOOLS) server.registerTool(tool.name, {
    title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async (input) => { const value = await runner.call(tool.name, input); return result(value, !value.ok); });
  server.registerTool('search', {
    description: 'Search published F1 races and drivers by name or code; optionally include a season year. Returns IDs for fetch.',
    inputSchema: z.strictObject({ query: z.string().min(1).max(80) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query }) => { const value = await searchEntities(query, runner); return result(value, Boolean(value.error)); });
  server.registerTool('fetch', {
    description: 'Fetch a race or driver document by an ID returned by search, with a citable public API URL.',
    inputSchema: z.strictObject({ id: z.string().min(1).max(80) }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ id }) => { const document = await fetchEntity(id, runner); return document ? result(document, Boolean(document.error)) : result({ error: 'Document not found.' }, true); });
  server.server.registerCapabilities({ tools: { listChanged: false } });
  return server;
}

export async function handleMcpRequest(request, options = {}) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID', 'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version', 'Cache-Control': 'no-store' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
  // Proxy headers are trusted only behind Vercel, which overwrites them.
  const trustProxyHeaders = options.trustProxyHeaders ?? Boolean(process.env.VERCEL);
  const forwarded = trustProxyHeaders ? (request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')) : null;
  const ip = forwarded?.split(',')[0]?.trim() || request.socket?.remoteAddress || request.ip || 'unknown';
  const rpcError = (status, code, message, headers = {}) => Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status, headers: { ...cors, ...headers } });
  if (!allowMcpRequest(ip)) return rpcError(429, -32000, 'Rate limit exceeded.', { 'Retry-After': '60' });
  if (request.method === 'POST') {
    const length = Number(request.headers.get('content-length'));
    if (length > MAX_REQUEST_BYTES) return rpcError(413, -32600, 'Request too large.');
    const reader = request.body?.getReader();
    if (!reader) return rpcError(400, -32600, 'Request body required.');
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) { await reader.cancel(); return rpcError(413, -32600, 'Request too large.'); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    let parsed;
    try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { return rpcError(400, -32700, 'Invalid JSON.'); }
    if (Array.isArray(parsed)) return rpcError(400, -32600, 'JSON-RPC batches are not supported.');
    request = new Request(request.url, { method: 'POST', headers: request.headers, body });
  }
  const server = createF1McpServer(options);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: MAX_REQUEST_BYTES });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  } finally { await server.close(); }
}
