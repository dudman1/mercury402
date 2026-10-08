# Mercury402 MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets Claude and other MCP clients discover and call
[Mercury402](https://mercury402.com)'s pay-per-call financial data API: Treasury yields, FRED series, forex,
yield spreads, breakeven inflation, macro bundles, composites and AI briefings.

Mercury402 is paid per call with [x402](https://x402.org): an unpaid request returns HTTP 402 with a payment
descriptor; the client pays USDC on Base and gets JSON back.

- **Default (free) mode:** browse all endpoints and prices; calling an endpoint returns the price and payment
  instructions from the 402. No wallet, no spending.
- **Paid mode (opt-in):** set `MERCURY402_PAYER_PRIVATE_KEY` and the server pays the 402 (USDC on Base,
  capped per call) and returns the data.

## Tools

| Tool | What it does | Network | Spends money |
|---|---|---|---|
| `list_endpoints` | Lists all 78 endpoints: path, method, category, description, price (USD), parameters. Optional `category` and `search` filters. | No | No |
| `get_endpoint_data` | Calls an endpoint on the live API. Returns the data, or the 402 quote + how to pay. | Yes | Only in paid mode |

### `get_endpoint_data` arguments

| Arg | Type | Notes |
|---|---|---|
| `path` | string | Catalog path. Path params inline (`/v1/fred/UNRATE`) or as a template (`/v1/fred/{series_id}`) |
| `params` | object | Path params, plus query params (GET) or JSON body fields (POST) |
| `pay` | boolean | Paid mode only. `false` = return the quote without paying. Default `true` |

Only paths in the catalog can be called; anything else is rejected before a request is made.

## Install

Requires Node.js 20.10+.

```bash
git clone https://github.com/dudman1/mercury402.git
cd mercury402/mcp-server
npm install
npm run build
```

## Configure your client

### Claude Code

```bash
claude mcp add mercury402 -- node /absolute/path/to/mercury402/mcp-server/dist/index.js
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mercury402": {
      "command": "node",
      "args": ["/absolute/path/to/mercury402/mcp-server/dist/index.js"]
    }
  }
}
```

Paid mode — add an `env` block (use a dedicated hot wallet holding only a small USDC balance on Base):

```json
{
  "mcpServers": {
    "mercury402": {
      "command": "node",
      "args": ["/absolute/path/to/mercury402/mcp-server/dist/index.js"],
      "env": {
        "MERCURY402_PAYER_PRIVATE_KEY": "<your hot-wallet private key>",
        "MERCURY402_MAX_PRICE_USD": "0.50"
      }
    }
  }
}
```

### Streamable HTTP (optional)

```bash
npm run start:http          # http://127.0.0.1:3402/mcp (stateless, JSON responses)
```

The HTTP endpoint has no authentication. It binds to `127.0.0.1` by default, and the server refuses to start
in paid mode on a non-loopback `MCP_HTTP_HOST`.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MERCURY402_API_URL` | `https://api.mercury402.com` | API base URL (`https://mercury402.uk` also works) |
| `MERCURY402_PAYER_PRIVATE_KEY` | unset (paid mode off) | EVM private key of the payer wallet (USDC on Base). Enables paid mode. Never logged or returned by any tool |
| `MERCURY402_MAX_PRICE_USD` | `0.50` | Per-call spending cap. 402 quotes above this are returned, not paid |
| `MERCURY402_TIMEOUT_MS` | `60000` | Per-request timeout (paid calls wait for on-chain settlement) |
| `MCP_HTTP_HOST` / `MCP_HTTP_PORT` | `127.0.0.1` / `3402` | HTTP transport bind address (only with `--http`) |

## Example tool calls

List the Treasury endpoints:

```json
{ "name": "list_endpoints", "arguments": { "category": "treasury" } }
```

Categories: `ai`, `breakeven-inflation`, `composite`, `forex`, `fred`, `macro`, `treasury`, `yield-spread`.

Get a FRED series (free mode returns a quote):

```json
{ "name": "get_endpoint_data", "arguments": { "path": "/v1/fred/UNRATE", "params": { "limit": 12 } } }
```

```text
PAYMENT REQUIRED (HTTP 402) for https://api.mercury402.com/v1/fred/UNRATE?limit=12: $0.05 (50000 USDC atomic units on eip155:8453, pay to 0x…). Payment required. Paid mode is disabled (MERCURY402_PAYER_PRIVATE_KEY not set).
{
  "status": "payment_required",
  "quote": { "price_usd": 0.05, "amount_usdc_atomic": "50000", "network": "eip155:8453", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "pay_to": "0x…", "scheme": "exact", "x402_version": 2 },
  "how_to_pay": ["…"],
  ...
}
```

Historical yield curve (POST, params become the JSON body):

```json
{
  "name": "get_endpoint_data",
  "arguments": {
    "path": "/v1/treasury/yield-curve/historical",
    "params": { "start_date": "2026-07-01", "end_date": "2026-09-30" }
  }
}
```

Ask the data (AI, POST):

```json
{
  "name": "get_endpoint_data",
  "arguments": { "path": "/v1/ai/ask", "params": { "question": "Is inflation cooling?", "series": ["/v1/fred/cpi", "/v1/fred/pce-core"] } }
}
```

Quote only, even in paid mode:

```json
{ "name": "get_endpoint_data", "arguments": { "path": "/v1/composite/economic-dashboard", "pay": false } }
```

In paid mode a successful call returns `status: "ok"`, the endpoint's JSON under `data`, and a `payment` block with
the price, payer address and decoded `PAYMENT-RESPONSE` settlement (transaction hash).

## How paid mode works

1. Request the endpoint; Mercury402 answers 402 with x402 payment requirements. The v1 JSON body
   (`x402Version: 1`, network `base`) is used; the v2 `Payment-Required` header is a fallback.
2. The server picks the `exact` / USDC-on-Base option and checks it: network `base` (or `eip155:8453`), asset = Base
   USDC (`0x8335…2913`), price ≤ `MERCURY402_MAX_PRICE_USD`. Otherwise it returns the quote and does not pay.
3. It signs an EIP-3009 `transferWithAuthorization` for exactly the quoted amount (locally, with a fresh random
   nonce) and resends the request with a `PAYMENT-SIGNATURE` header containing base64 JSON
   `{ x402Version: 2, accepted: <the 402 body's accepts[0]>, payload: { authorization, signature } }`, the same
   shape as `src/mcp-mercury.js` and the shape `require402Payment()` in `src/server.js` verifies. Mercury402 settles
   on-chain and returns the data.
4. Paid requests are never retried automatically, so one tool call can't be charged twice.

Security notes: use a dedicated hot wallet with a small balance; the key is only read from the environment, used
in-process for signing, and never logged, echoed, or included in tool output or errors.

## Pricing notes

- Most endpoints are $0.05; macro bundle/recession probability $0.10; AI briefing $0.10, AI ask $0.15;
  composites $0.40–$0.50.
- `/v1/fred/{series_id}` costs 2× when both `observation_start` and `observation_end` are supplied.
- Invalid FRED series ids and malformed historical date ranges get a free 400 before any 402.

## Development

```bash
npm test                    # vitest; HTTP and payments are mocked, no network, no real transactions
                            # test/server-contract.test.ts also boots ../src/server.js (needs `npm ci` at the
                            # repo root; skipped otherwise) with on-chain settlement stubbed
npm run typecheck
npm run generate:catalog    # regenerate src/catalog.json after changing ../src/pricing.js or routes
```

The endpoint catalog (`src/catalog.json`) is generated from the API source in this repo (`src/pricing.js`,
`src/new-routes.js`, `src/ai-routes.js`, plus descriptions mirrored from `src/server.js`). A test fails if it
drifts from `src/pricing.js`.
