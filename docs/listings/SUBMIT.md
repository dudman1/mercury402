# SUBMIT: Mercury402 distribution checklist

Payoff order. Every submission, account, payment and deploy step here is Dustin's. Agents drafted copy and
nothing was submitted. Evidence and live URLs: `RESEARCH.md` (section numbers below). Checked 2026-10-25.

Name to use everywhere: **Mercury402** (one word, with 402), and lead with **"Treasury/FRED financial data over
x402"**. Two reasons: `io.github.mercuryx402/mercury-x402-mcp` ("Agent-payable web data over x402") is already in
the official registry, on Glama and on PulseMCP (RESEARCH.md §7), and a registry search for "mercury" already
returns 7 distinct servers (mercuryx402, two Mercury-bank tools, and four unrelated).

Shared prerequisites, referenced by number below:

- **P1** site pages live (item 1)
- **P2** registry entry live (item 2)
- **P3** 400×400 PNG icon. No logo exists today: `mercury402.com/logo.png`, `/icon.png` and
  `/apple-touch-icon.png` return the homepage HTML (RESEARCH.md §6). Nobody is generating one in this PR.
- **P4** `get_endpoint_data` annotation fix released and the hosted pin moved (RESEARCH.md §4.2)

---

## 1. Publish privacy, terms and support pages (prerequisite)

**Needed by:** item 4 (Claude, required fields, and missing privacy = "immediate rejection"). Helpful for items 3
and 6 (website and docs links). Items 2, 5 and 7 don't need it.

- **URLs to create:** https://mercury402.com/privacy · https://mercury402.com/terms · https://mercury402.com/support
- **Today:** all three return HTTP 200 with the homepage bytes, because `public/` has no `404.html` and Cloudflare
  Pages falls back to SPA mode (RESEARCH.md §6).
- **Copy:** `docs/listings/site-pages/privacy.md`, `terms.md`, `support.md`.

Steps (a separate PR in dudman1/mercury402, not this one):

1. Fill the blanks. privacy: `[OPERATOR]`, `[EFFECTIVE DATE]`. terms: `[OPERATOR]`, `[EFFECTIVE DATE]`,
   `[GOVERNING LAW]`, `[LIABILITY CAP]`, plus the payment-problem wording flagged at the top of terms.md. Not
   legal advice.
2. Strip the `<!-- file:line -->` comments. Render to `public/privacy.html`, `public/terms.html`,
   `public/support.html` (Pages serves `privacy.html` at `/privacy`).
3. Add footer links in `public/index.html`. Consider `public/404.html` so unknown paths stop returning 200.
4. Decide on support: the draft uses GitHub issues because `support@mercury402.com` delivery is untested. Send a
   test mail first if you want the address on the page. Optional: turn on private vulnerability reporting
   (currently `{"enabled":false}`), which the support page's security link assumes.
5. Deploy from the MBP (STATUS.md:61-65):
   ```bash
   cd ~/mercury402 && git pull && npx -y wrangler@3 pages deploy public --project-name mercury402 --branch main --commit-dirty=true
   ```
6. Check:
   ```bash
   for p in privacy terms support; do curl -s https://mercury402.com/$p | grep -o "<title>[^<]*" ; done
   ```
   Expect three different titles, none of them the homepage title.

Side effect: `src/server.js:125` serves the same `public/` on the API host, so the pages also appear at
`api.mercury402.com/privacy.html`.

---

## 2. Official MCP Registry (highest payoff)

Feeds PulseMCP (automatic pickup), Glama ("ingests and re-publishes everything in the official registry") and
Windsurf/Devin custom registries (same schema). RESEARCH.md §3, §5.

- **URL:** https://registry.modelcontextprotocol.io · PR https://github.com/dudman1/mercury402/pull/33
- **Name (permanent):** `io.github.dudman1/mercury402-mcp`
- **Prerequisites:** none of P1-P4. Needs a GitHub login as **dudman1**.

### 2a. Before merge: title and description (Dustin decides)

Current `mcp-server/server.json`: `title` = `Mercury402`, `description` = `Pay-per-call financial data over x402
(USDC on Base): Treasury, FRED, forex, yield spreads, macro` (97). Neither contains "Treasury/FRED financial data
over x402". Proposed (schema max 100 each):

```json
"title": "Mercury402: Treasury/FRED financial data over x402",
"description": "Treasury/FRED financial data over x402: pay-per-call US yields, macro and forex in USDC on Base"
```

(50 and 95 chars.) `mcp-publisher` reads `server.json` from the checkout, so this can change any time before
step 2f without a new npm release. That's an inference from how the publisher works and is UNVERIFIED. Not
applied: changing PR #33 files is outside this docs pass.

### 2b-2g. Release, then publish

All commands are also in the PR #33 body.

