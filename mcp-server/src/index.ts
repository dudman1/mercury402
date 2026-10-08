#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig, type Config } from './config.js';
import { createHttpServer } from './http.js';
import { createMercuryServer } from './server.js';

// stdout carries the MCP protocol in stdio mode: log to stderr only, and never log config values.
function log(msg: string): void {
  process.stderr.write(`[mercury402-mcp] ${msg}\n`);
}

async function startHttp(config: Config): Promise<void> {
  const { server } = createHttpServer(config, { log });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.httpPort, config.httpHost, resolve);
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : config.httpPort;
  const hosts = ['loopback', ...config.httpAllowedHosts].join(', ');
  const perIp = config.httpRateLimitPerMin ? `${config.httpRateLimitPerMin}/min per IP${config.httpTrustProxy ? ' (CF-Connecting-IP)' : ''}` : 'no per-IP limit';
  const total = config.httpGlobalRateLimitPerMin ? `${config.httpGlobalRateLimitPerMin}/min total` : 'no global limit';
  log(`streamable HTTP listening on http://${config.httpHost}:${port}/mcp; hosts: ${hosts}; ${perIp}, ${total}`);

  // PM2 wait_ready: report "online" only once the port is bound.
  if (typeof process.send === 'function') process.send('ready');

  // PM2 6.x stops apps with SIGINT, not SIGTERM: handle both. Requests are short (stateless JSON).
  const shutdown = (signal: string) => {
    log(`${signal} received, closing HTTP server`);
    server.close(() => process.exit(0));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

async function main(): Promise<void> {
  const config = loadConfig();
  log(`API ${config.apiUrl}; paid mode ${config.payerPrivateKey ? `ENABLED (max $${config.maxPriceUsd}/call)` : 'disabled'}`);
  if (process.argv.includes('--http')) {
    await startHttp(config);
    return;
  }
  const server = createMercuryServer(config);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  log(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
