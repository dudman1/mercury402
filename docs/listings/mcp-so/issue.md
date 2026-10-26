# mcp.so: submission drafts

Research: RESEARCH.md, mcp.so section. Steps and order: SUBMIT.md, mcp.so item. Two routes, both draft-only.
Nothing has been filed.

## Route 1: web form, https://mcp.so/submit

Needs an mcp.so login. The page shows a $39 "Paid submission" card ("Publish immediately without review").
A free path exists in the site's JS (`submit_free_success`), but whether the UI offers it after login is
UNVERIFIED. Paying is a financial action, so Dustin decides.

Remote Server tab:

- **Remote endpoint URL \***: `https://mcp.mercury402.com/mcp`
- **Name \***: `Mercury402`

After the site fetches details, review and set:

- **Description** (20-5,000 chars), paste:

  ```
  Treasury/FRED financial data over x402. Browse 78 pay-per-call US financial data endpoints (Treasury yields and auctions, 53 FRED endpoints, forex, yield spreads, breakeven inflation, macro composites, AI briefings) and get their live x402 prices, paid per call in USDC on Base. The hosted endpoint is discovery-only and free: list_endpoints (read-only) and get_endpoint_data (returns the live 402 quote and payment instructions, never pays). Paid mode is opt-in on the local stdio server only (npx -y mercury402-mcp). Not affiliated with mercury-x402-mcp (io.github.mercuryx402).
  ```

- **Repository URL**: `https://github.com/dudman1/mercury402`
- **Website**: `https://mercury402.com`
- **Docs**: `https://github.com/dudman1/mercury402/tree/master/mcp-server`
- **Category**: Finance (closest available)

## Route 2: GitHub issue on chatmcp/mcpso

New issue at https://github.com/chatmcp/mcpso/issues/new (no template), or a comment on the maintainer thread
https://github.com/chatmcp/mcpso/issues/1 ("Leave your MCP Servers links").

**Title:**

```
Submit Remote MCP Server: Mercury402 (io.github.dudman1/mercury402-mcp)
```

Use the registry id in the title only after SUBMIT.md item 2 has published it. Before that, use
`Submit Remote MCP Server: Mercury402 (Treasury/FRED financial data over x402)`.

**Body** (paste):

````
**Name:** Mercury402
**Type:** Remote MCP server (Streamable HTTP, no auth) + local stdio (npm)
**Remote URL:** https://mcp.mercury402.com/mcp
**Repository:** https://github.com/dudman1/mercury402 (MCP server in `mcp-server/`)
**Package:** `npx -y mercury402-mcp` (https://www.npmjs.com/package/mercury402-mcp, MIT)
**Website:** https://mercury402.com
**MCP Registry:** io.github.dudman1/mercury402-mcp

**Categories:** Finance

**Description:** Treasury/FRED financial data over x402. 78 pay-per-call US endpoints: Treasury yields, TIPS and auctions, yield-curve spreads, 53 FRED endpoints, forex, breakeven inflation, macro composites and AI briefings, priced $0.05 to $0.50 per call in USDC on Base. The hosted endpoint is discovery-only and free: `list_endpoints` (read-only) and `get_endpoint_data` (returns the live price and x402 payment instructions, never pays). Paid mode is opt-in on the local stdio server only, via the optional `MERCURY402_PAYER_PRIVATE_KEY`. Not affiliated with mercury-x402-mcp (io.github.mercuryx402).

**Tools:** `list_endpoints`, `get_endpoint_data`

**Quick setup (remote, no install):**
```json
{ "mcpServers": { "mercury402": { "type": "http", "url": "https://mcp.mercury402.com/mcp" } } }
```

**Quick setup (local stdio):**
```json
{ "mcpServers": { "mercury402": { "command": "npx", "args": ["-y", "mercury402-mcp"] } } }
```

**Auth:** none. Endpoint calls are paid per call in USDC on Base via x402, from the caller's own client.
````

Drop the **MCP Registry** line if item 2 hasn't been published yet.
