# Cline: submission drafts

Two channels, neither moving (RESEARCH.md, Cline section). Checked 2026-10-25 21:15 EDT: cline/marketplace has
308 open PRs, 8 merged ever, newest merge #124 on 2026-09-18. Steps and order: SUBMIT.md, Cline item.

Do not file until the prerequisites listed in SUBMIT.md are met. Two block the paste below:

- **Logo:** the issue form requires a 400×400 PNG, and the catalog PR CI (`node scripts/generate.mjs --check`)
  fails when the relative `icon` file in `entry.json` is missing. No such PNG exists. `mercury402.com/logo.png`
  and similar paths return the homepage HTML, not an image.
- **Install test:** the first checkbox says we tested a Cline install from README/llms-install.md. Nobody has
  run that yet, so leave it unticked until someone does it in Cline.

## Channel 1: issue on cline/mcp-marketplace

URL: https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml

**Title** (the form pre-fills `[Server Submission]: `):

```
[Server Submission]: Mercury402: Treasury/FRED financial data over x402 (78 pay-per-call endpoints)
```

**GitHub Repository URL** (README: "nested links are also okay"):

```
https://github.com/dudman1/mercury402/tree/master/mcp-server
```

**Logo Image:** drag in the 400×400 PNG. Leave empty until it exists. The form won't submit without it.

**Installation Testing:** tick both boxes only after a real Cline install has worked:

- [ ] I have tested that Cline can successfully set up this server using only the README.md and/or llms-install.md file
- [ ] The server is stable and ready for public use

**Additional Information** (paste):

```
Mercury402: Treasury/FRED financial data over x402. Not affiliated with "mercury-x402-mcp" (io.github.mercuryx402), a different web-data server.

78 pay-per-call US financial data endpoints: Treasury yields and auctions, 53 FRED endpoints, forex, yield spreads, breakeven inflation, macro composites and AI briefings. Each call is priced per request ($0.05 to $0.50) and paid in USDC on Base over x402. No subscription, no API key.

Two ways to connect:
- Local stdio: npx -y mercury402-mcp (npm mercury402-mcp, MIT, Node 20.10+). Tools: list_endpoints (all 78 endpoints with price, category and parameters; read-only) and get_endpoint_data (calls the live API and returns the data, or the HTTP 402 quote and payment instructions).
- Hosted remote, no install and no auth: https://mcp.mercury402.com/mcp (Streamable HTTP). Discovery-only: it lists endpoints and returns the exact 402 price, but never pays and never returns paid data.

By default the local server never spends money either. Paid mode is opt-in via MERCURY402_PAYER_PRIVATE_KEY (a dedicated low-balance wallet) with a per-call cap, MERCURY402_MAX_PRICE_USD (default 0.50). The README and llms-install.md warn that the key sits in plaintext in the client config.

Official MCP Registry name: io.github.dudman1/mercury402-mcp.
```

Before pasting, cut the last line unless the registry publish has happened (SUBMIT.md item 2). Check:
`curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.dudman1"`.

## Channel 2: catalog PR on cline/marketplace

Repo https://github.com/cline/marketplace, base `main`, branch `add-mercury402`. Files:

- `registry/mcps/mercury402/entry.json`: draft in `docs/listings/cline/entry.json` (stdio install via npx)
- `registry/mcps/mercury402/icon.png`: the 400×400 PNG (missing)

`install.args` follows CONTRIBUTING.md's stdio shape `["name", "--", "npx", "-y", "some-mcp-server"]`. For the
hosted remote instead, CONTRIBUTING's remote shape gives
`["mercury402", "--transport", "http", "https://mcp.mercury402.com/mcp"]`. Tags `finance` and `data` both exist
in tags.json. Gate: `node scripts/generate.mjs --check` (id = folder name, required fields, icon file present).

PR title: `feat: add mercury402 MCP entry (Treasury/FRED financial data over x402)`

PR body (paste):

```
Adds Mercury402, an MCP server for Treasury/FRED financial data over x402: 78 pay-per-call US endpoints, browsable and quotable for free.

- Install: cline mcp install mercury402 -- npx -y mercury402-mcp (npm mercury402-mcp, MIT)
- Hosted remote alternative: https://mcp.mercury402.com/mcp (Streamable HTTP, no auth, discovery-only, never pays)
- Paid mode is opt-in and capped per call. The entry lists both env vars as optional.

Validated locally with `node scripts/generate.mjs --check`.
```

Only keep the last line if that check was actually run on the branch.
