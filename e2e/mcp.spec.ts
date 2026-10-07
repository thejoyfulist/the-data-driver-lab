import { expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const base = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3411';

test('the Next route serves MCP under the site CSP', async ({ request }) => {
  const preflight = await request.fetch(`${base}/api/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://example.org', 'Access-Control-Request-Method': 'POST' } });
  expect(preflight.status()).toBe(204);
  expect(preflight.headers()['access-control-allow-origin']).toBe('*');
  const client = new Client({ name: 'next-route-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
  try {
    expect((await client.listTools()).tools).toHaveLength(21);
    const race = await client.callTool({ name: 'f1_resolve_race', arguments: { season: 2026, query: 'previous' } });
    expect(race.isError).toBeFalsy();
    const standings = await client.callTool({ name: 'f1_driver_standings', arguments: { season: 2026 } });
    expect(standings.isError).toBeFalsy();
    const search = await client.callTool({ name: 'search', arguments: { query: 'previous 2026' } });
    const first = (search.structuredContent as { results: { id: string }[] }).results[0];
    expect(first?.id).toMatch(/^race:2026:/);
    const fetched = await client.callTool({ name: 'fetch', arguments: { id: first.id } });
    expect((fetched.structuredContent as { url: string }).url).toMatch(/^https?:\/\//);
  } finally { await client.close(); }
  const initialize = await request.post(`${base}/api/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }, headers: { Accept: 'application/json, text/event-stream' } });
  expect(initialize.status()).toBe(200);
  expect(initialize.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(initialize.headers()['content-type']).toContain('application/json');
});

test('production route rejects streams and batches, and reports upstream outages', async ({ request }) => {
  for (const method of ['GET', 'DELETE']) {
    const response = await request.fetch(`${base}/api/mcp`, { method, headers: { Accept: 'text/event-stream' } });
    expect(response.status()).toBe(405);
    expect(response.headers().allow).toBe('POST, OPTIONS');
  }
  const batch = await request.post(`${base}/api/mcp`, { data: [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'f1_calendar', arguments: { season: 2026 } } }], headers: { Accept: 'application/json, text/event-stream' } });
  expect(batch.status()).toBe(400);
  expect((await batch.json()).error.code).toBe(-32600);
  const client = new Client({ name: 'outage-route-test', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`)));
  try {
    for (const call of [{ name: 'search', arguments: { query: 'Australian Grand Prix 2098' } }, { name: 'fetch', arguments: { id: 'race:2098:1' } }]) {
      const value = await client.callTool(call);
      expect(value.isError).toBe(true);
      expect((value.structuredContent as { error?: { message?: string } })?.error?.message).toBe('Upstream API unavailable.');
    }
  } finally { await client.close(); }
  const proxy = await request.get(`${base}/api/f1/v1/f1/calendar/2098`);
  expect(proxy.status()).toBe(503);
  expect((await proxy.json()).detail).toBe('Upstream API unavailable.');
});
