<!--
DRAFT for https://mercury402.com/support (later PR, not this one).
Contact is GitHub issues until a contact email is confirmed. STATUS.md:33 lists support@mercury402.com
(Cloudflare Email Routing -> Gmail). MX records resolve to Cloudflare (dig, 2026-10-25), but delivery was not tested.
Once Dustin confirms a test mail arrives, add: "Email: support@mercury402.com".
GitHub private vulnerability reporting is OFF on dudman1/mercury402
(gh api repos/dudman1/mercury402/private-vulnerability-reporting -> {"enabled":false}, 2026-10-25).
The Security section below assumes Dustin enables it; until then, use the fallback line.
-->

# Support

## Get help

Open an issue: **https://github.com/dudman1/mercury402/issues/new**

Issues are public. **Never paste a private key, seed phrase or API key.** Include:

- the endpoint (e.g. `GET /v1/fred/UNRATE`) and the time, in UTC;
- the HTTP status and the error body;
- for payment problems: the transaction hash and the payer wallet address. Both are already public on-chain;
- for MCP problems: your client (Claude, Cursor, Windsurf, Cline...), and whether you use the hosted server
  (https://mcp.mercury402.com/mcp) or the local package (`npx -y mercury402-mcp`), with its version.

## Was I charged without getting data?

Open an issue with the transaction hash. We check it against our payment records and reply on the issue.

## Security issues

Report privately through GitHub: https://github.com/dudman1/mercury402/security/advisories/new
<!-- fallback until private reporting is enabled:
Open an issue titled "Security contact request" with no details, and we'll set up a private channel. -->

## Status and docs

- Health: https://api.mercury402.com/health
- API docs: https://api.mercury402.com/docs
- OpenAPI: https://api.mercury402.com/openapi.json
- For agents: https://api.mercury402.com/llms.txt
- MCP server: https://github.com/dudman1/mercury402/tree/master/mcp-server
- Updates: https://x.com/Mercuryclaw1

## Privacy and terms

- https://mercury402.com/privacy
- https://mercury402.com/terms
