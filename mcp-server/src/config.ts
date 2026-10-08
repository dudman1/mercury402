export interface Config {
  apiUrl: string;
  /** Present only when paid mode is enabled. Never log or return this value. */
  payerPrivateKey?: string;
  maxPriceUsd: number;
  timeoutMs: number;
  httpHost: string;
  httpPort: number;
  /** Extra Host header values accepted over HTTP (loopback names are always accepted). */
  httpAllowedHosts: string[];
  /** Trust CF-Connecting-IP / X-Forwarded-For for the client IP (only behind a proxy such as cloudflared). */
  httpTrustProxy: boolean;
  /** Per-client-IP requests per minute on /mcp. 0 disables. */
  httpRateLimitPerMin: number;
  /** Requests per minute on /mcp across all clients. 0 disables. */
  httpGlobalRateLimitPerMin: number;
  /** Largest accepted /mcp request body, in bytes. */
  httpMaxBodyBytes: number;
  /** Public URL of the /mcp endpoint, advertised by GET / (e.g. https://mcp.mercury402.com/mcp). */
  publicUrl?: string;
}

export const DEFAULT_API_URL = 'https://api.mercury402.com';

function num(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

function bool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const v = value.trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  throw new Error(`${name} must be true or false`);
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.MERCURY402_PAYER_PRIVATE_KEY?.trim();
  const publicUrl = env.MCP_PUBLIC_URL?.trim();
  return {
    apiUrl: (env.MERCURY402_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ''),
    payerPrivateKey: key ? key : undefined,
    maxPriceUsd: num(env.MERCURY402_MAX_PRICE_USD, 0.5, 'MERCURY402_MAX_PRICE_USD'),
    timeoutMs: num(env.MERCURY402_TIMEOUT_MS, 60_000, 'MERCURY402_TIMEOUT_MS'),
    httpHost: env.MCP_HTTP_HOST?.trim() || '127.0.0.1',
    httpPort: num(env.MCP_HTTP_PORT, 3402, 'MCP_HTTP_PORT'),
    httpAllowedHosts: list(env.MCP_HTTP_ALLOWED_HOSTS),
    httpTrustProxy: bool(env.MCP_HTTP_TRUST_PROXY, false, 'MCP_HTTP_TRUST_PROXY'),
    httpRateLimitPerMin: num(env.MCP_HTTP_RATE_LIMIT_PER_MIN, 60, 'MCP_HTTP_RATE_LIMIT_PER_MIN'),
    httpGlobalRateLimitPerMin: num(env.MCP_HTTP_GLOBAL_RATE_LIMIT_PER_MIN, 600, 'MCP_HTTP_GLOBAL_RATE_LIMIT_PER_MIN'),
    httpMaxBodyBytes: num(env.MCP_HTTP_MAX_BODY_BYTES, 64 * 1024, 'MCP_HTTP_MAX_BODY_BYTES'),
    publicUrl: publicUrl ? publicUrl : undefined,
  };
}
