import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CATALOG } from './catalog.js';
import type { Config } from './config.js';
import { createMercuryServer, SERVER_NAME, SERVER_VERSION, type ServerDeps } from './server.js';

// Streamable HTTP transport, stateless: a fresh McpServer + transport per POST /mcp.
// Built to sit behind a reverse proxy (cloudflared) as a public, free-mode endpoint:
// Host allowlist (DNS rebinding), per-IP + global rate limits, a body cap, and CORS
// for browser-based MCP clients. Paid mode is loopback-only and refuses browsers.

/** Bind addresses only the local machine can reach. */
const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1', 'localhost']);
/** Host header names that mean "reached over loopback"; always accepted. */
const LOOPBACK_HOSTNAMES = ['127.0.0.1', 'localhost', '[::1]'];

/** Tools registered by createMercuryServer(), advertised by GET /. Tested against tools/list. */
export const TOOL_NAMES = ['list_endpoints', 'get_endpoint_data'] as const;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

export interface HttpStats {
  mcp_requests: number;
  rate_limited: number;
  rejected_host: number;
  rejected_origin: number;
  too_large: number;
}

export interface HttpServerOptions {
  deps?: ServerDeps;
  /** Clock for the rate limiter (tests). */
  now?: () => number;
  log?: (msg: string) => void;
}

/** Lowercased hostname of a Host header, without the port ("[::1]:3402" -> "[::1]"). */
export function hostnameOf(hostHeader: string | undefined): string {
  const h = (hostHeader ?? '').trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.split(':')[0];
}

/**
 * Paid mode signs payments from a hot wallet, and HTTP has no auth: anyone who can
 * reach the endpoint could spend it. So paid mode is allowed only on a loopback bind
 * that nothing public points at.
 */
export function assertSafeHttpConfig(config: Config, paid = !!config.payerPrivateKey): void {
  if (!paid) return;
  if (!LOOPBACK_BINDS.has(config.httpHost)) {
    throw new Error('Refusing to serve paid mode over HTTP on a non-loopback host (MCP_HTTP_HOST). Use stdio or 127.0.0.1.');
  }
  const publicHost = config.httpAllowedHosts.map(hostnameOf).find((h) => !LOOPBACK_HOSTNAMES.includes(h));
  if (publicHost) {
    throw new Error(`Refusing to serve paid mode with a public MCP_HTTP_ALLOWED_HOSTS entry (${publicHost}): anyone who can reach it could spend the payer wallet.`);
  }
  if (config.httpTrustProxy) {
    throw new Error('Refusing to serve paid mode with MCP_HTTP_TRUST_PROXY: a proxy in front of the server means others can reach it.');
  }
  if (config.publicUrl) {
    throw new Error('Refusing to serve paid mode with MCP_PUBLIC_URL set: a public endpoint must run in free mode.');
  }
}

/** Fixed-window counter per key. take() returns 0 when allowed, else seconds until the window resets. */
export class FixedWindowLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string): number {
    if (this.limit <= 0) return 0;
    const t = this.now();
    let entry = this.hits.get(key);
    if (!entry || t - entry.start >= this.windowMs) {
      if (!entry && this.hits.size >= this.maxKeys) this.prune(t);
      entry = { start: t, count: 0 };
      this.hits.set(key, entry);
    }
    if (entry.count >= this.limit) return Math.max(1, Math.ceil((entry.start + this.windowMs - t) / 1000));
    entry.count++;
    return 0;
  }

  private prune(t: number): void {
    for (const [k, e] of this.hits) if (t - e.start >= this.windowMs) this.hits.delete(k);
    // Still full of live windows: drop them rather than grow without bound. The global limiter still applies.
    if (this.hits.size >= this.maxKeys) this.hits.clear();
  }
}

