// Hosted streamable-HTTP endpoint: boots createHttpServer() on an ephemeral loopback
// port and drives it with the real MCP SDK client plus raw fetch. Upstream API calls
// go through a mock fetch, so nothing leaves the machine and nothing is paid.
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog.js';
import { assertSafeHttpConfig, clientIp, createHttpServer, FixedWindowLimiter, hostnameOf, TOOL_NAMES, type HttpServerOptions } from '../src/http.js';
import { SERVER_VERSION } from '../src/server.js';
import { fakePayer, make402, mockFetch, testConfig } from './helpers.js';

const MCP_ACCEPT = 'application/json, text/event-stream';
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw-test', version: '0' } },
};

let running: Server[] = [];

afterEach(async () => {
  await Promise.all(running.map((s) => new Promise((r) => s.close(r))));
  running = [];
});

async function boot(env: Record<string, string> = {}, options: HttpServerOptions = {}) {
  const config = testConfig({ MCP_HTTP_PORT: '0', ...env });
  const { server, stats } = createHttpServer(config, options);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, stats, config };
}

function rawPost(base: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: MCP_ACCEPT, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function connect(base: string): Promise<Client> {
  const client = new Client({ name: 'http-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  return client;
}

/** POST initialize with an exact Host header (fetch() cannot set Host). Resolves to the status code. */
function postWithHost(base: string, host: string): Promise<number> {
  const { port } = new URL(base);
  const body = JSON.stringify(INIT);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: Number(port),
        path: '/mcp',
        method: 'POST',
        headers: { Host: host, 'Content-Type': 'application/json', Accept: MCP_ACCEPT, 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

describe('hosted streamable HTTP endpoint', () => {
  it('serves the MCP protocol to the SDK client: initialize, tools/list, list_endpoints', async () => {
    const { base } = await boot();
    const client = await connect(base);
    expect(client.getServerVersion()).toMatchObject({ name: 'mercury402', version: SERVER_VERSION });

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());

    const res = (await client.callTool({ name: 'list_endpoints', arguments: {} })) as CallToolResult;
    const parsed = JSON.parse((res.content[0] as { text: string }).text);
    expect(parsed.count).toBe(CATALOG.count);
    expect(parsed.paid_mode).toEqual({ enabled: false });
    await client.close();
  });

  it('get_endpoint_data in free mode returns the 402 quote and never pays', async () => {
    const fetchFn = mockFetch(make402('/v1/fred/UNRATE', 0.05));
    const { base } = await boot({}, { deps: { fetch: fetchFn } });
    const client = await connect(base);
    const res = (await client.callTool({ name: 'get_endpoint_data', arguments: { path: '/v1/fred/UNRATE' } })) as CallToolResult;
    const text = (res.content[0] as { text: string }).text;
    expect(text).toMatch(/^PAYMENT REQUIRED \(HTTP 402\)/);
    expect(text).toContain('Paid mode is disabled');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][1]?.headers).not.toHaveProperty('PAYMENT-SIGNATURE');
    await client.close();
  });

  it('GET / describes the endpoint and GET /healthz reports this process only', async () => {
    const { base } = await boot({ MCP_PUBLIC_URL: 'https://mcp.example.test/mcp' });
    const info = await (await fetch(`${base}/`)).json();
    expect(info).toMatchObject({
      transport: 'streamable-http',
      stateless: true,
      mcp_endpoint: 'https://mcp.example.test/mcp',
      paid_mode: false,
      tools: [...TOOL_NAMES],
      endpoint_count: CATALOG.count,
      version: SERVER_VERSION,
    });
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok', paid_mode: false, endpoint_count: CATALOG.count });
    const head = await fetch(`${base}/healthz`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('answers CORS preflight and sets CORS headers in free mode', async () => {
    const { base } = await boot();
    const pre = await fetch(`${base}/mcp`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, mcp-protocol-version' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    expect(pre.headers.get('access-control-allow-methods')).toContain('POST');
    expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('mcp-protocol-version');

    const res = await rawPost(base, INIT, { Origin: 'https://claude.ai' });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects Host headers outside the allowlist (DNS rebinding) and accepts allowlisted ones', async () => {
    // fetch() treats Host as a forbidden header and silently sends the socket's host
    // instead, so this test uses node:http, which really puts the given Host on the wire.
    const { base, stats } = await boot({ MCP_HTTP_ALLOWED_HOSTS: 'mcp.example.test' });
    expect(await postWithHost(base, 'evil.example')).toBe(403);
    expect(stats.rejected_host).toBe(1);
    expect(await postWithHost(base, 'mcp.example.test')).toBe(200);
    expect(await postWithHost(base, 'MCP.example.test:443')).toBe(200);
    expect(await postWithHost(base, 'localhost')).toBe(200);
    expect(stats.rejected_host).toBe(1);
  });

  it('rate-limits per client IP, keyed on CF-Connecting-IP only when the proxy is trusted', async () => {
    const { base, stats } = await boot({ MCP_HTTP_RATE_LIMIT_PER_MIN: '2', MCP_HTTP_TRUST_PROXY: 'true' });
    const a = { 'CF-Connecting-IP': '203.0.113.1' };
    expect((await rawPost(base, INIT, a)).status).toBe(200);
    expect((await rawPost(base, INIT, a)).status).toBe(200);
    const limited = await rawPost(base, INIT, a);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(stats.rate_limited).toBe(1);
    // A different client is unaffected.
    expect((await rawPost(base, INIT, { 'CF-Connecting-IP': '203.0.113.2' })).status).toBe(200);
  });

  it('ignores CF-Connecting-IP when the proxy is not trusted (header is spoofable)', async () => {
    const { base } = await boot({ MCP_HTTP_RATE_LIMIT_PER_MIN: '1' });
    expect((await rawPost(base, INIT, { 'CF-Connecting-IP': '203.0.113.1' })).status).toBe(200);
    // Rotating the header must not escape the limit: the key is the socket address.
    expect((await rawPost(base, INIT, { 'CF-Connecting-IP': '203.0.113.99' })).status).toBe(429);
  });

  it('enforces the global limit across all clients', async () => {
    const { base } = await boot({ MCP_HTTP_RATE_LIMIT_PER_MIN: '0', MCP_HTTP_GLOBAL_RATE_LIMIT_PER_MIN: '1', MCP_HTTP_TRUST_PROXY: 'true' });
    expect((await rawPost(base, INIT, { 'CF-Connecting-IP': '203.0.113.1' })).status).toBe(200);
    expect((await rawPost(base, INIT, { 'CF-Connecting-IP': '203.0.113.2' })).status).toBe(429);
  });

  it('rejects oversized bodies with 413 and malformed JSON with a parse error', async () => {
    const { base, stats } = await boot({ MCP_HTTP_MAX_BODY_BYTES: '512' });
    const big = await rawPost(base, { ...INIT, padding: 'x'.repeat(2048) });
    expect(big.status).toBe(413);
    expect(stats.too_large).toBe(1);

    const bad = await rawPost(base, '{not json');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
  });

  it('returns 405 for GET/DELETE /mcp (stateless: no SSE stream or session) and 404 elsewhere', async () => {
    const { base } = await boot();
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`${base}/mcp`, { method, headers: { Accept: MCP_ACCEPT } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get('allow')).toContain('POST');
    }
    expect((await fetch(`${base}/admin`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: 'POST' })).status).toBe(405);
  });
});

describe('paid mode over HTTP', () => {
  it('refuses to start on a non-loopback bind or with any public-exposure setting', () => {
    const key = { MERCURY402_PAYER_PRIVATE_KEY: '0x' + '11'.repeat(32) };
    expect(() => assertSafeHttpConfig(testConfig({ ...key, MCP_HTTP_HOST: '0.0.0.0' }))).toThrow(/non-loopback/);
    expect(() => assertSafeHttpConfig(testConfig({ ...key, MCP_HTTP_ALLOWED_HOSTS: 'mcp.mercury402.com' }))).toThrow(/ALLOWED_HOSTS/);
    expect(() => assertSafeHttpConfig(testConfig({ ...key, MCP_HTTP_TRUST_PROXY: 'true' }))).toThrow(/TRUST_PROXY/);
    expect(() => assertSafeHttpConfig(testConfig({ ...key, MCP_PUBLIC_URL: 'https://mcp.mercury402.com/mcp' }))).toThrow(/PUBLIC_URL/);
    expect(() => assertSafeHttpConfig(testConfig({ ...key, MCP_HTTP_ALLOWED_HOSTS: 'localhost' }))).not.toThrow();
    expect(() => assertSafeHttpConfig(testConfig(key))).not.toThrow();
    expect(() => createHttpServer(testConfig({ ...key, MCP_HTTP_TRUST_PROXY: 'true' }))).toThrow(/TRUST_PROXY/);
  });

  it('the shipped hosted PM2 config is free mode and would be refused if a key were added', async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const { apps } = require('../deploy/ecosystem.config.cjs') as { apps: { env: Record<string, string>; args: string }[] };
    expect(apps).toHaveLength(1);
    const env = apps[0].env;
    expect(env.MERCURY402_PAYER_PRIVATE_KEY).toBeUndefined();
    expect(apps[0].args).toBe('--http');
    expect(env.MCP_HTTP_HOST).toBe('127.0.0.1');
    expect(() => assertSafeHttpConfig(testConfig(env))).not.toThrow();
    expect(() => assertSafeHttpConfig(testConfig({ ...env, MERCURY402_PAYER_PRIVATE_KEY: '0x' + '11'.repeat(32) }))).toThrow();
  });

  it('refuses browser (Origin) requests and sends no CORS headers on loopback paid mode', async () => {
    const { base, stats } = await boot({}, { deps: { payer: fakePayer(), fetch: mockFetch() } });
    const browser = await rawPost(base, INIT, { Origin: 'https://evil.example' });
    expect(browser.status).toBe(403);
    expect(browser.headers.get('access-control-allow-origin')).toBeNull();
    expect(stats.rejected_origin).toBe(1);

    const local = await rawPost(base, INIT);
    expect(local.status).toBe(200);
    expect(local.headers.get('access-control-allow-origin')).toBeNull();
    expect((await (await fetch(`${base}/`)).json()).paid_mode).toBe(true);
  });
});

describe('http helpers', () => {
  it('hostnameOf strips the port and lowercases, including IPv6 literals', () => {
    expect(hostnameOf('MCP.Mercury402.com:443')).toBe('mcp.mercury402.com');
    expect(hostnameOf('[::1]:3402')).toBe('[::1]');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf(undefined)).toBe('');
  });

  it('FixedWindowLimiter allows `limit` hits per window, then reports seconds until reset', () => {
    let t = 0;
    const lim = new FixedWindowLimiter(2, 60_000, () => t);
    expect(lim.take('a')).toBe(0);
    expect(lim.take('a')).toBe(0);
    expect(lim.take('a')).toBe(60);
    t = 45_000;
    expect(lim.take('a')).toBe(15);
    t = 60_000;
    expect(lim.take('a')).toBe(0);
    expect(new FixedWindowLimiter(0).take('x')).toBe(0);
  });

  it('FixedWindowLimiter stays bounded when flooded with distinct keys', () => {
    let t = 0;
    const lim = new FixedWindowLimiter(1, 60_000, () => t, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) expect(lim.take(k)).toBe(0);
    t = 61_000;
    expect(lim.take('f')).toBe(0);
  });

  it('clientIp uses CF-Connecting-IP only when trusted and never X-Forwarded-For', () => {
    const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '127.0.0.1' } }) as never;
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.9' }), true)).toBe('203.0.113.9');
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.9' }), false)).toBe('127.0.0.1');
    expect(clientIp(req({ 'x-forwarded-for': '198.51.100.1' }), true)).toBe('127.0.0.1');
  });
});
