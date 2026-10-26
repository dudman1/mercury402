<!--
DRAFT for https://mercury402.com/privacy (later PR, not this one). Facts below were checked against
dudman1/mercury402 @ ceb5b47. File:line refs are in these comments only; strip them when publishing.
Dustin fills: [OPERATOR], [EFFECTIVE DATE]. Not legal advice.
-->

# Privacy Policy

Effective [EFFECTIVE DATE]

Mercury402 ("we") runs a pay-per-call financial data API at api.mercury402.com, a hosted MCP server at
mcp.mercury402.com, and the open-source `mercury402-mcp` package. It's operated by [OPERATOR]. This page covers
what we collect when you use any of them.

## The short version

- No accounts, no sign-up, no cookies, no analytics on mercury402.com.
- We log enough about each API request to run the service and account for payments.
- Payments happen on the Base blockchain. On-chain records are public and permanent. We can't change or delete them.
- We don't sell your data and we don't run ads.

## What we collect

**API requests (api.mercury402.com).** For each request we log: time, endpoint path, HTTP status, response time,
price, whether the response came from cache, and payment details if you paid (payer wallet address, transaction
hash, payment nonce, verification result, and a rejection reason if the payment failed). We log the path only,
not query strings or request bodies, and the request log holds no IP address or customer identifier.
<!-- src/server.js:850-867 logAccess (endpoint: req.path; no IP or customer field) -->

**Payment records.** Each payment attempt is also written to a separate payment ledger: time, endpoint, amount,
whether it was verified, a rejection reason if any, the transaction hash, and a customer identifier. For a normal
paid call the identifier is the paying wallet address. On the three composite endpoints
(`/v1/composite/economic-dashboard`, `/inflation-tracker`, `/labor-market`) it is the `X-Customer-Id` header if
you send one, otherwise the network (IP) address our server sees. Those three routes and the development-only
test-token path are the only places an IP address is written to disk.
<!-- src/server.js:773-795 logPayment -> REVENUE_LEDGER (:669); wallet as id :1092,:1111,:1225,:1257;
     X-Customer-Id || req.ip at :2023,:2053,:2085,:2115,:2147,:2177 (composite) and :1287 (Bearer x402_test,
     ALLOW_TEST_TOKEN=true only). /metrics keeps per-IP rate-limit counters in memory only (:3194-3200).
     Replay protection also appends a payment key (payer address + nonce, or tx hash),
     endpoint and time to a redemption ledger: :613, :650-657. -->

**Replay protection.** To stop the same payment being used twice, we also keep a record of each payment we've
accepted (payer wallet address and payment nonce, or the transaction hash), with the endpoint and time.

**Composite endpoints.** For each paid call to one of the three composite endpoints we also record the endpoint,
the amount and the payer wallet address in our internal metrics database (hosted by Convex). Other paid calls are
not sent there.
<!-- src/server.js:885-904 emitToConvex; only callers :2027-2183 (composite routes) -->

**AI endpoints (/v1/ai/\*).** To answer, we send your question and the relevant data to OpenRouter, which routes
it to the model we've configured (currently `stealth/ox-alpha`). Whether OpenRouter or that model's provider logs
or keeps prompts is not something we've confirmed, and their own terms apply. Don't put personal information in
AI questions.
<!-- src/ai-routes.js:2 ("free stealth model"), :7 OPENROUTER_URL, :8 AI_MODEL default "stealth/ox-alpha".
     Provider prompt-logging/retention: UNVERIFIED. -->

**Hosted MCP server (mcp.mercury402.com).** It keeps no request log or database of its own. It writes startup,
shutdown and error lines to its server error output, and keeps per-IP request counters in memory for rate limiting
(reset each minute, never written to disk). When a tool calls the API, the API logging above applies. The hosted
server never pays and never asks for a wallet.
<!-- mcp-server/src/index.ts:8-9 log() -> process.stderr (:23,:30,:41,:51); http.ts:262 request-failed line;
     http.ts:99-125 FixedWindowLimiter in-memory Map, 60s window, used per IP at :175 -->

**Local package (`npx mercury402-mcp`).** It runs on your machine. If you turn on paid mode, your wallet's private
key stays on your machine. It's used only to sign the payment authorization and is never sent to us. The package
only talks to api.mercury402.com.

**Website (mercury402.com).** It's a static page with no cookies, analytics or trackers. It loads its fonts from
Google Fonts, so your browser sends Google a request (with your IP address) when the page loads.
<!-- public/index.html:8-9 fonts.googleapis.com. Fix if we'd rather not name Google: self-host the three font
     families in public/ and drop both <link> tags, then delete the Google line below. -->

## Who else processes data

- **Cloudflare** carries all traffic to our domains, so it processes IP addresses and request metadata.
- **Google (Google Fonts)** serves the website's fonts, so it sees your IP address and browser details when you
  load mercury402.com.
- **Base network.** Payments are USDC transfers on the Base blockchain and are visible to anyone.
- **OpenRouter** and the model provider it routes to, for AI endpoints only.
- **Convex** stores paid-call metrics for the three composite endpoints.
- **GitHub**, if you contact us through GitHub issues. Issues are public.

Upstream data sources (for example FRED and the U.S. Treasury) receive our server's requests, not yours.

## How long we keep it

- The request log rotates. We keep the current file plus up to 7 older files of 50 MB each, then delete the
  oldest.
  <!-- src/server.js:670-672, rotateAccessLog :798-847; ACCESS_LOG only -->
- The payment ledger and the replay-protection ledger are not rotated, and neither are server error logs. We keep
  them as long as we need them for accounting, disputes and preventing double-spends.
  <!-- REVENUE_LEDGER :669, REDEMPTION_LEDGER :613: append-only, no rotation; stderr not rotated by the app -->
- On-chain transactions are permanent and outside our control.

## Your choices

You can use the API without sending any identifier. For any request about your data (access, deletion of what we
hold, questions), see https://mercury402.com/support. Wallet addresses inside on-chain transactions can't be
deleted by anyone.

## Children

Mercury402 isn't directed at children under 16.

## Changes

If we change this policy we'll update the effective date above. Material changes will also be noted on
https://mercury402.com/support.
