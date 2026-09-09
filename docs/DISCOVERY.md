# Mercury402 discovery checklist

## Live
- /.well-known/x402 — 78 accepts
- /openapi.json — 78 /v1 paths
- https://www.x402scan.com/server/mercury402 — 200
- src/mcp-mercury.js MCP stdio (6 tools)

## Manual next steps
1. MCP Registry: search mercury402 is empty (ignore unrelated mercuryx402/mercury-x402-mcp). Publish with server.json + publisher CLI when ready.
2. PayAPI: search empty. List at https://payapi.market/list yourself — API https://api.mercury402.com , discovery /.well-known/x402 , OpenAPI /openapi.json , fresh Base USDC receive wallet. Do not send wallet/API via cold Outlook email.
3. x402scan: refresh metadata if endpoint counts look stale.