b. Merge PR #33 (ff-only). On an up-to-date `master`, tag per `mcp-server/RELEASING.md`. The version fields are
   already 0.1.4, so skip its `npm version`/`sed` steps:
   ```bash
   git tag v0.1.4 && git push origin v0.1.4
   ```
   That runs **Publish mercury402-mcp** (`.github/workflows/publish-mcp.yml`, trusted publishing, provenance).
c. Wait for npm:
   ```bash
   npm view mercury402-mcp@0.1.4 version mcpName
   # expect: version = '0.1.4'  mcpName = 'io.github.dudman1/mercury402-mcp'
   ```
d. Install `mcp-publisher` v1.8.4:
   ```bash
   cd /tmp
   curl -L -o mcp-publisher.tar.gz "https://github.com/modelcontextprotocol/registry/releases/download/v1.8.4/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz"
   tar xzf mcp-publisher.tar.gz mcp-publisher && ./mcp-publisher --version
   ```
e. Validate, then log in as dudman1:
   ```bash
   cd <master-checkout>/mcp-server
   /tmp/mcp-publisher validate server.json
   /tmp/mcp-publisher login github
   # open https://github.com/login/device, enter the printed code, authorize as dudman1
   ```
f. Publish:
   ```bash
   /tmp/mcp-publisher publish server.json
   ```
g. Registry search check:
   ```bash
   curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.dudman1/mercury402-mcp"
   curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=mercury"
   ```
   Expect ours with version 0.1.4 in the first. In the second, ours should sit next to
   `io.github.mercuryx402/mercury-x402-mcp`, and the title/description should make the difference obvious.

---

## 3. Glama: connector by URL

- **URL:** https://glama.ai/mcp/connectors → **Add MCP Server** → **Connector**. RESEARCH.md §5 Glama.
- **Prerequisites:** a Glama account (requirement from a third-party guide, UNVERIFIED). P2 first: Glama ingests
  the official registry, so check whether it already shows up before submitting by hand:
  `https://glama.ai/mcp/servers?query=mercury402`.
- **Claim (optional, for a verified owner):** DNS TXT at `_glama-claim.mercury402.com`, or a file at
  `https://mercury402.com/.well-known/glama.json`
  (`{"$schema":"https://glama.ai/mcp/schemas/connector.json","claim":"glama_claim_..."}`, the value comes from
  Glama), deployed the same way as item 1.

Paste-ready:

- **Name:** `Mercury402`
- **Server URL:** `https://mcp.mercury402.com/mcp` (HTTPS, streamable-http, no auth)
- **Short description:**
  `Treasury/FRED financial data over x402: browse 78 pay-per-call US endpoints and get live prices. Discovery-only, never pays.`
- Test credentials: none.

---

## 4. Claude connector directory (Dustin's decision)

- **URL:** https://claude.ai/directory/manage → Submit new → MCP connector. Needs a paid Claude plan. Docs:
  https://claude.com/docs/connectors/building/submission
- **Copy:** `docs/listings/claude-connector.md` (every field, reviewer test steps, the note for the acknowledgment).
- **Prerequisites:**
  - P1: privacy policy URL and support contact are required fields
  - **P3: 400×400 PNG icon.** The docs list "an icon" among the listing materials but the public pages give no
    size or format. 400×400 PNG is Cline's requirement, so one asset can serve both. Claude's spec is UNVERIFIED.
  - P4, recommended: every tool needs "a `title` and a `readOnlyHint` or `destructiveHint` annotation: the portal
    flags tools that are missing them" (submission page). `get_endpoint_data` is
    `readOnlyHint: false` with no `destructiveHint` at `mcp-server/src/server.ts:133`, so it will likely be
    flagged until that fix ships in a release and the hosted runtime pin moves off v0.1.3.

### Policy text, verbatim

