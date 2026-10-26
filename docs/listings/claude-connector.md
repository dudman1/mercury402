# Claude connector directory: listing copy

Submit through https://claude.ai/directory/manage → Submit new → MCP connector (paid Claude plan required).
Field list and limits from https://claude.com/docs/connectors/building/submission (read 2026-10-25). The portal is
login-gated, so the live form itself was not seen. Research and policy quotes: RESEARCH.md, section "Claude
connector directory".

**Do not submit until the prerequisites in SUBMIT.md are done.** Blockers:

1. Privacy policy URL and support contact must be real pages. Both are listing fields, and Directory Policy 3.A
   says software that "connects to a remote service must provide a clear, accessible privacy policy link". Today
   /privacy and /support return the homepage. Drafts: `docs/listings/site-pages/`.
2. Tool annotations. Every tool needs a `title` plus "the applicable `readOnlyHint` or `destructiveHint`"; the
   portal flags tools missing them. Titles exist (`server.ts:85`, `:120`). `get_endpoint_data` is
   `readOnlyHint: false` with no `destructiveHint` (`mcp-server/src/server.ts:133`), so it likely gets flagged.
   Fix shape: RESEARCH.md, reviewer question on `get_endpoint_data`. Needs a release and the hosted runtime pin
   moved off v0.1.3 (Dustin).
3. Icon. None exists beyond `favicon.ico`.
4. Financial-transactions policy risk. Read the policy-risk notes in RESEARCH.md before ticking the
   acknowledgment.

## Connection

- Server URL: `https://mcp.mercury402.com/mcp`
- Connection mode: Universal URL
- Authentication: none (public data, discovery-only)
- Transport: Streamable HTTP, stateless

## Listing

- **Server name** (≤100): `Mercury402`
- **URL slug** (permanent once published): `mercury402`
- **One-liner** (≤200, 111 chars):

  > Browse 78 pay-per-call US financial data endpoints (Treasury, FRED, forex, inflation) and get live x402 prices.

- **Description** (≤2,000):

  > Mercury402 is a pay-per-call API for US financial and macro data, priced per request in USDC on Base over the
  > x402 protocol. This connector lets Claude browse the catalog and quote prices. It is discovery-only and never
  > pays on your behalf.
  >
  > Two tools:
  >
  > - List Mercury402 endpoints (list_endpoints): all 78 endpoints with path, category, description, parameters
  >   and price ($0.05 to $0.50 per call). Filter by category or keyword. Read-only.
  > - Call a Mercury402 endpoint (get_endpoint_data): requests one endpoint and returns its live HTTP 402 quote:
  >   price, network, asset and the x402 payment requirements. It never returns paid data and never moves funds.
  >
  > Coverage: 53 FRED series (rates, inflation, employment, GDP, credit spreads), Treasury yield curve, TIPS and
  > auction results, yield-curve spreads, breakeven inflation, major forex pairs, macro composites, and AI market
  > briefings.
  >
  > Use it to answer "what data exists and what does it cost" before an agent or developer decides to buy. To
  > fetch the data itself, pay with your own x402 client, or run the open-source local server
  > (npx -y mercury402-mcp) with your own wallet.

- **Categories** (1-5): Finance; Data & Analytics. The real pick-list is behind the login; choose the closest.
- **Documentation URL:** `https://github.com/dudman1/mercury402/tree/master/mcp-server` (public README).
  Alternative once site pages exist: a docs page on mercury402.com.
- **Privacy policy URL:** `https://mercury402.com/privacy` (BLOCKED until the site pages ship)
- **Support contact:** `https://mercury402.com/support` (BLOCKED until the site pages ship), which points at
  `https://github.com/dudman1/mercury402/issues/new`
- **Icon:** MISSING

## Use cases

- Primary: find the right US financial data series and its exact per-call price; check what an endpoint expects
  before buying.
- Prerequisites: none. No account, no key.
- Reads data / writes data / both: **reads data**

## Company

- Company name: Mercury402 (Dustin to confirm the legal operator name; same blank as the terms page)
- Website: `https://mercury402.com`
- Primary review contact: Dustin (email of the submitting Claude account)

## Data handling

- Underlying API: first-party (`https://api.mercury402.com`, our own)
- Personal health data: no
- Sponsored content: no

## Test & launch (reviewer instructions)

> No account or credentials needed. Add https://mcp.mercury402.com/mcp as a custom connector.
>
> 1. Call list_endpoints with no arguments. Expect 78 endpoints.
> 2. Call get_endpoint_data with {"path": "/v1/breakeven/10y"}. Expect status "payment_required", price_usd
>    0.05, network "base". That quote is the intended result: this connector is discovery-only and never pays.

Checked live 2026-10-25 against the hosted server: step 2 returned `status: payment_required`, `price_usd: 0.05`,
"This hosted endpoint is discovery-only and never pays on your behalf." STATUS.md (2026-10-08) records the same
two calls working through a Claude custom connector.

## Compliance (seven acknowledgments)

Our position for the financial-transactions acknowledgment, to paste if the form allows a note:

> The hosted connector never transfers money or executes transactions. It holds no wallet and no key, and the
> server refuses to start a public endpoint with a payer key configured. get_endpoint_data returns a price quote
> as text; paying requires a separate x402 client the user controls. Paid mode exists only in the self-hosted
> local package and is not part of this listing.

Code evidence for that note: `assertSafeHttpConfig`, `mcp-server/src/http.ts:92`; hosted tool description,
`mcp-server/src/server.ts:37-41`.
