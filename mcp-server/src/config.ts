export interface Config {
  apiUrl: string;
  /** Present only when paid mode is enabled. Never log or return this value. */
  payerPrivateKey?: string;
  maxPriceUsd: number;
  timeoutMs: number;
  httpHost: string;
  httpPort: number;
}

export const DEFAULT_API_URL = 'https://api.mercury402.com';

function num(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const key = env.MERCURY402_PAYER_PRIVATE_KEY?.trim();
  return {
    apiUrl: (env.MERCURY402_API_URL?.trim() || DEFAULT_API_URL).replace(/\/+$/, ''),
    payerPrivateKey: key ? key : undefined,
    maxPriceUsd: num(env.MERCURY402_MAX_PRICE_USD, 0.5, 'MERCURY402_MAX_PRICE_USD'),
    timeoutMs: num(env.MERCURY402_TIMEOUT_MS, 60_000, 'MERCURY402_TIMEOUT_MS'),
    httpHost: env.MCP_HTTP_HOST?.trim() || '127.0.0.1',
    httpPort: num(env.MCP_HTTP_PORT, 3402, 'MCP_HTTP_PORT'),
  };
}
