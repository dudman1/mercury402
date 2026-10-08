# Hosted MCP endpoint: `https://mcp.mercury402.com/mcp`

The MCP server's streamable-HTTP mode, served publicly in **free discovery mode**: `list_endpoints` works, and `get_endpoint_data` returns the x402 402 quote. Callers pay with their own wallet or client. This server never holds a key and never pays.

```
client ──https──▶ Cloudflare ──tunnel "mercury402"──▶ cloudflared (Mac mini)
                                                       │
                                                       └─▶ 127.0.0.1:3402  PM2 "mercury402-mcp"
                                                             └─▶ https://api.mercury402.com (402 quotes)
```

Everything below is **Dustin-only**: DNS, cloudflared, PM2, and the runtime checkout. Agents open PRs and nothing else.

## What protects it

| Control | Setting (deploy/ecosystem.config.cjs) |
|---|---|
| Loopback bind; cloudflared is the only public path in | `MCP_HTTP_HOST=127.0.0.1`, port `3402` |
| Host allowlist (DNS-rebinding guard); other Host headers get 403 | `MCP_HTTP_ALLOWED_HOSTS=mcp.mercury402.com` (loopback names always allowed) |
| Per-client limit, keyed on Cloudflare's `CF-Connecting-IP` (never `X-Forwarded-For`) | `MCP_HTTP_TRUST_PROXY=true`, `MCP_HTTP_RATE_LIMIT_PER_MIN=60` |
| Global limit; also caps the upstream 402 probes this endpoint sends to the API | `MCP_HTTP_GLOBAL_RATE_LIMIT_PER_MIN=600` |
| Body cap (413 above it) | `MCP_HTTP_MAX_BODY_BYTES=65536` |
| Paid mode cannot be switched on here | The process **refuses to boot** if `MERCURY402_PAYER_PRIVATE_KEY` is set together with any of: a non-loopback bind, a public allowed host, `MCP_HTTP_TRUST_PROXY`, or `MCP_PUBLIC_URL` |
| Stateless | `GET`/`DELETE /mcp` return 405; no sessions, no SSE streams to hold open |

`GET /` describes the endpoint. `GET /healthz` reports only this process (version, counters) and never calls the API.

## 1. Runtime checkout (one time)

The hosted process runs from its own clone, pinned to a release tag. It never runs from `~/mercury-x402-service`, which is the production API checkout and must never be built in. Once this clone is serving traffic, it is production too: agents never edit it.

```bash
git clone git@github.com:dudman1/mercury402.git /Users/openclaw/mercury402-mcp-runtime
cd /Users/openclaw/mercury402-mcp-runtime
git checkout --detach v0.1.2          # the first release tag containing this PR (see "Releases")
cd mcp-server
npm ci && npm run build               # src/catalog.json is committed; no root install needed
ls dist/index.js dist/http.js         # sanity: http.js must exist (it ships in the release containing this PR)
```

## 2. PM2 (one time)

```bash
lsof -nP -iTCP:3402 -sTCP:LISTEN || echo "3402 free"
pm2 start /Users/openclaw/mercury402-mcp-runtime/mcp-server/deploy/ecosystem.config.cjs
pm2 logs mercury402-mcp --lines 5 --nostream
#   ... streamable HTTP listening on http://127.0.0.1:3402/mcp; hosts: loopback, mcp.mercury402.com; 60/min per IP (CF-Connecting-IP), 600/min total
curl -s http://127.0.0.1:3402/healthz          # {"status":"ok",...,"paid_mode":false,"endpoint_count":78,...}
pm2 save                                        # survive reboot
```

## 3. cloudflared ingress + DNS (one time)

Back up `~/.cloudflared/config.yml`, then add the `mcp` rule **above** the `http_status:404` catch-all:

```yaml
ingress:
  - hostname: api.mercury402.com
    service: http://localhost:4020
  - hostname: mercury402.uk
    service: http://localhost:4020
  - hostname: www.mercury402.uk
    service: http://localhost:4020
  - hostname: mcp.mercury402.com
    service: http://127.0.0.1:3402
  - service: http_status:404
```

```bash
cp ~/.cloudflared/config.yml ~/.cloudflared/config.yml.bak-$(date +%Y%m%d-%H%M%S)
cloudflared tunnel ingress validate
cloudflared tunnel ingress rule https://mcp.mercury402.com/mcp     # expect the 127.0.0.1:3402 rule
cloudflared tunnel route dns mercury402 mcp.mercury402.com          # creates the proxied CNAME
launchctl kickstart -k gui/$(id -u)/com.cloudflared.mercury402
pgrep -fl cloudflared                                               # exactly ONE process
```

**The tunnel restart also drops `api.mercury402.com` for a few seconds** (same tunnel). cloudflared does not hot-reload a locally managed config. Do it at a quiet moment and re-check the API right after:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://api.mercury402.com/v1/fred/cpi-core   # 402
```

## 4. Verify from outside

```bash
curl -s https://mcp.mercury402.com/healthz
curl -s https://mcp.mercury402.com/ | jq '{mcp_endpoint, paid_mode, tools, endpoint_count}'
curl -s https://mcp.mercury402.com/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '[.result.tools[].name]'
# ["list_endpoints","get_endpoint_data"]
```

Then add it as a remote MCP server in a client (Claude: Settings → Connectors → Add custom connector → `https://mcp.mercury402.com/mcp`), call `list_endpoints`, then `get_endpoint_data` on `/v1/fred/treasury-10y`. You should get a `PAYMENT REQUIRED` quote, not data.

## Releases

The runtime checkout tracks release tags. A new tag is cut per `mcp-server/RELEASING.md`: bump `package.json` and `SERVER_VERSION`, commit, tag, push. That same tag also publishes to npm through `publish-mcp.yml`. To roll the hosted endpoint forward:

```bash
cd /Users/openclaw/mercury402-mcp-runtime
git fetch --tags && git checkout --detach vX.Y.Z
cd mcp-server && npm ci && npm run build
pm2 reload mercury402-mcp && pm2 logs mercury402-mcp --lines 3 --nostream
curl -s http://127.0.0.1:3402/healthz | jq .version      # X.Y.Z
```

## Rollback / take it down

```bash
pm2 delete mercury402-mcp && pm2 save
# remove the mcp.mercury402.com rule from ~/.cloudflared/config.yml, then:
launchctl kickstart -k gui/$(id -u)/com.cloudflared.mercury402
```

With the rule removed, the DNS record can stay: requests fall through to the tunnel's `http_status:404`.

## Notes

- Every `get_endpoint_data` call makes one unpaid request to `https://api.mercury402.com`. Those requests show up in the API's `calls_last_24h` as 402 probes. Paid revenue counters are unaffected.
- PM2 6.x stops apps with SIGINT. `dist/index.js` handles SIGINT and SIGTERM, stops accepting connections, and exits within 5s (`kill_timeout: 6000`).
- Port 3402 is new on the mini. It belongs in the AGENTS.md port list (127.0.0.1 only).
