# Mercury402 MCP Server — setup guide

Lets Claude Desktop / Claude Code / any MCP client call paid Mercury402 endpoints as native tools. Payments are x402 v2 exact-scheme EIP-3009 signatures signed locally by YOUR payer wallet; Mercury402's server settles them on-chain as facilitator.

## Tools exposed
| tool | price | notes |
|---|---|---|
| mercury_macro_briefing | $0.10 | AI briefing from live FRED data |
| mercury_ask_data | $0.15 | grounded Q&A over chosen FRED series |
| mercury_economic_dashboard | $0.10 | GDP/CPI/UNRATE composite |
| mercury_fred_series | $0.05 | any FRED series by id |

## Setup (Claude Desktop example)
1. Fund a FRESH wallet with ~$5 USDC on Base. Treat this key as hot — it signs payments.
2. Export the private key.
3. Add to claude_desktop_config.json:
```json
{
  "mcpServers": {
    "mercury402": {
      "command": "node",
      "args": ["/Users/openclaw/mercury-x402-service/src/mcp-mercury.js"],
      "env": {
        "MERCURY_API": "https://api.mercury402.com",
        "MERCURY_PAYER_KEY": "0xYOUR_HOT_WALLET_KEY"
      }
    }
  }
}
```
4. Restart Claude Desktop. Ask: "use mercury_ask_data to ask if inflation is accelerating."

## Safety notes
- Per-call spend is hard-capped at $100 (MERCURY_MAX_SPEND micro-USDC) even if a challenge asks more.
- The key never leaves process env; nothing logs it.
- Domain used for signing: USD Coin v2 on Base (8453). If USDC changes domain version, payments will revert on-chain — test with a small balance first.
- First real payment should be a $0.05 fred_series call as a canary.

## Verified tonight
- stdio handshake: initialize + notifications/initialized + tools/list OK (4 tools)
- Payment path is code-complete but UNTESTED end-to-end (needs a funded payer wallet) — first live call pending Dustin's $0.10 canary.
