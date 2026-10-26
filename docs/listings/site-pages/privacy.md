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
not query strings or request bodies. A customer identifier is also recorded: the `X-Customer-Id` header if you send
one, otherwise the network address our server sees.
<!-- src/server.js:850-866 logAccess (endpoint: req.path); :773-783 logPayment; customer id e.g. :1287 -->

**Paid calls.** For each verified paid call we also record the endpoint, the amount and the payer wallet address in
our internal metrics database (hosted by Convex).
<!-- src/server.js:885-904 emitToConvex -->

**AI endpoints (/v1/ai/\*).** To answer, we send your question and the relevant data to OpenRouter, which passes it
to the model provider that generates the reply. Their own privacy terms apply to that processing. Don't put
personal information in AI questions.
<!-- src/ai-routes.js:6-8, OPENROUTER_URL -->

**Hosted MCP server (mcp.mercury402.com).** It keeps no logs or storage of its own. When a tool calls the API, the
API logging above applies. The hosted server never pays and never asks for a wallet.
<!-- no fs/console calls in mcp-server/src (grep, 2026-10-25) -->

**Local package (`npx mercury402-mcp`).** It runs on your machine. If you turn on paid mode, your wallet's private
key stays on your machine. It's used only to sign the payment authorization and is never sent to us. The package
only talks to api.mercury402.com.

**Website (mercury402.com).** It's a static page with no cookies, analytics or trackers.
<!-- grep of public/index.html for gtag/analytics/cookie/localStorage: no hits -->

## Who else processes data

- **Cloudflare** carries all traffic to our domains, so it processes IP addresses and request metadata.
- **Base network.** Payments are USDC transfers on the Base blockchain and are visible to anyone.
- **OpenRouter** and the model provider it routes to, for AI endpoints only.
- **Convex** stores our paid-call metrics.
- **GitHub**, if you contact us through GitHub issues. Issues are public.

Upstream data sources (for example FRED and the U.S. Treasury) receive our server's requests, not yours.

## How long we keep it

- Request logs rotate. We keep the current file plus up to 7 older files of 50 MB each, then delete the oldest.
  <!-- src/server.js:670-672 -->
- Payment records are kept as long as we need them for accounting and disputes.
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
