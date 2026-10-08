#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig, type Config } from './config.js';
import { createMercuryServer } from './server.js';

// stdout carries the MCP protocol in stdio mode: log to stderr only, and never log config values.
function log(msg: string): void {
  process.stderr.write(`[mercury402-mcp] ${msg}\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : undefined;
}

// Stateless streamable HTTP: a fresh server + transport per request.
async function startHttp(config: Config): Promise<void> {
  // The HTTP endpoint has no auth: anyone who can reach it could spend the payer wallet.
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(config.httpHost);
  if (config.payerPrivateKey && !loopback) {
    throw new Error('Refusing to serve paid mode over HTTP on a non-loopback host (MCP_HTTP_HOST). Use stdio or 127.0.0.1.');
  }
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    try {
      const body = await readJson(req);
      const server = createMercuryServer(config);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      log(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Bad request' }, id: null }));
    }
  });
  await new Promise<void>((resolve) => http.listen(config.httpPort, config.httpHost, resolve));
  log(`streamable HTTP listening on http://${config.httpHost}:${config.httpPort}/mcp`);
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
