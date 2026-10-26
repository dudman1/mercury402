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

Sources: one read-only subagent pass (2026-10-25 ~20:30-20:41 EDT) plus my own re-reads marked (re-read), done
with web_extract the same evening. Listing copy: `docs/listings/claude-connector.md`.

- **Live URLs:** portal https://claude.ai/directory/manage (anonymous curl → HTTP 403, login-gated) ·
  docs https://claude.com/docs/connectors/building/submission (re-read) ·
  checklist https://claude.com/docs/connectors/building/review-criteria (re-read) ·
  policy https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy (re-read) ·
  auth https://claude.com/docs/connectors/building/authentication.
- **Mechanism:** account-based developer portal; pick "MCP connector" and give it one remote server URL. Needs a
  paid Claude plan (Pro/Max/Team/Enterprise); "Free accounts can't submit". The older Console form is "no longer
  supported". Anthropic scans each submission and lists it under the Community label by default.
- **Fields (from the docs, not the live form):** Server URL (https, remote) · Connection mode (Universal URL |
  Multiple URLs | URL pattern) · Tools (auto-synced; the portal flags tools missing a title or annotations) ·
  Server name ≤100 · One-liner ≤200 · Description ≤2,000 · Categories 1-5 · Documentation URL · Privacy policy
  URL · Support contact · Icon · URL slug (permanent) · Use cases + prerequisites + reads/writes · Company name,
  website, review contact · Auth type (`none` is a supported value: "No authentication (authless server)") ·
  Data handling (first-party/proxied/third-party, PHI, sponsored) · Test & launch instructions · seven compliance
  acknowledgments.
- **Auth for us:** fine. Review criteria (re-read): "OAuth 2.0 if your tools act on a user's account, or no
  authentication for public data". No IP allowlist or domain proof needed.
- **Already listed?** No. https://claude.com/marketplace/connectors-plugins (HTTP 200, 1,463,701 bytes) has 0
  hits for "mercury402" or "dudman1" (`logs/part3-verify.log`, 20:53 EDT). The only "Mercury" there is the
  unrelated bank (`https://mcp.mercury.com/mcp`).
- **What we lack:** real privacy page and support contact (`/privacy`, `/support` return the homepage; see §6) ·
  an icon (only `favicon.ico`) · a paid-plan Claude account to submit from · correct annotations on
  `get_endpoint_data` (§4.2) · a decision on the financial-transactions acknowledgment (§4.1).

### 4.1 Policy risk: financial transactions

Three texts, quoted verbatim:

- Directory Policy §4.A (re-read, support.claude.com-a75603bea8.md:65): "A. Software that transfers money,
  cryptocurrency, or other financial assets, or executes financial transactions autonomously on behalf of users,
  without human-in-the-loop safeguards." Preamble to §4: "Unless otherwise expressly permitted by us in writing,
  we do not allow Software with certain capabilities into our Directories."
- Connector checklist, "Unsupported use cases" (re-read, claude.com-54ecb65fec.md:77): "Connectors that do the
  following aren't accepted: * Transfer money, cryptocurrency, or other financial assets". No human-in-the-loop
  qualifier here.
- Submission step 9 (re-read, claude.com-a51f9d8c64.md:184): "Seven policy acknowledgments covering the
  directory guidelines, first-party API usage, financial transactions, AI media generation, prompt injection,
  conversation data collection, and public documentation. All seven are required."

Facts on our side: the hosted server holds no wallet and no key, and `assertSafeHttpConfig`
(`mcp-server/src/http.ts:92`) refuses to boot a public-exposure config with a payer key. On the hosted server
`get_endpoint_data` returns a 402 quote as text and never pays (checked live 2026-10-25: `status:
payment_required`, `price_usd: 0.05`). Paid mode exists only in the self-run local package.

