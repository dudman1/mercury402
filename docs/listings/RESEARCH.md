# Mercury402 distribution research

Working log for getting Mercury402 listed in MCP and x402 directories. Every finding carries the live URL it was
read from and the date. UNVERIFIED means not checked against a live source yet.

Seeded 2026-10-25 from `openclaw-config/handoffs/2026-10-25-2000-hermes-mercury402-distribution-research.md`.
Branch `feat/distribution-listings`, base `da00406`.

## 1. x402scan

Read 2026-10-25: https://www.x402scan.com/discovery/spec

- **How listing works:** paste the origin at https://www.x402scan.com/resources/register, or
  `POST https://x402scan.com/api/x402/registry/register-origin` with SIWX wallet auth (Dustin step). They discover
  from `/openapi.json`, then run a live 402 probe.
- **Their check tool fails every route checked.** The "Test your API" box (page says "Nothing is registered") found
  84 resources; every row seen shows `ERR Unknown error`.
  - `/v1/breakeven/10y`: 402 ✗, x402 parses ✗, accepts ✗, input schema ✗, output schema ✗, ownership ✗,
    OG image ✗, favicon ✓.
- **Our 402 works when hit directly.** From the mini, 75/75 GETs and 1 POST return 402 with `PAYMENT-REQUIRED`.
- **Spec gaps confirmed:**
  - `x-payment-info.price` has no `mode`. Ours: `{"currency":"USD","amount":"0.15"}`; spec requires `mode: "fixed"`.
  - `POST /v1/treasury/yield-curve/historical` returns 400 on `{}`. Spec says probes must reach the 402 before body
    validation.
- **Root cause:** resolved in part 2, see "Part 2 root cause" below. Neither part-1 suspect is the cause.
- **Already listed?** No. See part 2 below.
- **Fix location:** `docs/openapi.yaml` (served by `src/server.js:3605-3615`) and `src/server.js`. Spec in
  `PAYMENT-PATH-FOLLOWUP.md` §A. Separate PR.

Other URLs read: https://www.x402scan.com/discovery

### Part 2 root cause (2026-10-25 ~20:25 EDT)

**69 of 84 discovered resources fail on missing input schemas, not on the 402.**

- Live lookup of `api.mercury402.com` in the box at https://www.x402scan.com/resources/register (typed only, Add
  not clicked): "Add API (15 resources)", "69 endpoints with errors". Every one of the 69 rows says:
  > Missing input schema — add a requestBody or parameter schema to your OpenAPI spec so agents know what to send
- **Their "402 ✗" means "x402 did not parse", not "status was not 402".** x402scan source,
  https://github.com/Merit-Systems/x402scan/blob/main/apps/scan/src/app/(app)/_components/discovery/discovery-panel.tsx
  - Line 965: `const returns402 = x402Parsed;`.
  - Around line 1002, the row message is "Missing input schema" only when the 402 parsed, otherwise the probe error
    or "Unknown error". So the 69 rows parsed our 402 fine.
  - The page banner still says the endpoints "need to return a 402 payment challenge". That's their generic copy for
    any failed row.
- **Why the input schema is missing:**
  - Their probe library `@agentcash/discovery` 1.7.5 (https://registry.npmjs.org/@agentcash/discovery/latest,
    `dist/index.js`) reads the input schema from the 402's bazaar extension first, then from OpenAPI.
  - Its `extractInputSchema` returns `undefined` when an operation has no `requestBody` and no `parameters`.
  - https://api.mercury402.com/openapi.json has 78 paid operations, and 75 have neither. Examples:
    `POST /v1/ai/ask`, `GET /v1/ai/briefing`, `GET /v1/breakeven/10y`.
- **Part 1's "ERR Unknown error" on every row:** not reproduced today. Cause UNVERIFIED.
- **(a) Outside fetch, `GET /v1/breakeven/10y`:** fetched via https://api.hackertarget.com/httpheaders/ (third-party
  datacenter, `CF-RAY ...-IAD`) and from the mini (`CF-RAY ...-ORD`), same second. Both returned:
  - `402`, `etag W/"231-xK1RkPXbhF7J55Jpx89JlmV30LU"`, `content-length 561`;
  - a `payment-required` header of 584 chars.

  No Cloudflare challenge on either path, so Cloudflare blocking is ruled out. Local log
  `logs/x402scan-headers-compare.log` (not committed).
