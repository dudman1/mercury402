// Caller-facing payment text depends on whether the server is publicly exposed.
// Local (stdio, loopback HTTP): unchanged from v0.1.2, including the hint to set
// MERCURY402_PAYER_PRIVATE_KEY. Hosted (any public-exposure setting): the server refuses
// to boot with a key and remote callers can't set its env, so it must not suggest that.
// The local strings below are literals copied from v0.1.2 on purpose: if the exported
// constants drift, these tests fail instead of following them.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeHttpConfig, createHttpServer, publicExposure } from '../src/http.js';
import { connect, make402, mockFetch, payload, testConfig } from './helpers.js';

const V012_REASON = 'Payment required. Paid mode is disabled (MERCURY402_PAYER_PRIVATE_KEY not set).';
const V012_HOW_TO_PAY = [
  'Mercury402 uses the x402 protocol: pay per call in USDC on Base (chain id 8453).',
  'Sign an EIP-3009 transferWithAuthorization for the quoted amount to pay_to, base64-encode an x402 PaymentPayload, and resend the same request with a PAYMENT-SIGNATURE header. Any x402-compatible client/wallet can do this.',
  'Or enable paid mode in this MCP server: set MERCURY402_PAYER_PRIVATE_KEY to a funded Base hot wallet (and optionally MERCURY402_MAX_PRICE_USD), then call get_endpoint_data again.',
];
const V012_DESCRIPTION =
  'Call a Mercury402 endpoint on the live API. Without paid mode, endpoints return HTTP 402 and this tool returns ' +
  'the price and x402 payment instructions instead of data. With paid mode enabled (MERCURY402_PAYER_PRIVATE_KEY), ' +
  'it pays in USDC on Base (capped by MERCURY402_MAX_PRICE_USD) and returns the data. ' +
  'Use list_endpoints first to find paths and parameters. Path params can be inline ("/v1/fred/UNRATE") or passed in params ' +
  '("/v1/fred/{series_id}" + {"series_id":"UNRATE"}). Other params go to the query string (GET) or JSON body (POST).';
const V012_PAY_PARAM = 'Paid mode only: set false to just get the price quote without paying. Default true.';

const HOSTED_REASON = 'Payment required. This hosted endpoint is discovery-only and never pays on your behalf.';
const HOSTED_LOCAL_INSTALL_HINT =
  'To pay automatically, run mercury402-mcp locally (npx -y mercury402-mcp) with MERCURY402_PAYER_PRIVATE_KEY set to a funded Base hot wallet you control.';

/** Every setting the boot guard treats as public exposure, one at a time. */
const EXPOSURES: Record<string, Record<string, string>> = {
  'non-loopback bind': { MCP_HTTP_HOST: '0.0.0.0' },
  'public allowed host': { MCP_HTTP_ALLOWED_HOSTS: 'mcp.example.test' },
  'trust proxy': { MCP_HTTP_TRUST_PROXY: 'true' },
  'public URL': { MCP_PUBLIC_URL: 'https://mcp.example.test/mcp' },
};

let servers: Server[] = [];
let clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
  clients = [];
});