Unknowns: the exact wording of the seven checkboxes (behind the login), and whether a reviewer reads "returns
x402 payment instructions for a paid API" as facilitating a transfer. Neither can be settled without submitting.
Whether to submit is Dustin's decision.

### 4.2 Reviewer question: get_endpoint_data annotations

- Set at `mcp-server/src/server.ts:133`:
  `annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: false }` (list_endpoints at :93 is
  `{ readOnlyHint: true, openWorldHint: false }`). Live tools/list on https://mcp.mercury402.com/mcp returns the same.
- Directory Policy §5.E (subagent read): "MCP servers must provide all applicable annotations for their tools, in
  particular readOnlyHint, destructiveHint, and title."
- MCP spec 2025-06-18 ToolAnnotations
  (https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2025-06-18/schema.ts):
  readOnlyHint "If true, the tool does not modify its environment. Default: false"; destructiveHint
  "meaningful only when `readOnlyHint == false` ... Default: true"; openWorldHint "Default: true".
- Problem: with readOnlyHint false and destructiveHint unset, the spec default makes clients treat the tool as
  destructive on the hosted server, where it only fetches a free 402 quote and can never pay (paid-mode boot guard
  `assertSafeHttpConfig`, mcp-server/src/http.ts:92, refuses a public-exposure config with a payer key, doc comment
  :60-64; payer built at server.ts:69, `paidModeEnabled` = client.ts:102-104).
- Correct annotation depends on mode:
  - hosted / local free mode: `{ readOnlyHint: true, openWorldHint: true }`, a read of public data, no side effect.
  - local paid mode: `{ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }`.
    The data read is a read, but each call moves USDC out of the user's wallet, irreversibly, again on every
    repeat. Marking it read-only there invites clients to auto-approve spending.
- Shape (no change made): compute annotations at server.ts:133 from `client.paidModeEnabled`, the same flag
  list_endpoints already reports (:106). Shipping it needs a release and the hosted runtime pin moved off v0.1.3
  (Dustin).

### 4.3 UNVERIFIED (Claude)

- The live portal form and the exact wording of the seven acknowledgments (login wall, 403).
- Review time: the docs give no fixed number.
- How the financial-transactions clause gets applied to an x402 quote-only connector.

## 5. PayAPI, Smithery, Glama, PulseMCP, mcp.so, Cursor/Windsurf/Cline

### Part 3 directory checks (2026-10-25 ~20:30-21:15 EDT)

Method: one read-only subagent per site (none wrote to the repo or logged in anywhere), then my own re-reads and
live re-checks, logged in `logs/part3-verify.log` (local only, not committed). Mercury402 is listed in **none**
of these directories.

STATUS.md re-check (openclaw-config `6aace61`, current as of 2026-10-08): the only ✓/✅ in the file is line 116,
the watchdog test, which isn't a listing claim. Item 10 (line 189) already says "nothing submitted yet". Live
checks agree.

Payoff note: the Official MCP Registry (§3) feeds three of these directly. PulseMCP ingests it, Glama
"ingests and re-publishes everything in the official registry", and Windsurf/Devin custom registries "must
follow the official MCP registry schema". Publishing there comes first.

### Glama

- **Live URLs:** https://glama.ai/mcp/faq (re-read) · https://glama.ai/mcp/methodology (re-read) ·
  https://glama.ai/mcp/connectors · https://glama.ai/mcp/schemas/connector.json
- **Mechanism, connector track (ours):** "Connectors are remote MCP servers you've already deployed somewhere
  with a public endpoint. On the connectors page, click Add MCP Server → Connector". No Dockerfile, no build.
  "Only healthy connectors are indexed for search."
- **Mechanism, server track:** GitHub repo URL; Glama builds a Dockerfile (yours or AI-inferred) in a microVM.
  "Servers must be on GitHub today". Riskier for us: the repo root is the API server, the MCP server sits in
  `mcp-server/`, and there's no Dockerfile anywhere.
- **Registry feed:** "Glama operates as a superset of that registry. Glama ingests and re-publishes everything in
  the official registry" (methodology).
