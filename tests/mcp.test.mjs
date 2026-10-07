import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { F1_TOOLS, MAX_RESULT_CHARS } from '../src/lib/f1-tools/catalogue.mjs';
import { allowMcpRequest, createMcpFetcher, handleMcpRequest } from '../src/lib/mcp/server.mjs';

const calendar = [{ round: 1, official_round: 1, name: 'Australian Grand Prix', date: '2026-03-08', status: 'completed', circuit: { name: 'Albert Park', city: 'Melbourne', country: 'Australia' } }];
const standings = [{ driver_id: 1, driver_code: 'NOR', first_name: 'Lando', last_name: 'Norris', team_name: 'McLaren', position: 1, points: 100 }];
const fixtures = { '/v1/f1/calendar/2026': calendar, '/v1/f1/calendar/next': calendar[0], '/v1/f1/standings/drivers/2026': standings, '/v1/f1/races/2026/1/results': [{ driver_id: 1, driver_code: 'NOR', first_name: 'Lando', last_name: 'Norris', position: 1, points: 25 }] };
const fetchJson = async (path) => path in fixtures ? { status: 200, body: { status: 'ok', data: fixtures[path], meta: { source: 'formula1.com' } } } : { status: 503, body: { status: 'error', error: { message: 'Unavailable' } } };

async function connectedClient() {
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/api/mcp'), { fetch: (input, init) => handleMcpRequest(new Request(input, init), { fetchJson }) });
  await client.connect(transport);
  return client;
}

test('official SDK initializes and lists 19 read-only tools plus search/fetch', async () => {
  const client = await connectedClient();
  try {
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 21);
    assert.deepEqual(tools.filter((tool) => tool.name.startsWith('f1_')).map((tool) => tool.name), F1_TOOLS.map((tool) => tool.name));
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tools.find((tool) => tool.name === 'f1_race_results').inputSchema.type, 'object');
  } finally { await client.close(); }
});

test('official SDK calls three F1 tools and ChatGPT search/fetch', async () => {
  const client = await connectedClient();
  try {
    const race = await client.callTool({ name: 'f1_resolve_race', arguments: { season: 2026, query: 'Australian Grand Prix' } });
    assert.equal(race.structuredContent.data.candidates[0].api_round, 1);
    const driver = await client.callTool({ name: 'f1_resolve_driver', arguments: { season: 2026, query: 'NOR' } });
    assert.equal(driver.structuredContent.data.candidates[0].driver_id, 1);
    const results = await client.callTool({ name: 'f1_race_results', arguments: { season: 2026, api_round: 1 } });
    assert.equal(results.structuredContent.data.results[0].position, 1);
    assert.match(results.structuredContent.source.api_url, /^https:\/\/api\.thedatadriver\.app/);
    const search = await client.callTool({ name: 'search', arguments: { query: 'Australian Grand Prix 2026' } });
    assert.equal(search.structuredContent.results[0].id, 'race:2026:1');
    const fetched = await client.callTool({ name: 'fetch', arguments: { id: 'race:2026:1' } });
    assert.equal(fetched.structuredContent.id, 'race:2026:1');
    assert.equal(JSON.parse(fetched.content[0].text).id, 'race:2026:1');
    assert.ok(fetched.structuredContent.url);
  } finally { await client.close(); }
});

test('schema, upstream errors, response bounds and proxy allow-list', async () => {
  const client = await connectedClient();
  try {
    assert.equal((await client.callTool({ name: 'f1_calendar', arguments: { season: 1800 } })).isError, true);
    const unavailable = await client.callTool({ name: 'f1_weather', arguments: { season: 2026, api_round: 1 } });
    assert.equal(unavailable.isError, true);
    assert.equal(unavailable.structuredContent.error.status, 503);
    assert.ok(JSON.stringify(unavailable.structuredContent).length <= MAX_RESULT_CHARS);
    assert.equal((await client.callTool({ name: 'fetch', arguments: { id: '../secrets' } })).isError, true);
  } finally { await client.close(); }
  let called = false;
  const protectedFetcher = createMcpFetcher('https://api.thedatadriver.app', async () => { called = true; return Response.json({}); });
  assert.equal((await protectedFetcher('/v1/f1/admin')).status, 404);
  assert.equal(called, false);
  const oversized = createMcpFetcher('https://api.thedatadriver.app', async () => new Response('x'.repeat(2_000_001)));
  assert.equal((await oversized('/v1/f1/calendar/2026')).status, 502);
});

test('MCP HTTP response supports CORS and JSON under site CSP', async () => {
  const response = await handleMcpRequest(new Request('http://localhost/api/mcp', { method: 'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const req = new Request('http://localhost/api/mcp', { method: 'POST', headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) });
  const rpc = await handleMcpRequest(req, { fetchJson });
  assert.equal(rpc.status, 200);
  assert.match(rpc.headers.get('content-type'), /application\/json/);
  assert.equal((await rpc.json()).result.serverInfo.name, 'The Data Driver — F1 data');
});


test('request bytes and per-IP rate limit are bounded', async () => {
  const large = await handleMcpRequest(new Request('http://localhost/api/mcp', { method: 'POST', body: 'x'.repeat(8_193) }));
  assert.equal(large.status, 413);
  const ip = `test-${Math.random()}`;
  for (let i = 0; i < 60; i += 1) assert.equal(allowMcpRequest(ip, 1_000), true);
  assert.equal(allowMcpRequest(ip, 1_000), false);
  assert.equal(allowMcpRequest(ip, 61_001), true);
});
