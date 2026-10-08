// PM2 config for the hosted MCP endpoint https://mcp.mercury402.com/mcp (free discovery mode).
//
// Runs from a DEDICATED runtime checkout pinned to a release tag, never from the
// production API checkout (~/mercury-x402-service). Setup and release steps:
// mcp-server/deploy/HOSTED.md.
//
//   pm2 start /Users/openclaw/mercury402-mcp-runtime/mcp-server/deploy/ecosystem.config.cjs
//
// Paid mode stays OFF. Never add MERCURY402_PAYER_PRIVATE_KEY here: the endpoint is
// public and has no auth. The server also refuses to start with a key while
// MCP_HTTP_TRUST_PROXY, MCP_PUBLIC_URL or a public MCP_HTTP_ALLOWED_HOSTS entry is set.
//
// The /Users/openclaw paths match ecosystem.config.js at the repo root.

module.exports = {
  apps: [
    {
      name: 'mercury402-mcp',
      cwd: '/Users/openclaw/mercury402-mcp-runtime/mcp-server',
      script: 'dist/index.js',
      args: '--http',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        // Loopback only: cloudflared is the one public path in.
        MCP_HTTP_HOST: '127.0.0.1',
        MCP_HTTP_PORT: '3402',
        // cloudflared forwards the original Host header.
        MCP_HTTP_ALLOWED_HOSTS: 'mcp.mercury402.com',
        // Every connection arrives from cloudflared on 127.0.0.1; rate-limit on CF-Connecting-IP.
        MCP_HTTP_TRUST_PROXY: 'true',
        MCP_HTTP_RATE_LIMIT_PER_MIN: '60',
        MCP_HTTP_GLOBAL_RATE_LIMIT_PER_MIN: '600',
        MCP_HTTP_MAX_BODY_BYTES: '65536',
        MCP_PUBLIC_URL: 'https://mcp.mercury402.com/mcp',
        // Public URL on purpose: tool results show callers URLs they can pay against.
        MERCURY402_API_URL: 'https://api.mercury402.com',
        MERCURY402_TIMEOUT_MS: '30000',
      },
      // index.js calls process.send('ready') once the port is bound.
      wait_ready: true,
      listen_timeout: 15000,
      max_restarts: 10,
      restart_delay: 5000,
      min_uptime: 5000,
      // index.js handles SIGINT (PM2 6.x) and exits within 5s.
      kill_timeout: 6000,
      out_file: '/Users/openclaw/.pm2/logs/mercury402-mcp-out.log',
      error_file: '/Users/openclaw/.pm2/logs/mercury402-mcp-error.log',
      merge_logs: true,
      watch: false,
      autorestart: true,
    },
  ],
};