- **Fields (connector):** name · short description · server URL ("must be HTTPS and speak the streamable-http
  transport") · optional private test credentials (not needed, we're authless).
- **Claim:** TXT record at `_glama-claim.mercury402.com`, or `https://mercury402.com/.well-known/glama.json`
  `{ "$schema": "https://glama.ai/mcp/schemas/connector.json", "claim": "glama_claim_..." }`, or GitHub identity
  for `io.github.<user>` names.
- **Already listed?** No. https://glama.ai/mcp/servers?query=mercury402 returns only the unrelated
  `mercuryx402/mercury-x402-mcp` (§7). `?query=dudman1` → 0 results. `/mcp/connectors/io.github.dudman1/mercury402-mcp`
  → 404.
- **What we lack:** a Glama account (account requirement is from a third-party guide, UNVERIFIED on an official
  page) · a claim proof (DNS TXT or .well-known file, both Dustin steps) · an icon.

### Cursor

- **Live URLs:** https://cursor.com/docs/mcp/install-links (re-read) · https://github.com/cursor/mcp-servers ·
  https://cursor.directory/plugins/new · https://cursor.com/marketplace/publish
- **Mechanism:** no directory to submit an MCP URL to. `cursor/mcp-servers` is archived; its README: "This
  repository is deprecated. Use cursor.directory instead." cursor.directory: sign in (GitHub/Google), paste a
  GitHub repo URL, components auto-detected; the community README says "All content is submitted through the
  website — no pull requests needed for data." MCP servers are detected from a repo-root `.mcp.json`. The
  official Marketplace wants a plugin manifest in a public repo and "Every plugin is manually reviewed".
- **What works today without a listing:** install links. Format (install-links doc):
  `cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG`. Both of our configs
  base64 round-trip cleanly and the button images return 200 (`mcp-install-dark.svg` 22,843 B,
  `mcp-install-light.svg` 22,849 B), checked 21:14 EDT. Snippets: `docs/listings/install-snippets.md`.
- **Already listed?** No. `cursor.directory/plugins/mercury402` and `/plugins/mercury402-mcp` → 404.
- **What we lack (only if we go for cursor.directory later):** repo-root `.mcp.json` (404 today) · logo ·
  plugin manifest (for Marketplace). Marketplace form labels are UNVERIFIED (client-rendered).

### mcp.so

- **Live URLs:** https://mcp.so/submit · https://mcp.so/ (FAQ) · https://github.com/chatmcp/mcpso/issues/1
- **Mechanism 1, form:** FAQ: "Use the Submit button in the top navigation (mcp.so/submit). Enter your repository
  or server URL and we fetch the details; you can then review the name, description, config and tools before
  submitting. Listings go live after review." Needs sign-in ("Please sign in to submit a server."). The rendered
  card is "Paid submission $39 / one-time publishing fee / Publish immediately without review / Verified badge /
  Featured and priority placement / Dofollow project link". A free path exists only in the JS bundle
  (`submit_free_success`); whether the UI offers it after login is UNVERIFIED.
- **Mechanism 2, GitHub issue:** chatmcp/mcpso, no issue template (`.github` → 404). Thread #1: "Leave your MCP
  Servers links. We will make it visiable on https://mcp.so". Recent per-server issues use the title
  "Submit Remote MCP Server: <name> (<registry-id>)".
- **Fields (form):** Remote Server tab: "Remote endpoint URL *" + "Name *". MCP Server tab: "Repository URL *" +
  "Name" (2-120 chars). After login the payload carries name, description (20-5,000), repositoryUrl, websiteUrl,
  docsUrl, category, endpointUrl.
- **Already listed?** No. https://mcp.so/search?q=mercury402 → "0 results"; `/servers/mercury402` → 404;
  `search/issues?q=repo:chatmcp/mcpso+mercury402` → 0 (re-checked 21:15 EDT).
- **What we lack:** an mcp.so account (form route) · icon · a docs page · the registry id for the issue title
  (exists only after §3 publish). Drafts: `docs/listings/mcp-so/issue.md`.

### Cline

- **Live URLs:** https://github.com/cline/mcp-marketplace (README + issue form) · https://github.com/cline/marketplace ·
  https://cline.github.io/marketplace/catalog.json
- **Channel 1, issue (what cline.bot's "Submit to Marketplace" button still links to):**
  https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml. Form re-read 21:15 EDT:
  title prefix `[Server Submission]: ` · "GitHub Repository URL" (required) · "Logo Image" (required, 400×400 PNG) ·
  "Installation Testing", two required checkboxes: "I have tested that Cline can successfully set up this server
  using only the README.md and/or llms-install.md file" and "The server is stable and ready for public use" ·
  "Additional Information" (optional). README: "nested links are also okay", so
  `https://github.com/dudman1/mercury402/tree/master/mcp-server` is a valid repo URL.
- **Channel 2, catalog PR:** add `registry/mcps/<slug>/entry.json` (+ icon) to cline/marketplace. Required keys:
  id, type, name, tagline (≤120), description, tags (ids from tags.json; `finance` and `data` exist),
  install.args. CI gate: `node scripts/generate.mjs --check`. Submitters are moving here, e.g. #2612: "Closing in
  favour of cline/marketplace#327, which adds Weft to the new marketplace repository that Cline reads now."
- **Neither channel is moving.** Re-checked 21:15 EDT: cline/marketplace 308 open PRs, **8 merged ever**, newest
  merge #124 on 2026-09-18T20:15:11Z. catalog.json `generatedAt` 2026-09-18T20:15:28.359Z, 149 MCPs, no mercury
  entry. Newest mcp-marketplace issues carry no labels and no maintainer replies (subagent sample).
- **Policy (README line 44):** "We apply increased scrutiny to projects in sensitive domains (such as financial
  services) and require additional verification for cryptocurrency-related tools". README also claims review
  "within a couple of days" (line 58), which the queue doesn't support.
- **Already listed?** No. `search/issues?q=repo:cline/mcp-marketplace+mercury402` → 0; catalog has no mercury entry.
- **What we lack:** a 400×400 PNG · an honest Cline install test (the first checkbox can't be ticked today) · a
  Cline block in `mcp-server/README.md` (it documents Claude only) · optional `llms-install.md`. Drafts:
  `docs/listings/cline/`.

### Smithery

- **Live URLs:** https://smithery.ai/docs/build/publish.md · https://smithery.ai/future (re-read) ·
  https://registry.smithery.ai/servers?q=mercury402
- **Mechanism:** publish by URL. "1. Go to smithery.ai/new 2. Enter your server's public HTTPS URL 3. Complete
  the publishing flow." Requirements: "Streamable HTTP transport · OAuth support (if auth required)". Public
  servers: "Scan completes automatically". CLI equivalent: `smithery mcp publish "<url>" -n @org/name`.
- **Fields:** public HTTPS URL · namespace (lowercase alphanumeric + hyphens, globally unique; free plan = 3) ·
  slug · display name · description. Optional static card at `/.well-known/mcp/server-card.json` only if the scan
  fails (ours is 404, not needed).
- **Shutdown (re-read):** "On October 31, 2026, we're shutting down Smithery's connection management services.
  Smithery will remain as a public (non-proxied) MCP registry." What stops: "Server URLs on run.tools and
  server.smithery.ai / Smithery API, Connect, and Toolbox / Smithery accounts and API keys / The Smithery CLI and
  SDKs." What stays: "smithery.ai, as a public directory of MCP servers, now powered by Arcade.dev".
- **Already listed?** No. `registry.smithery.ai/servers?q=mercury402` → 20 unrelated x402 servers, 0
  "mercury402" hits; exact lookups `/servers/dudman1/mercury402` etc. → 404.
- **What we lack:** a Smithery account + namespace, which die on 10/31. A POST from SmitheryBot through Cloudflare
  is untested (a GET with that UA got 405, not 403). Low payoff.

### PulseMCP

- **Live URLs:** https://www.pulsemcp.com/submit (re-read) · https://www.pulsemcp.com/api
- **Mechanism:** paused. Submit page: "Apologies, submissions and changes are temporarily paused." and "In the
  meantime, if you have a server to share, publish it to the Official MCP Registry. That is the best first step
  even when we are not paused, and we will pick it up automatically once we are back." Last updated: September
  3, 2026. Sources (api page): manual submissions, scraping with manual curation, "Integration with the Official
  MCP Registry", enrichment.
- **Fields:** none readable while paused.
- **Already listed?** No. https://www.pulsemcp.com/servers?q=mercury402 → "0 of 0 servers". The old query API
  `api.pulsemcp.com/v0beta` → HTTP 410 `API_SUNSET`; v0.1 → 401 (partner key).
- **What we lack:** the registry entry (§3). Nothing to submit.

### Windsurf (now Devin Desktop docs)

- **Live URLs:** https://docs.windsurf.com/windsurf/cascade/mcp (re-read) · https://docs.devin.ai/work-with-devin/mcp
- **Mechanism:** none for us. "Cascade does not have an MCP Marketplace or one-click install. Those are only
  available for the Devin Local agent." Users edit `mcp_config.json` by hand; remote servers "require a
  `serverUrl` or `url` field". Devin's marketplace has no vendor intake; users can press "Suggest MCP
  Integration". Enterprise custom registries "must follow the official MCP registry schema".
- **Already listed?** Can't be checked: the in-app store isn't public (windsurf.com/mcp returns an SPA shell with
  no "mercury402"). UNVERIFIED rather than confirmed absent.
- **What we lack:** nothing we can act on beyond the registry entry. Paste-ready config in
  `docs/listings/install-snippets.md`.

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

## 6. mercury402.com hosting and the site pages

- mercury402.com = Cloudflare Pages project `mercury402` (CNAME -> mercury402.pages.dev). No Git connected; deployed
  by direct upload of `public/` from dudman1/mercury402, from the MBP:
  `cd ~/mercury402 && git pull && npx -y wrangler@3 pages deploy public --project-name mercury402 --branch main --commit-dirty=true`
  Source: openclaw-config/mercury402/STATUS.md:28 and :61-65. Not served by the mini.
- Verified 2026-10-25: live https://mercury402.com/ (61,374 bytes) is byte-identical (cmp) to `public/index.html`
  at ceb5b47 (last touched a9b10d5). Response headers: `server: cloudflare`, no origin headers.
- Why /privacy, /terms, /support return the homepage: `public/` has no `404.html`, so Pages runs in SPA mode.
  https://developers.cloudflare.com/pages/configuration/serving-pages/ :
  > If your project does not include a top-level `404.html` file, Pages assumes that you are deploying a single-page application. ... serves the root (`/`) for any incoming path that does not correspond to a static asset
  All three return HTTP 200 + homepage bytes, so a directory link-checker sees a 200 but no policy text. Same for
  `/logo.png`, `/icon.png`, `/apple-touch-icon.png` (200, text/html, 61,374 B): there is no logo asset.
- Same `public/` is also served by the API via `app.use(express.static(path.join(__dirname, '../public')))`
  (src/server.js:125). http://127.0.0.1:4020/privacy -> 404 today.
- Later PR (not this one): add `public/privacy.html`, `public/terms.html`, `public/support.html` (Pages serves
  `/privacy` for `privacy.html`; same doc: "`/contact.html` will be redirected to `/contact`"), footer links in
  `public/index.html`, and consider `public/404.html` so unknown paths stop returning 200 + homepage. Deploy =
  Dustin's wrangler step above. Side effect: express.static would also serve them at api.mercury402.com/privacy.html.
- Copy drafts: `docs/listings/site-pages/{privacy,terms,support}.md`.
- Contact: no email on the site. STATUS.md:33 says `support@mercury402.com` routes via Cloudflare Email Routing to
  Gmail; MX = route{1,2,3}.mx.cloudflare.net (dig 2026-10-25). Delivery untested -> UNVERIFIED; support page uses
  GitHub issues. Private vulnerability reporting on dudman1/mercury402 is OFF (`{"enabled":false}`).

## 7. Name collision: mercuryx402/mercury-x402-mcp

Record only. No action taken or proposed. Checked 2026-10-25 21:13-21:15 EDT; raw output in `logs/collision.log`
(local only).

- **Where it shows up for our name:**
  - Glama search https://glama.ai/mcp/servers?query=mercury402 returns it as the only hit; connector page
    https://glama.ai/mcp/connectors/io.github.mercuryx402/mercury-x402-mcp (200, title "mercury-x402-mcp - MCP
    Connector | Glama").
  - PulseMCP https://www.pulsemcp.com/servers/mercuryx402-mercury ("Mercury x402", community, subagent read).
    `?q=mercury402` returns 0; `?q=mercury` includes it.
  - Official MCP Registry: `search=io.github.mercuryx402` → `io.github.mercuryx402/mercury-x402-mcp` v1.0.1,
    remote `https://network.mercury-hq.com/mcp`, "Agent-payable web data over x402: 18 keyless services an agent
    pays per call."
- **Repo:** https://github.com/mercuryx402/mercury-x402-mcp. Created 2026-06-05T09:04:05Z, last push
  2026-06-07T02:00:38Z, 0 stars, 0 forks, MIT, not a fork. Description: "MCP server: 17 keyless,
  signed-provenance web-data tools your AI agent can pay for itself over x402 on Base mainnet (USDC). No API key,
  no account." Homepage `https://mercury-x402-jed.fly.dev`.
- **Origin/author, as far as the repo says:**
  - Owner `mercuryx402`: GitHub user, no name/bio/company/email, created 2026-06-05T09:43:09Z, i.e. about 39 min
    *after* the repo (inference: the repo was created elsewhere and transferred in).
  - Contributors: `Mercurysignals` 7 commits (user since 2025-04-12, no name/company), `mercuryx402` 1.
    Earliest commit `66563c6` 2026-06-05 by Mercurysignals.
  - `package.json`: no `author`, `homepage` or `repository`; `mcpName` `io.github.mercuryx402/mercury-x402-mcp`.
    npm `mercury-x402-mcp` latest 1.0.1, maintainer `mercurynetwork`, created 2026-06-05T06:34:23Z.
  - README (46 lines) has no author or contact line. The owner's other repos: `mercury-docs`, `mercury-x402-sdk`,
    `mercury-desktop`, `mercuryx402`, `awesome-mcp-servers`, all created 2026-06-05 to 06-07.
  - Its llms.txt calls itself "MERCURY x402 — The agent-payable web-data network".
- **Product overlap:** different product. Theirs sells web-data tools (fetch, markdown, extract, DNS, sitemap),
  and its MCP root says tools/call "needs a Mercury API key". Ours sells US financial data. Same words in the
  name ("mercury", "x402") and same rail (x402, USDC on Base).
- **Why it matters for listings:** searches for "mercury402" on Glama and "mercury" on PulseMCP surface theirs,
  not ours. Our listing copy should say "Mercury402" (one word, with 402) and "US financial data" up front.

## Our own endpoints (2026-10-25)

- https://api.mercury402.com/openapi.json (200) · /.well-known/x402 (200) · /llms.txt (200) · /.well-known/mcp.json (404)
- https://mercury402.com (200, title "Mercury402 — Financial Intelligence for Autonomous Agents"), used as `websiteUrl`.
