# Mercury402 MCP: install for Cline

Mercury402 provides Treasury/FRED financial data over x402: 78 pay-per-call US financial data endpoints. The
default setup needs no signup, no API key and no wallet. It lists endpoints and returns price quotes, and it
never spends money.

## Option A: local stdio (recommended, no secrets)

Add to Cline's MCP settings (`cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "mercury402": {
      "command": "npx",
      "args": ["-y", "mercury402-mcp"]
    }
  }
}
```

Node.js 20.10 or newer is required. There is nothing to clone or build. To check it worked, list the tools: you
should see `list_endpoints` and `get_endpoint_data`.

## Option B: hosted remote (nothing to install, no auth)

```json
{
  "mcpServers": {
    "mercury402": {
      "type": "streamableHttp",
      "url": "https://mcp.mercury402.com/mcp"
    }
  }
}
```

Keep `"type": "streamableHttp"`. Cline defaults to the legacy `sse` transport when `type` is omitted. The hosted
endpoint is discovery-only. It lists all 78 endpoints with prices, and `get_endpoint_data` returns the HTTP 402
quote plus payment instructions. It never pays and never returns paid data.

## What the tools do

- `list_endpoints`: all 78 endpoints with path, method, category, description, price in USD and parameters.
  Optional `category` and `search` filters. Read-only and costs nothing.
- `get_endpoint_data`: calls `https://api.mercury402.com`. Arguments: `path` (a catalog path, e.g.
  `/v1/breakeven/10y`), `params` (path, query or body fields), and `pay` (paid mode only; `false` returns the quote
  without paying).

## Smoke test

Call `get_endpoint_data` with:

```json
{ "path": "/v1/breakeven/10y" }
```

In the default setup, a successful result is `status: payment_required` with `price_usd` 0.05 and the x402
payment instructions. That is the expected result, not an error.

## Do not ask the user for a private key

Paid mode is optional and off by default. Only if the user explicitly asks for it, add
`MERCURY402_PAYER_PRIVATE_KEY` (a dedicated low-balance USDC-on-Base wallet) and optionally
`MERCURY402_MAX_PRICE_USD` (per-call cap, default 0.50) as `env` values in their own Cline settings. The key is
stored in plaintext there. Never print, echo, log or commit it, and never put it in a project file that might be
committed.

More: https://github.com/dudman1/mercury402/tree/master/mcp-server · full API description:
https://api.mercury402.com/llms.txt