The public step-9 description of the acknowledgments (https://claude.com/docs/connectors/building/submission):

> Seven policy acknowledgments covering the directory guidelines, first-party API usage, financial transactions,
> AI media generation, prompt injection, conversation data collection, and public documentation. All seven are
> required.

The checkbox wording itself is behind the login (anonymous fetch → 403) and is UNVERIFIED. Read it in the portal
before ticking.

Software Directory Policy §4.A
(https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), under "Unless otherwise
expressly permitted by us in writing, we do not allow Software with certain capabilities into our Directories.":

> A. Software that transfers money, cryptocurrency, or other financial assets, or executes financial transactions
> autonomously on behalf of users, without human-in-the-loop safeguards.

Connector checklist (https://claude.com/docs/connectors/building/review-criteria), no human-in-the-loop qualifier:

> Connectors that do the following aren't accepted: * Transfer money, cryptocurrency, or other financial assets

### Facts

The hosted server at `https://mcp.mercury402.com/mcp` only returns price quotes and never pays. It holds no
wallet and no key, and `assertSafeHttpConfig` (`mcp-server/src/http.ts:92`) refuses to start a public endpoint
with a payer key. `get_endpoint_data` returns the 402 quote as text (live check 2026-10-25: `status:
payment_required`, `price_usd: 0.05`). Paid mode exists only in the self-run local package, which this listing
doesn't cover.

### Decision (Dustin)

Whether to submit at all, and how to answer the financial-transactions acknowledgment. Option: submit with the
note from `claude-connector.md` ("Compliance") and accept a possible rejection. Option: skip. How a reviewer
applies the clause to a quote-only x402 connector can't be known without submitting.

---

## 5. Cline: issue, then catalog PR

- **URLs:** issue https://github.com/cline/mcp-marketplace/issues/new?template=mcp-server-submission.yml ·
  PR https://github.com/cline/marketplace
- **Copy:** `docs/listings/cline/issue.md` (both channels), `docs/listings/cline/entry.json`,
  `docs/listings/cline/llms-install.md`.
- **Prerequisites:**
  - **P3: 400×400 PNG icon.** Required by the issue form, and the PR's CI (`node scripts/generate.mjs --check`)
    fails if `registry/mcps/mercury402/icon.png` is missing.
  - A real install test in Cline. The issue's first checkbox says "I have tested that Cline can successfully set
    up this server using only the README.md and/or llms-install.md file". Don't tick it until that's done.
  - Optional: copy `llms-install.md` into `mcp-server/` and add a Cline block to `mcp-server/README.md` (it only
    documents Claude today).
  - P2, only for the registry-name line in the issue text.
- **Expectations:** low. cline/marketplace has 308 open PRs and **8 merged ever**, newest #124 on 2026-09-18
  (checked 2026-10-25 21:15 EDT). The README also says crypto tools get "additional verification".

Steps: file the issue with the paste from `issue.md`. Then fork cline/marketplace, add
`registry/mcps/mercury402/entry.json` + `icon.png`, run `node scripts/generate.mjs --check`, and open the PR with
the paste from `issue.md`.

---

## 6. mcp.so

- **URLs:** form https://mcp.so/submit (login) · issue https://github.com/chatmcp/mcpso/issues/new or thread
  https://github.com/chatmcp/mcpso/issues/1
- **Copy:** `docs/listings/mcp-so/issue.md` (form fields + issue title/body).
- **Prerequisites:** an mcp.so account for the form. The rendered card is "$39 one-time publishing fee". Whether
  the free path shows up after login is UNVERIFIED, and paying is Dustin's call. The GitHub issue route needs only
  GitHub. Use the registry id in the issue title only after P2. P1 helps (website/docs links).

---

## 7. Smithery (low)

- **URL:** https://smithery.ai/new · docs https://smithery.ai/docs/build/publish.md · shutdown
  https://smithery.ai/future
- **Prerequisites:** a Smithery account + namespace.
- **Low payoff:** "On October 31, 2026, we're shutting down Smithery's connection management services. Smithery
  will remain as a public (non-proxied) MCP registry." Accounts, API keys and the CLI go away, and the directory
  stays "powered by Arcade.dev". How listings are added after 10/31 is UNVERIFIED.

Steps: smithery.ai/new → enter `https://mcp.mercury402.com/mcp` → complete the flow (public servers auto-scan).

Paste-ready: display name `Mercury402` · description
`Treasury/FRED financial data over x402: browse 78 pay-per-call US endpoints and get live x402 prices. Discovery-only, never pays.`

---

## Blocked, gated, or nothing to submit

- **x402scan: blocked until PAYMENT-PATH-FOLLOWUP A1** (input schema on every paid operation). Their check shows
  "Missing input schema" for 69 endpoints. Also wanted: A2 (`mode` on prices) and A3 (unpaid POST gets the 402
  first). Register at https://www.x402scan.com/resources/register once their "Test your API" passes. RESEARCH.md §1.
- **Coinbase Bazaar:** no form. Listing needs a settled payment through the CDP Facilitator, which is a payments
  decision (PAYMENT-PATH-FOLLOWUP §B). RESEARCH.md §2.
- **PayAPI Market: gated.** We don't submit until an organic payment exists. Their canary (≤ $0.10 from their
  wallet) doesn't count. RESEARCH.md §5 PayAPI.
- **PulseMCP: nothing to submit.** Submissions paused since 2026-09-03, and it picks up registry entries
  automatically. P2 covers it.
- **Windsurf: nothing to submit.** No marketplace for Cascade. Users paste a `serverUrl` config, which is in
  `docs/listings/install-snippets.md`.
- **Cursor: nothing to submit.** `cursor/mcp-servers` is archived. "Add to Cursor" install links work without a
  listing (`docs/listings/install-snippets.md`). cursor.directory would need a login and a repo-root `.mcp.json`
  (not proposed here).
