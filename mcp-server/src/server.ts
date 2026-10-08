import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CATALOG, resolveRequest, type Catalog, type ParamValue } from './catalog.js';
import { MercuryClient, type CallResult, type FetchFn } from './client.js';
import type { Config } from './config.js';
import { createEvmPayer, type Payer } from './payment.js';

export const SERVER_NAME = 'mercury402';
export const SERVER_VERSION = '0.1.3';

export interface ServerDeps {
  fetch?: FetchFn;
  /** Overrides the payer built from config.payerPrivateKey (used by tests). */
  payer?: Payer;
  catalog?: Catalog;
}

export interface ServerOptions {
  /**
   * The server is publicly exposed (publicExposure() in http.ts): callers cannot enable paid
   * mode here, so tool text and 402 hints point them to their own x402 client or a local install.
   */
  hosted?: boolean;
}

const GET_ENDPOINT_DATA_USAGE =
  'Use list_endpoints first to find paths and parameters. Path params can be inline ("/v1/fred/UNRATE") or passed in params ' +
  '("/v1/fred/{series_id}" + {"series_id":"UNRATE"}). Other params go to the query string (GET) or JSON body (POST).';

export const LOCAL_GET_ENDPOINT_DATA_DESCRIPTION =
  'Call a Mercury402 endpoint on the live API. Without paid mode, endpoints return HTTP 402 and this tool returns ' +
  'the price and x402 payment instructions instead of data. With paid mode enabled (MERCURY402_PAYER_PRIVATE_KEY), ' +
  'it pays in USDC on Base (capped by MERCURY402_MAX_PRICE_USD) and returns the data. ' +
  GET_ENDPOINT_DATA_USAGE;

export const HOSTED_GET_ENDPOINT_DATA_DESCRIPTION =
  'Call a Mercury402 endpoint on the live API. This hosted endpoint is discovery-only: endpoints return HTTP 402 and this ' +
  'tool returns the price and x402 payment instructions instead of data. Pay with your own x402 client, or run ' +
  'mercury402-mcp locally (npx -y mercury402-mcp) with your own wallet. ' +
  GET_ENDPOINT_DATA_USAGE;

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function formatCallResult(result: CallResult): CallToolResult {
  switch (result.status) {
    case 'ok': {
      const paid = result.payment ? ` Paid $${result.payment.price_usd} from ${result.payment.payer}.` : '';
      return textResult(`OK (HTTP ${result.http_status}) ${result.url}.${paid}\n\n${json(result)}`);
    }
    case 'payment_required': {
      const q = result.quote;
      const price = q ? `$${q.price_usd} (${q.amount_usdc_atomic} USDC atomic units on ${q.network}, pay to ${q.pay_to})` : 'unknown price';
      return textResult(`PAYMENT REQUIRED (HTTP 402) for ${result.url}: ${price}. ${result.reason}\n\n${json(result)}`);
    }
    case 'error':
      return textResult(`ERROR (HTTP ${result.http_status}) ${result.url}\n\n${json(result)}`, true);
  }
}

export function createMercuryServer(config: Config, deps: ServerDeps = {}, options: ServerOptions = {}): McpServer {
  const catalog = deps.catalog ?? CATALOG;
  const payer = deps.payer ?? (config.payerPrivateKey ? createEvmPayer(config.payerPrivateKey) : undefined);
  const client = new MercuryClient({
    apiUrl: config.apiUrl,
    fetch: deps.fetch,
    payer,
    maxPriceUsd: config.maxPriceUsd,
    timeoutMs: config.timeoutMs,
    hosted: options.hosted,
  });
  const categories = [...new Set(catalog.endpoints.map((e) => e.category))].sort();

  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'list_endpoints',
    {
      title: 'List Mercury402 endpoints',
      description:
        `List Mercury402 financial data endpoints (${catalog.count} total) with path, method, category, description, ` +
        'price in USD (paid per call in USDC on Base via x402) and accepted parameters. Free; makes no network calls.',
      inputSchema: {
        category: z.enum(categories as [string, ...string[]]).optional().describe('Only return this category'),
        search: z.string().optional().describe('Case-insensitive substring match on path or description'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ category, search }) => {
      const needle = search?.toLowerCase();
      const endpoints = catalog.endpoints.filter(
        (e) =>
          (!category || e.category === category) &&
          (!needle || e.path.toLowerCase().includes(needle) || e.description.toLowerCase().includes(needle)),
      );
      return textResult(
        json({
          api_url: config.apiUrl,
          payment: catalog.payment,
          paid_mode: client.paidModeEnabled
            ? { enabled: true, payer: payer!.address, max_price_usd: config.maxPriceUsd }
            : { enabled: false },
          categories,
          count: endpoints.length,
          endpoints,
        }),
      );
    },
  );

  server.registerTool(
    'get_endpoint_data',
    {
      title: 'Call a Mercury402 endpoint',
      description: options.hosted ? HOSTED_GET_ENDPOINT_DATA_DESCRIPTION : LOCAL_GET_ENDPOINT_DATA_DESCRIPTION,
      inputSchema: {
        path: z.string().describe('Endpoint path, e.g. "/v1/treasury/yield-curve/daily-snapshot" or "/v1/fred/UNRATE"'),
        params: z
          .record(z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
          .optional()
          .describe('Path, query (GET) or body (POST) parameters'),
        pay: z
          .boolean()
          .optional()
          .describe('Paid mode only: set false to just get the price quote without paying. Default true.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false },
    },
    async ({ path, params, pay }) => {
      let resolved;
      try {
        resolved = resolveRequest(path, (params ?? {}) as Record<string, ParamValue>, catalog);
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
      try {
        return formatCallResult(await client.call(resolved, pay ?? true));
      } catch (err) {
        return textResult(`Request to ${client.buildUrl(resolved)} failed: ${err instanceof Error ? err.message : String(err)}`, true);
      }
    },
  );

  return server;
}
