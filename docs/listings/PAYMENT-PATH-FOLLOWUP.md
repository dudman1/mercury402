# Mercury402 payment-path follow-up (spec only, not implemented)

Written 2026-10-25 on `feat/distribution-listings` (part 2 of 3). Nothing here is implemented. Each item is a
separate src PR through the normal pipeline: Hermes builds, Claude Code reviews against source, Dustin deploys.
Evidence and live URLs: `docs/listings/RESEARCH.md` §1 (x402scan), §2 (Bazaar), §5 (PayAPI).
Line numbers are against `c67419a`.

## A. Listing-compatibility fixes (no change to who settles or how)

Suggested order, payoff first: A1+A5 (shared schema data), A2, A3, A4.

### A1. Input schema on every paid operation

x402scan blocker: 69 of 84 resources fail with "Missing input schema" on the register-page lookup.

- Touches: `docs/openapi.yaml`, served as-is by `src/server.js:3605-3615` (YAML path at `src/server.js:3609`).
- Change: every paid operation declares `parameters` (GET query/path) or `requestBody` (POST). Today 75 of 78 paid
  operations declare neither.
- Parameterless GETs (e.g. `/v1/breakeven/10y`): their probe library's `extractInputSchema` returns `undefined` when
  an operation has no `requestBody` and no `parameters`, so `parameters: []` won't pass. Options:
  - document an optional query param the route already accepts;
  - or rely on A5. Their probe reads the input schema from the 402's bazaar extension first, so a
    `queryParams` schema of `{type: object, properties: {}}` may do. Whether that passes is UNVERIFIED.
  - Either way, check against the register-page lookup before merging.
- Done when: the lookup for `api.mercury402.com` at https://www.x402scan.com/resources/register shows 0
  "Missing input schema" rows.

### A2. `mode` on every `x-payment-info.price`

- Touches: `docs/openapi.yaml`, 78 `x-payment-info:` blocks (first at line 97). 69 have no `mode`.
- Change: add `mode: "fixed"` where there is a single `amount`. Use `mode: "dynamic"` with `min`/`max` where the
  price varies. Keep `amount` in decimal USD (x402scan spec.md line 36).
- Test: `test/root-manifest.test.js:219` already reads `x-payment-info.price`. Extend it to assert every paid
  operation has `mode`.

### A3. Unpaid POST probe gets the 402 first; paid request still validates before settlement

- Touches: `src/server.js:2321-2324` and `src/server.js:1681` (second route, below). The order is deliberate, per
  the comment at lines 2321-2323:
  ```js
  // SECURITY (2026-04-20): preValidateTreasuryHistorical now runs BEFORE
  // require402Payment so malformed/invalid date-range requests return 400
  // without consuming the caller's payment.
  app.post('/v1/treasury/yield-curve/historical', preValidateTreasuryHistorical, require402Payment(...), ...)
  ```
- Rule:
  - **No payment artifact** (neither `PAYMENT-SIGNATURE` nor `X-PAYMENT` header): skip pre-validation and return the
    402 challenge. This satisfies x402scan spec.md line 150: "Let probes reach the `402` challenge before
    body/query validation".
  - **Payment artifact present:** run `preValidateTreasuryHistorical` before `require402Payment`, exactly as today.
    Malformed requests still return 400 with no verify and no settle. This preserves the 2026-04-20 property.
- Shape:
  - Add a small gate in front of the existing validator. It uses the same artifact test `require402Payment` already
    uses at `src/server.js:1313` (`req.headers['payment-signature'] || req.headers['x-payment']`). The unpaid branch
    at `src/server.js:1314-1317` already sends the challenge.
  - Keep the 2026-04-20 comment and add one line for the unpaid-probe exception.
  - `src/treasury-historical-validate.js` does not change.
- Side effect: an unpaid malformed request now gets 402 instead of 400. If the client then pays, the artifact
  request still gets 400 before settlement, so nobody is charged for a bad request.
- Tests:
  - unpaid + empty body → 402 with `PAYMENT-REQUIRED`;
  - artifact + empty body → 400 `MISSING_PARAMS` and no settle call;
  - artifact + valid body → the existing path.
- **Second route, same rule:** `GET /v1/fred/:series_id` (`src/server.js:1681`) runs `fredQueryGuard`
  (`:1659-1670`, 400 `INVALID_LIMIT` on a bad `limit`) and `fredSeriesGuard` (`:1504-1525`) before
  `require402Payment`. A3 covers both routes: same artifact gate in front of both guards, same three tests per route
  (for FRED, "malformed" = bad `limit` or a rejected series). A grep of every `require402Payment` registration in
  `src/server.js`, `src/new-routes.js` and `src/ai-routes.js` found no third route with a guard ahead of it.