/**
 * Client IP for rate limiting. Behind cloudflared every connection comes from 127.0.0.1,
 * so with trustProxy the CF-Connecting-IP header (set by Cloudflare's edge) is used.
 * X-Forwarded-For is deliberately ignored: its first entry is client-controlled.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) return cf.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

class BodyTooLargeError extends Error {}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new BodyTooLargeError();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function rpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}

function send(res: ServerResponse, status: number, body: unknown, opts: { head?: boolean; headers?: Record<string, string> } = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...opts.headers });
  res.end(opts.head ? undefined : JSON.stringify(body));
}

export function createHttpServer(config: Config, options: HttpServerOptions = {}): { server: Server; stats: HttpStats } {
  const deps = options.deps ?? {};
  const paid = !!(deps.payer ?? config.payerPrivateKey);
  assertSafeHttpConfig(config, paid);
  const log = options.log ?? (() => {});
  const allowedHosts = new Set([...LOOPBACK_HOSTNAMES, ...config.httpAllowedHosts.map(hostnameOf)]);
  const perIp = new FixedWindowLimiter(config.httpRateLimitPerMin, 60_000, options.now);
  const global = new FixedWindowLimiter(config.httpGlobalRateLimitPerMin, 60_000, options.now);
  const stats: HttpStats = { mcp_requests: 0, rate_limited: 0, rejected_host: 0, rejected_origin: 0, too_large: 0 };

  const info = {
    name: 'mercury402-mcp',
    server: SERVER_NAME,
    version: SERVER_VERSION,
    description: 'MCP server for Mercury402: discover and call pay-per-call financial data endpoints (x402, USDC on Base).',
    transport: 'streamable-http',
    stateless: true,
    mcp_endpoint: config.publicUrl ?? '/mcp',
    paid_mode: paid,
    tools: [...TOOL_NAMES],
    endpoint_count: CATALOG.count,
    api_url: config.apiUrl,
    local_install: 'npx -y mercury402-mcp',
    docs: 'https://github.com/dudman1/mercury402/tree/master/mcp-server#readme',
  };

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const wait = perIp.take(clientIp(req, config.httpTrustProxy)) || global.take('*');
    if (wait > 0) {
      stats.rate_limited++;
      return send(res, 429, rpcError(-32000, 'Too many requests'), { headers: { 'Retry-After': String(wait) } });
    }
    let body: unknown;
    try {
      const raw = await readBody(req, config.httpMaxBodyBytes);
      body = raw ? JSON.parse(raw) : undefined;
    } catch (err) {
      if (err instanceof BodyTooLargeError) {
        stats.too_large++;
        return send(res, 413, rpcError(-32000, `Request body exceeds ${config.httpMaxBodyBytes} bytes`), { headers: { Connection: 'close' } });
      }
      return send(res, 400, rpcError(-32700, 'Parse error'));
    }
    stats.mcp_requests++;
    const server = createMercuryServer(config, deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';

    if (!allowedHosts.has(hostnameOf(req.headers.host))) {
      stats.rejected_host++;
      return send(res, 403, rpcError(-32000, 'Forbidden: Host not allowed'));
    }
    if (paid && req.headers.origin !== undefined) {
      stats.rejected_origin++;
      return send(res, 403, rpcError(-32000, 'Forbidden: browser (Origin) requests are refused in paid mode'));
    }
    if (!paid) for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

    if (path === '/mcp') {
      if (method === 'POST') return handleMcp(req, res);
      if (method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      return send(res, 405, rpcError(-32000, 'Method not allowed: this server is stateless, use POST'), { headers: { Allow: 'POST, OPTIONS' } });
    }
    if (path === '/' || path === '/healthz') {
      if (method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') {
        return send(res, 405, { error: 'method_not_allowed' }, { headers: { Allow: 'GET, HEAD, OPTIONS' } });
      }
      // /healthz never calls the upstream API: it reports this process only.
      const body = path === '/' ? info : { status: 'ok', version: SERVER_VERSION, paid_mode: paid, endpoint_count: CATALOG.count, stats };
      return send(res, 200, body, { head: method === 'HEAD' });
    }
    return send(res, 404, { error: 'not_found', mcp_endpoint: '/mcp' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) send(res, 500, rpcError(-32603, 'Internal error'));
      else res.end();
    });
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = config.timeoutMs + 30_000;
  return { server, stats };
}