/** Boots the HTTP server on an ephemeral loopback port. The bind is fixed to 127.0.0.1; env only shapes the config. */
async function httpClient(env: Record<string, string>, fetch = mockFetch(make402('/v1/fred/UNRATE', 0.05))) {
  const { server } = createHttpServer(testConfig({ MCP_HTTP_PORT: '0', ...env }), { deps: { fetch } });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const client = new Client({ name: 'hosted-402-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`)));
  clients.push(client);
  return client;
}

async function call402(client: Client) {
  const res = (await client.callTool({ name: 'get_endpoint_data', arguments: { path: '/v1/fred/UNRATE' } })) as CallToolResult;
  const text = (res.content[0] as { text: string }).text;
  return { text, body: payload(text) };
}

async function getEndpointDataTool(client: Client): Promise<Tool> {
  return (await client.listTools()).tools.find((t) => t.name === 'get_endpoint_data')!;
}

describe('publicExposure() is the boot guard predicate', () => {
  it('is undefined for the default loopback config and for loopback allowed hosts', () => {
    expect(publicExposure(testConfig())).toBeUndefined();
    expect(publicExposure(testConfig({ MCP_HTTP_ALLOWED_HOSTS: 'localhost,127.0.0.1' }))).toBeUndefined();
  });

  it.each(Object.entries(EXPOSURES))('detects %s, and the paid-mode guard refuses exactly then', (_, env) => {
    const config = testConfig(env);
    expect(publicExposure(config)).toBeDefined();
    expect(() => assertSafeHttpConfig(config, true)).toThrow(/Refusing to serve paid mode/);
    expect(() => assertSafeHttpConfig(testConfig(), true)).not.toThrow();
  });
});

describe('local mode (stdio and loopback HTTP): unchanged from v0.1.2', () => {
  it('stdio: 402 reason, how_to_pay and tool description are byte-identical', async () => {
    const session = await connect(testConfig(), { fetch: mockFetch(make402('/v1/fred/UNRATE', 0.05)) });
    try {
      const tool = (await session.client.listTools()).tools.find((t) => t.name === 'get_endpoint_data')!;
      expect(tool.description).toBe(V012_DESCRIPTION);
      const { text } = await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE' });
      const body = payload(text);
      expect(body.reason).toBe(V012_REASON);
      expect(body.how_to_pay).toEqual(V012_HOW_TO_PAY);
      expect(text).toContain(`. ${V012_REASON}\n\n`);
    } finally {
      await session.close();
    }
  });

  it('loopback HTTP: same strings as stdio', async () => {
    const client = await httpClient({});
    expect((await getEndpointDataTool(client)).description).toBe(V012_DESCRIPTION);
    const { body } = await call402(client);
    expect(body.reason).toBe(V012_REASON);
    expect(body.how_to_pay).toEqual(V012_HOW_TO_PAY);
  });
});

describe('hosted mode (any public-exposure setting): never suggests enabling paid mode here', () => {
  it.each(Object.entries(EXPOSURES).filter(([k]) => k !== 'non-loopback bind'))(
    '%s: 402 reason and how_to_pay use hosted wording',
    async (_, env) => {
      const client = await httpClient(env);
      const { text, body } = await call402(client);
      expect(body.reason).toBe(HOSTED_REASON);
      expect(body.how_to_pay).toEqual([V012_HOW_TO_PAY[0], V012_HOW_TO_PAY[1], HOSTED_LOCAL_INSTALL_HINT]);
      expect(text).not.toContain('MERCURY402_PAYER_PRIVATE_KEY not set');
      expect(text).not.toContain('in this MCP server');
      expect(text).toContain(`. ${HOSTED_REASON}\n\n`);
    },
  );

  it('non-loopback bind setting also switches to hosted wording', async () => {
    // The server is still bound to 127.0.0.1 by httpClient(); only the config says 0.0.0.0.
    const { body } = await call402(await httpClient(EXPOSURES['non-loopback bind']));
    expect(body.reason).toBe(HOSTED_REASON);
  });

  it('tool description drops the enable-paid-mode sentence and points to own x402 client or a local install', async () => {
    const client = await httpClient(EXPOSURES['public URL']);
    const description = (await getEndpointDataTool(client)).description!;
    expect(description).not.toContain('in this MCP server');
    expect(description).not.toContain('With paid mode enabled');
    expect(description).not.toContain('MERCURY402_PAYER_PRIVATE_KEY');
    expect(description).toContain('returns the price and x402 payment instructions');
    expect(description).toContain('your own x402 client');
    expect(description).toContain('npx -y mercury402-mcp');
    // The usage guidance is shared with local mode.
    expect(description.endsWith('Other params go to the query string (GET) or JSON body (POST).')).toBe(true);
  });

  it('keeps the input schema identical to local mode, including the pay param', async () => {
    const local = await getEndpointDataTool(await httpClient({}));
    const hosted = await getEndpointDataTool(await httpClient(EXPOSURES['trust proxy']));
    expect(hosted.inputSchema).toEqual(local.inputSchema);
    expect(Object.keys(hosted.inputSchema.properties ?? {}).sort()).toEqual(['params', 'path', 'pay']);
    expect((hosted.inputSchema.properties as Record<string, { description?: string }>).pay.description).toBe(V012_PAY_PARAM);
  });

  it('leaves the quote, options and raw body untouched', async () => {
    const local = (await call402(await httpClient({}))).body;
    const hosted = (await call402(await httpClient(EXPOSURES['public allowed host']))).body;
    for (const key of ['status', 'http_status', 'url', 'quote', 'all_options', 'raw_body'] as const) {
      expect(hosted[key], key).toEqual(local[key]);
    }
  });
});
