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
- **Root cause:** UNVERIFIED. Suspects: Cloudflare blocking probe IPs, or the header being base64url where the spec
  says base64 (https://raw.githubusercontent.com/x402-foundation/x402/main/specs/transports-v2/http.md line 12:
  "Base64-encoded `PaymentRequired` schema in header").
- **Already listed?** UNVERIFIED. Their `/search` page 404s.
- **Fix location:** whatever serves `/openapi.json` and the 402, likely `src/server.js` (UNVERIFIED). Separate PR.

Other URLs read: https://www.x402scan.com/discovery

## 2. Coinbase Bazaar

Read 2026-10-25: https://docs.cdp.coinbase.com/x402/bazaar · https://docs.cdp.coinbase.com/x402/network-support ·
https://docs.cdp.coinbase.com/llms.txt · https://docs.cdp.coinbase.com/x402/seller/get-discovered.md ·
https://docs.cdp.coinbase.com/x402/seller/facilitator.md · https://docs.cdp.coinbase.com/x402/support/faq.md

- **CDP validator rejects us.** Check-only `POST https://api.cdp.coinbase.com/platform/v2/x402/validate` on UNRATE,
  yield-curve snapshot and cpi-core: all `valid=false`, simulation `rejected`. `bazaarExtension` present on the
  first two, missing on cpi-core.
- **Listing requires the CDP facilitator vs our own:** UNVERIFIED (needs one re-read of the docs above).
- **Payment-path impact:** UNVERIFIED.

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
  description 97 chars. Raw: `logs/server-json-schema.log` (gitignored).
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

Not started. UNVERIFIED. The ✓ claims in STATUS.md stay untrusted until checked live.

## Our own endpoints (2026-10-25)

- https://api.mercury402.com/openapi.json (200) · /.well-known/x402 (200) · /llms.txt (200) · /.well-known/mcp.json (404)
- https://mercury402.com (200, title "Mercury402 — Financial Intelligence for Autonomous Agents"), used as `websiteUrl`.
