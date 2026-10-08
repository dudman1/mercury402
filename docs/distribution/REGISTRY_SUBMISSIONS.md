# Mercury402 Distribution — Registry Submissions

**Canonical endpoint:** `https://mcp.mercury402.com/mcp` (streamable HTTP, free discovery mode)
**Package:** `mercury402-mcp` on npm (v0.1.3)
**Repo:** `https://github.com/dudman1/mercury402`

---

## 1. Smithery (https://smithery.ai)

**Status:** Ready to submit
**URL to submit:** `https://mcp.mercury402.com/mcp`
**Type:** Remote (streamable HTTP)

**Submission form fields:**
```
Name: Mercury402
Description: Pay-per-call financial data API (FRED, Treasury, macro) via x402 on Base. Free discovery mode: list_endpoints + 402 quotes.
Remote URL: https://mcp.mercury402.com/mcp
Category: Finance / Data
Tags: x402, USDC, Base, FRED, Treasury, finance, pay-per-call
Repository: https://github.com/dudman1/mercury402
```

---

## 2. Glama (https://glama.ai/mcp/servers)

**Status:** Ready to submit
**Type:** Remote (streamable HTTP)

**Submission:**
```
Name: Mercury402
Description: 78 pay-per-call financial data endpoints (FRED, Treasury yields, forex, spreads, breakeven inflation, macro bundles, AI briefings). x402 payments (USDC on Base).
Remote URL: https://mcp.mercury402.com/mcp
Install: npx -y mercury402-mcp
Category: Finance
Tags: finance, x402, USDC, Base, FRED, Treasury, pay-per-call
Repo: https://github.com/dudman1/mercury402
```

---

## 3. PulseMCP (https://pulsemcp.com)

**Status:** Ready to submit
**Type:** Remote (streamable HTTP)

**Submission:**
```
Server Name: Mercury402
Description: Financial data API with x402 micropayments. FRED macro series, Treasury yields, forex, spreads, breakeven inflation, macro composites, AI briefings/Q&A. Pay-per-call in USDC on Base.
URL: https://mcp.mercury402.com/mcp
Category: Finance
Tags: x402, finance, USDC, Base, FRED, Treasury
GitHub: https://github.com/dudman1/mercury402
```

---

## 4. mcp.so (https://mcp.so)

**Status:** Ready to submit
**Type:** Remote (streamable HTTP)

**Submission:**
```
Name: Mercury402
Description: 78 pay-per-call financial data endpoints with x402 on Base. FRED, Treasury, forex, spreads, breakeven, macro, AI.
Remote URL: https://mcp.mercury402.com/mcp
Install: npx -y mercury402-mcp
Tags: finance, x402, USDC, Base, FRED, Treasury
Repository: https://github.com/dudman1/mercury402
```

---

## 5. Official MCP Registry (https://github.com/modelcontextprotocol/registry)

**Status:** Requires PR to modelcontextprotocol/registry
**Location to add:** `src/servers/mercury402.json`

**File content:**
```json
{
  "name": "mercury402",
  "description": "78 pay-per-call financial data endpoints (FRED, Treasury, forex, spreads, breakeven, macro, AI) via x402 micropayments on Base (USDC). Free discovery mode at https://mcp.mercury402.com/mcp.",
  "url": "https://mcp.mercury402.com/mcp",
  "repository": "https://github.com/dudman1/mercury402",
  "tags": ["finance", "x402", "usdc", "base", "fred", "treasury", "pay-per-call"],
  "install": "npx -y mercury402-mcp",
  "license": "MIT",
  "categories": ["finance", "data", "payments"]
}
```

---

## 6. Coinbase x402 Bazaar (https://bazaar.x402.org)

**Status:** Awaiting Dustin's submission (requires Coinbase account)
**Form fields:**
```
Name: Mercury402
Description: Pay-per-call financial data API. 78 endpoints (FRED, Treasury, macro) with x402 payments (USDC on Base). Free discovery mode.
Endpoint: https://mcp.mercury402.com/mcp
Protocol: x402 (streamable HTTP)
Payment: USDC on Base (chain 8453)
Categories: Finance, Data, Payments
Tags: x402, USDC, Base, FRED, Treasury, AI
Owner: Dustin McCormick (dudman1)
Repo: https://github.com/dudman1/mercury402
```

---

## 7. Claude Marketplace / Anthropic Console

**Status:** Awaiting Dustin's submission (requires Console org "Mercury402")
**Org:** Mercury402 (dustin@mercury402.com)

**Submission:**
```
Connector Name: Mercury402
Description: 78 pay-per-call financial data endpoints (FRED, Treasury yields, forex, spreads, breakeven inflation, macro bundles, AI briefings/Q&A). Free discovery mode: x402 payment quotes returned; caller pays with their own wallet.
Endpoint URL: https://mcp.mercury402.com/mcp
Auth Type: None (free mode) / x402 (paid mode)
Auth Details: x402 protocol, USDC on Base (chain 8453), pay-to 0xF8d59270cBC746a7593D25b6569812eF1681C6D2
Pricing: $0.05–$0.50 per call (USDC on Base)
Documentation: https://api.mercury402.com/docs/api
x402scan: https://www.x402scan.com/server/mercury402
Documentation: https://api.mercury402.com/docs/api
Tags: finance, x402, USDC, Base, FRED, Treasury, AI
```

---

## Next Steps for Dustin

1. **Claude Marketplace:** Submit via Anthropic Console (org "Mercury402"). Text above.
2. **Coinbase x402 Bazaar:** Submit via bazaar.x402.org. Text above.
3. **Official MCP Registry:** I'll open a PR to modelcontextprotocol/registry with the JSON file above.
3. **Smithery, Glama, PulseMCP, mcp.so:** I'll submit these (they don't require your credentials).
4. **Post announcements:** When the listings are live, I'll draft the Show HN / X / dev.to post for you to post.

---

## Notes

- All remote URLs point to `https://mcp.mercury402.com/mcp` (streamable HTTP, free discovery mode).
- The npm package `mercury402-mcp@0.1.3` is published and available via `npx -y mercury402-mcp`.
- x402scan listing already live: https://www.x402scan.com/server/mercury402