- **(b) base64 vs base64url:**
  - x402scan's spec (https://www.x402scan.com/discovery/spec.md) never mentions base64.
  - The x402 transport spec does, at
    https://raw.githubusercontent.com/x402-foundation/x402/main/specs/transports-v2/http.md line 12:
    > Base64-encoded `PaymentRequired` schema in header
  - The reference decoder `@x402/core` 2.28.0 (https://registry.npmjs.org/@x402/core/latest, `dist/esm`) checks
    `Base64EncodedRegex = /^[A-Za-z0-9+/]*={0,2}$/` before decoding.
  - Ours is base64url (`src/server.js:956-959`). The breakeven header (584 chars, `len % 4 == 0`, no `-`/`_`) passes
    strict standard decoding by luck. So it isn't the x402scan cause, but it is what CDP rejects on
    daily-snapshot (§2).
- **(c) Price mode.** https://www.x402scan.com/discovery/spec.md line 24:
  > Set `x-payment-info.protocols` (array of protocol objects) and one pricing mode (`fixed` or `dynamic`) with `currency`.

  Lines 34-35:
  > - Fixed: `{ price: { mode: "fixed", currency: "USD", amount: "<amount>" } }`
  > - Dynamic: `{ price: { mode: "dynamic", currency: "USD", min: "<min>", max: "<max>" } }`

  Ours, from the live openapi.json: 69 have no `mode`, 8 are `fixed`, 1 is `dynamic`. The source is
  `docs/openapi.yaml`, with 78 `x-payment-info:` blocks (first at line 97).
- **(d) POST before validation.** Same spec, line 150 (common errors table):
  > | Expected 402, got 400 | Request validation rejected the unauthenticated probe before payment middleware ran | Let probes reach the `402` challenge before body/query validation, or add schemas/examples that let probes send valid input |

  - Live: `POST /v1/treasury/yield-curve/historical` with no body returns `400 MISSING_PARAMS`.
  - That order is deliberate, set 2026-04-20 per the comment at `src/server.js:2321-2323`. The fix spec keeps that
    property: `PAYMENT-PATH-FOLLOWUP.md` §A3.
- **Registered?** No.
  - The register-page lookup calls `public.resources.checkRegistered`
    (https://github.com/Merit-Systems/x402scan/blob/main/apps/scan/src/trpc/routers/public/resources.ts).
  - The same query sent directly to https://www.x402scan.com/api/trpc/public.resources.checkRegistered for 6 of our
    URLs returns `"registered":[]`.
  - The lookup for `mercury402.com` (the marketing origin) shows "No discovery document found". The API origin is
    `api.mercury402.com`.

## 2. Coinbase Bazaar

Read 2026-10-25: https://docs.cdp.coinbase.com/x402/bazaar · https://docs.cdp.coinbase.com/x402/network-support ·
https://docs.cdp.coinbase.com/llms.txt · https://docs.cdp.coinbase.com/x402/seller/get-discovered.md ·
https://docs.cdp.coinbase.com/x402/seller/facilitator.md · https://docs.cdp.coinbase.com/x402/support/faq.md

- **CDP validator rejects us.** Check-only `POST https://api.cdp.coinbase.com/platform/v2/x402/validate` on UNRATE,
  yield-curve snapshot and cpi-core: all `valid=false`, simulation `rejected`. `bazaarExtension` present on the
  first two, missing on cpi-core.
- **Payment-path impact:** see "Facilitator answer" below and `PAYMENT-PATH-FOLLOWUP.md` §B.

### Facilitator answer (part 2, re-read 2026-10-25 ~20:20 EDT)

**Listing requires a settled payment through the CDP Facilitator. Our self-settling wallet path cannot get indexed.**
Indexing happens on CDP's facilitator `settle` call. There's no registration form to bypass it.

- https://docs.cdp.coinbase.com/x402/support/faq.md, "How do I get my endpoint listed?":
  > There is no registration form. `createX402Server` declares Bazaar metadata for your routes
  > automatically; deploy the endpoint on public HTTPS, validate it, and complete one successful
  > paid call through the CDP Facilitator.
- https://docs.cdp.coinbase.com/x402/seller/facilitator.md, "Supported extensions":
  > **Bazaar discovery.** Powers the Bazaar discovery service. After
  > the facilitator settles a payment for an endpoint that advertises Bazaar metadata, it
  > indexes the endpoint so buyers and agents can find it.
- https://docs.cdp.coinbase.com/x402/seller/get-discovered.md, checklist:
  > * [ ] Complete a successful paid call through the CDP Facilitator.
- Same page, troubleshooting: other facilitators keep separate catalogs:
  > The [x402.org facilitator](https://x402.org/facilitator) maintains its own separate catalog, which
  > is not the CDP Bazaar.
- Same page: the indexing outcome comes back on the CDP facilitator's verify/settle responses, in an
  `EXTENSION-RESPONSES` header (base64 JSON, `bazaar.status` = `success|processing|rejected`). A server that
  never calls CDP verify/settle never sees that header.
- Inference: "a resource using its own facilitator wallet" can't be listed in the CDP Bazaar. Nothing on these
  three pages describes a submit-without-settle path.

### Why validate says `valid=false` (re-run 2026-10-25 ~20:22 EDT, raw JSON in `logs/cdp-validate_*.json`, local only)

What it simulates, per https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/validate-x402-endpoint.md:
> Returns a uniform array of preflight check results (reachable, returns402, hasBazaarExtension, parse) and a
> simulated facilitator accept/reject decision so sellers and agents can confirm their endpoint is ready to be
> discovered before going live.

and `simulation.outcome`:
> `accepted` if the facilitator would index the resource, or `rejected` if it would reject it.

So it simulates CDP's **indexing** decision, not a payment. It doesn't need a CDP facilitator to run. Each of the
three routes fails a different required check:

| Route | rejectionReason | Failing required check | Field |
|---|---|---|---|
| `/v1/fred/UNRATE` | `invalid discovery configuration` | `parse` | `extensions.bazaar.info.input.queryParams.*` and `.pathParams.series_id` are objects; the schema expects `string`/`integer` |
| `/v1/treasury/yield-curve/daily-snapshot` | `endpoint failed preflight checks` | `valid_json` | `PAYMENT-REQUIRED` header: "present but could not be decoded — must be standard base64-encoded JSON" |
| `/v1/fred/cpi-core` | `no bazaar discovery extension found` | `has_bazaar_extension` | no `extensions.bazaar` in the header |

Every payment-shape check passes on UNRATE and cpi-core: x402Version 2, `exact`, `eip155:8453`, USDC, amount 50000
≥ 1000, payTo, maxTimeoutSeconds, resource.

- **UNRATE detail** (verbatim `parse.detail`): `(root).input.queryParams.date: Invalid type. Expected: string, given:
  object ... (root).input.pathParams.series_id: Invalid type. Expected: string, given: object`. Our `info.input`
  carries schema descriptors (`{type, description, example}`). The bazaar spec says `info` holds **concrete example
  values**, validated against `schema`:
  https://raw.githubusercontent.com/x402-foundation/x402/main/specs/extensions/bazaar.md
  > - **`info.input.pathParams`** — concrete parameter values for this specific request (e.g. `{ "userId": "123" }`)

  > Facilitators **must** validate `info` against `schema` before cataloging.

  Source: `src/server.js:149-175` (the `/v1/fred/{series_id}` entry in `BAZAAR_SCHEMAS`, `src/server.js:148-455`).
- **daily-snapshot detail:** the header is 1706 chars, `len % 4 == 2`, no padding. Python
  `base64.b64decode(validate=True)` → `Incorrect padding`. The `urlsafe` decode succeeds. Source:
  `src/server.js:956-958` strips `=` and maps `+/` → `-_` (base64url). UNRATE (3092) and cpi-core (584) happen to be
  multiples of 4 with no `+`/`/` in them, so the same encoder passes there by luck.
- **cpi-core detail:** `BAZAAR_SCHEMAS` has only 9 keys (`/v1/fred/{series_id}`, `yield-curve/daily-snapshot`,
  `composite/economic-dashboard`, `composite/inflation-tracker`, `composite/labor-market`, `macro/snapshot/all`,
  `yield-curve/historical`, `auction-results/recent`, `tips-rates/current`). The other ~75 paid routes ship no
  bazaar extension, cpi-core and breakeven/10y among them (decoded headers: keys `x402Version, accepts, resource`
  only).

## 3. Official MCP Registry

### Namespace rule (quoted verbatim, live page read 2026-10-25 20:0x EDT)

Source: https://modelcontextprotocol.io/registry/authentication

> If you choose GitHub-based authentication, your server's name in `server.json` **MUST** be of the form
> `io.github.username/*` (or `io.github.orgname/*`). For example, `io.github.alice/weather-server`.

GitHub login, same page:

> GitHub authentication uses an OAuth flow initiated by the `mcp-publisher` CLI tool. To perform GitHub
> authentication, navigate to your server project directory and run: `mcp-publisher login github`

The repo owner is `dudman1` (`gh api repos/dudman1/mercury402`: id 1172993361, public, default branch `master`),
so the chosen name is **`io.github.dudman1/mercury402-mcp`**. Dustin must log in as the `dudman1` GitHub account.

### npm ownership check (registry source)

Source: https://raw.githubusercontent.com/modelcontextprotocol/registry/main/internal/validators/registries/npm.go

- The registry fetches `https://registry.npmjs.org/<identifier>/<version>` and requires its `mcpName` to equal the
  server name. Error strings: `NPM package '%s' is missing required 'mcpName' field. Add this to your
  package.json: "mcpName": "%s"` and `NPM package ownership validation failed. Expected mcpName '%s', got '%s'`.
- `version` is required on npm packages (`ErrMissingVersionForNPM`); `registryBaseUrl` must be exactly
  `https://registry.npmjs.org`; `fileSha256` is rejected for npm.
- Consequence: the published **0.1.3 has no `mcpName`** (checked 2026-10-25: `GET
  https://registry.npmjs.org/mercury402-mcp/0.1.3` → `mcpName None`), so registry publish needs a new npm version.
  `GET https://registry.npmjs.org/mercury402-mcp/0.1.4` → HTTP 404 (not published yet). Hence the 0.1.4 bump.

### Supported registries (verbatim excerpt)

Source: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/official-registry-requirements.md

> Only trusted public registries are supported. Private registries and alternative mirrors are not allowed.
> **NPM**: `https://registry.npmjs.org` only

> Publishers must prove ownership of their namespace.

### server.json schema facts

Source: https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json (HTTP 200, 22090 bytes)

- Required: `name`, `description`, `version`. `description` maxLength 100. `title` maxLength 100.
- `name` pattern `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`.
- Package required: `registryType`, `identifier`, `transport`. Repository required: `url`, `source`.
- StreamableHttpTransport required: `type`, `url`.

### Remote transport

Source: https://modelcontextprotocol.io/registry/remote-servers

> A remote server **MUST** be publicly accessible at its specified URL.

> The `remotes` property can coexist with the `packages` property in `server.json` in order to allow MCP host
> applications to choose the preferred method of installation.

Registry source (https://raw.githubusercontent.com/modelcontextprotocol/registry/main/internal/validators/utils.go,
`IsValidRemoteURL`): remote URLs must be `https` and not localhost.

Live check 2026-10-25: `POST https://mcp.mercury402.com/mcp` `initialize` → HTTP 200,
`serverInfo {"name":"mercury402","version":"0.1.3"}`, `capabilities.tools.listChanged true`. The hosted runtime
stays on 0.1.3 until Dustin moves the pin; server.json's top-level `version` describes the listing, the remote has
no version field.

### Registry state before publish

- `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=mercury402` → `{"servers":[],"metadata":{"count":0}}`
- `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.dudman1` → same, count 0.

### Publisher CLI

- Latest release: v1.8.4, published 2026-10-23T20:34:14Z,
  https://github.com/modelcontextprotocol/registry/releases/tag/v1.8.4 (darwin_amd64 and darwin_arm64 tarballs).
- Commands (https://raw.githubusercontent.com/modelcontextprotocol/registry/main/cmd/publisher/main.go):
  `init`, `login`, `logout`, `publish`, `status`, `validate`. `login github` = interactive GitHub device flow.
- `publish` and `validate` read `./server.json` by default or a path as first arg
  (https://raw.githubusercontent.com/modelcontextprotocol/registry/main/cmd/publisher/commands/publish.go).
- `validate` POSTs to `https://registry.modelcontextprotocol.io/v0/validate` without auth
  (https://raw.githubusercontent.com/modelcontextprotocol/registry/main/cmd/publisher/commands/validate.go).
- `mcp-publisher` is not installed on the mini (`which mcp-publisher` → not found).

### Validation of `mcp-server/server.json` (2026-10-25)

- Local: Draft-7 validation against the 2025-12-11 schema (python `jsonschema` via `uv run`) → `schema errors: 0`,
  description 97 chars. Raw: `logs/server-json-schema.log` (local only, not committed).
- Live: `POST https://registry.modelcontextprotocol.io/v0/validate` with the file body → HTTP 200
  `{"valid":true,"issues":[]}`. Raw: `logs/registry-validate.log`.
- Caveat (inference from npm.go above): the npm `mcpName` ownership fetch needs `mercury402-mcp@0.1.4` on npm, which
  is 404 today. `validate` passing does not prove publish will pass until 0.1.4 is live with `mcpName`.
- `Input.format` enum is `string | number | boolean | filepath`, so `MERCURY402_MAX_PRICE_USD` uses `"number"`.

Other URLs read: https://modelcontextprotocol.io/registry/quickstart · https://modelcontextprotocol.io/registry/package-types ·
https://modelcontextprotocol.io/registry/versioning · https://modelcontextprotocol.io/registry/about

## 4. Claude connector directory

Not started. UNVERIFIED.

## 5. PayAPI, Smithery, Glama, PulseMCP, mcp.so, Cursor/Windsurf/Cline

Smithery, Glama, PulseMCP, mcp.so and Cursor/Windsurf/Cline are not started (part 3). UNVERIFIED. The ✓ claims in
STATUS.md stay untrusted until checked live.

### PayAPI Market (part 2, read 2026-10-25 ~20:25 EDT)

Read: https://payapi.market/list · https://payapi.market/llms.txt · https://payapi.market/developers · https://payapi.market/

- **Requirements**, quoted from the FAQ at https://payapi.market/list:
  > What do I need on the form? A durable URL, the paid route, a Base USDC wallet you control, and a price that matches the live 402. Wallet is required. Sandbox and tunnel hosts are blocked.

  > Why was my URL rejected? We call it unpaid before a row is created. Homepage, AppDeploy/Floot/Bonto shells, and a 402 with no Base USD Coin challenge all fail here. The paid route has to 402 to your wallet.

  > extra.name must be "USD Coin" on Base USDC or settlement fails.

  > What will you pay on my API? One cheap canary on one route, up to $0.10, from our wallet. If that call returns real product and the money landed on your listed wallet, the listing can go live with a settlement-verified badge.

  > What gets bounced? Ephemeral hosts (trycloudflare, ngrok, sslip, random zrok shares). Prepaid credits instead of per-call x402.

  Bounced list, continued: "challenge payTo that is not the wallet on the form", and "A second listing that is the
  same product or a sub-path of one already live". So it's one listing per product.
- https://payapi.market/llms.txt: "submit_listing is free, rate limited, goes to pending review and never sets
  payment_verified."
- **Our fit, from a live 402 on `/v1/breakeven/10y`:**
  - v1 body: `network base`, asset USDC `0x8335...2913`, `extra {"name":"USD Coin","version":"2"}`, payTo
    `0xF8d5...C6D2`.
  - `api.mercury402.com` is our own domain on a named cloudflared tunnel, not trycloudflare. Inference: it's
    "durable" under their rule.
- **Already listed?** No. https://payapi.market/agent/list (HTTP 200, 162,911 bytes) contains no "mercury" string,
  and https://payapi.market/marketplace?q=mercury402 has no mercury402 hit.
- **Status: gated.** We don't submit until an organic payment exists. Their canary (up to $0.10, from their own
  wallet) is not organic and doesn't lift the gate. Submission is a Dustin step.

## Our own endpoints (2026-10-25)

- https://api.mercury402.com/openapi.json (200) · /.well-known/x402 (200) · /llms.txt (200) · /.well-known/mcp.json (404)
- https://mercury402.com (200, title "Mercury402 — Financial Intelligence for Autonomous Agents"), used as `websiteUrl`.
