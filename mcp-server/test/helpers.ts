import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { vi } from 'vitest';
import type { FetchFn } from '../src/client.js';
import { loadConfig, type Config } from '../src/config.js';
import { BASE_USDC, type Payer } from '../src/payment.js';
import { createMercuryServer } from '../src/server.js';

export const MERCHANT = '0x1111111111111111111111111111111111111111';
export const API = 'https://api.test.mercury402';

/** Builds a 402 response shaped exactly like src/server.js require402Payment(). */
export function make402(resolvedPath: string, priceUsd: number, method = 'GET', overrides: Record<string, unknown> = {}): Response {
  const amount = String(Math.floor(priceUsd * 1_000_000));
  const v2 = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount,
        payTo: MERCHANT,
        maxTimeoutSeconds: 30,
        asset: BASE_USDC,
        extra: { name: 'USD Coin', version: '2' },
        ...overrides,
      },
    ],
    resource: { url: `https://api.mercury402.com${resolvedPath}`, method, description: 'Deterministic financial data from official sources', mimeType: 'application/json' },
  };
  const header = Buffer.from(JSON.stringify(v2)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const v1Body = {
    x402Version: 1,
    error: 'payment required',
    accepts: [
      {
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: amount,
        resource: `https://api.mercury402.com${resolvedPath}`,
        description: 'Federal Reserve Economic Data (FRED) series',
        mimeType: 'application/json',
        payTo: MERCHANT,
        maxTimeoutSeconds: 30,
        asset: BASE_USDC,
        extra: { name: 'USD Coin', version: '2' },
        ...overrides,
      },
    ],
  };
  return new Response(JSON.stringify(v1Body), {
    status: 402,
    headers: { 'Content-Type': 'application/json', 'Payment-Required': header },
  });
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export type MockFetch = ReturnType<typeof vi.fn<FetchFn>>;

export function mockFetch(...responses: Response[]): MockFetch {
  const fn = vi.fn<FetchFn>();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  fn.mockRejectedValue(new Error('unexpected extra fetch call'));
  return fn;
}

export function testConfig(env: Record<string, string> = {}): Config {
  return loadConfig({ MERCURY402_API_URL: API, ...env });
}

export function fakePayer(): Payer & { createPaymentHeader: ReturnType<typeof vi.fn> } {
  return {
    address: '0x2222222222222222222222222222222222222222',
    createPaymentHeader: vi.fn(async () => 'FAKE_PAYMENT_HEADER'),
  };
}

export async function connect(config: Config, deps: Parameters<typeof createMercuryServer>[1] = {}) {
  const server = createMercuryServer(config, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    async call(name: string, args: Record<string, unknown> = {}) {
      const res = (await client.callTool({ name, arguments: args })) as CallToolResult;
      const text = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      return { res, text };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Extracts the JSON document that follows the one-line summary in a tool result. */
export function payload(text: string): any {
  const i = text.indexOf('{');
  return JSON.parse(text.slice(i));
}