- Dev-only path: `Bearer x402_test` (`src/server.js:1282-1301`) is honored only when `ALLOW_TEST_TOKEN=true`. It
  carries no payment header and nobody is charged on it (logged as unverified, `verified: false`). The artifact
  gate doesn't change it.

### A4. Standard base64 in `PAYMENT-REQUIRED`

- Touches: `src/server.js:956-959`. It encodes base64, converts to base64url, strips `=`, and returns the result.
- Change: return `Buffer.from(json).toString('base64')` (padded, with `+/`).
  - This matches the x402 transport spec (http.md line 12, "Base64-encoded `PaymentRequired` schema in header") and
    `@x402/core`'s `Base64EncodedRegex = /^[A-Za-z0-9+/]*={0,2}$/`.
  - It clears CDP's `valid_json` failure on `/v1/treasury/yield-curve/daily-snapshot`.
- In-repo decoders: checked 2026-10-25, every one accepts padded standard base64, so nothing in-repo breaks.
  `test/fred-named-routes.test.js:81`, `test/fred-limit-pricing.test.js:125`, `test/payer-protection.test.js:391`
  and `mcp-server/src/payment.ts:27` (each normalizes, then decodes with `'base64'`). Node
  `Buffer.from(x, 'base64')` accepts both alphabets, so Node clients keep working.
- Must change in the same PR:
  - `src/server.js:3431`: HTML copy says the header is "base64url-encoded". Change it to "base64-encoded".
  - `mcp-server/test/helpers.ts:32`: builds a base64url fixture. Switch it to standard padded base64 so the tests
    exercise what the server sends.

### A5. Bazaar extension: concrete `info` values, and coverage beyond 9 routes

- Touches: `BAZAAR_SCHEMAS` at `src/server.js:148-455`; the `/v1/fred/{series_id}` entry is at
  `src/server.js:149-203`.
- Change 1: `info.input.queryParams` and `pathParams` hold concrete example values (e.g. `series_id: "UNRATE"`), and
  type descriptors move to `schema`. The bazaar spec: "Facilitators **must** validate `info` against `schema` before
  cataloging."
- Change 2: add entries for the ~75 paid routes that have none (cpi-core, breakeven/10y, ...).
- Payoff: clears CDP `parse` and `has_bazaar_extension`, and likely gives x402scan its input schema (A1). It does
  not get us into the CDP Bazaar by itself; see B.

## B. CDP Bazaar listing: Dustin's payments decision

Bazaar indexes a resource only after a settle through the CDP Facilitator; the FAQ quote is in RESEARCH.md §2. We
self-settle from our own facilitator wallet, so A alone does not list us.

- **B1. Settle through the CDP Facilitator.**
  - Touches `require402Payment` (`src/server.js:1043`), the settle path (`src/server.js:1179-1198`) and
    `facilitatorUsdc` (`src/server.js:717`).
  - Needs CDP API credentials on the server, changes who broadcasts settlement, and puts a third party in the
    revenue path.
  - Payments and deploy-adjacent: needs a Claude Code review GO plus Dustin's approval.
- **B2. Skip Bazaar.** No code change. Discovery comes from x402scan, PayAPI and the MCP Registry.
- Hermes's take: B2 for now. B1 rewires a working revenue path for a catalog whose payoff can't be measured yet.
  Revisit after A ships and x402scan/PayAPI show whether listings bring traffic.
- Not chosen. Dustin decides.

## UNVERIFIED (carried from research)

- Why part 1's x402scan test box showed "ERR Unknown error" on every row. Not reproduced on 2026-10-25.
- Whether x402scan accepts an empty object input schema for no-input GETs (A1).
- Which 15 of the 84 x402scan resources pass. The "+ 76 more" list did not expand in the headless browser.
- Whether x402scan reads the input schema from our v1 402 body or from the v2 header's bazaar extension (A1/A5).
- Whether the x402.org facilitator catalog (separate from CDP Bazaar) is worth targeting as a non-CDP option.

Closed 2026-10-25 (review): A4's in-repo decoder question (all accept padded base64) and A3's "only route"
question (it isn't; `/v1/fred/:series_id` also validates first, now covered in A3).
