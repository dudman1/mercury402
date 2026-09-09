# AI Endpoints Report — /v1/ai/briefing + /v1/ai/ask (2026-08-22)

## What
Two ox-alpha-powered x402 endpoints. Inference via OpenRouter stealth model = $0 marginal cost → ~100% margin on every sale.

| Endpoint | Method | Price | What it does |
|---|---|---|---|
| /v1/ai/briefing | GET | $0.10 | ≤220-word macro briefing (headline, Growth/Prices/Labor bullets, risk flag) written ONLY from 6 live FRED series |
| /v1/ai/ask | POST | $0.15 | Natural-language question answered strictly from up to 6 chosen FRED series (12 obs each), cited dates/values, INSUFFICIENT_DATA escape |

## Files touched (backups alongside)
- src/ai-routes.js (NEW) — registerAiRoutes(app, deps), mirrors new-routes.js pattern
- src/server.js — mount block after NEW_ENDPOINT_META (~line 2141); bak-* -ai-routes
- src/pricing.js — +$0.10/$0.15 entries; bak-* -ai-routes

## Verified (isolated :4021 instance, prod untouched)
- health OK; syntax OK both files
- /.well-known/x402 manifest includes both endpoints (78 total, was 76)
- GET /v1/ai/briefing → HTTP 402 challenge, maxAmountRequired 100000 ($0.10) ✓
- POST /v1/ai/ask → HTTP 402 challenge, maxAmountRequired 150000 ($0.15) ✓

## GO-LIVE: DONE (2026-08-22 23:27)
1. OPENROUTER_API_KEY copied from ~/.hermes/.env into service .env (.env.bak-* -ai)
2. Payments-in-flight check: metrics showed $0 revenue last 24h → pm2 restart mercury402-server x2
3. Live inference verified: callOxAlpha test returned "MERCURY AI ONLINE" via stealth/ox-alpha
4. Prod manifest: /v1/ai/briefing + /v1/ai/ask discoverable; health OK
NOTE: ox-alpha is a REASONING model — token budgets set 1600/1200 after 20-token probe returned empty content (finish_reason=length).

## Next steps
- MCP server wrapper so Claude/agents discover+pay autonomously
- Cache TTL tuning for briefing (currently CACHE_TTL.FRED)

## Quality Pass (2026-08-22 23:45) — PASS after fixes
Probed REAL handlers via scripts/ai-quality-probe.js (:4022, paywall bypassed).
Findings → fixes:
1. Reasoning model exhausted 1200-token budget on hidden thinking (finish_reason=length, empty content) → budgets raised to 3000/2400
2. 45s inference timeout too tight for long generations → 90s; ask bounded to ≤150 words
3. Added self-healing: on length-exhaustion retry once at 2x budget
Results: briefing cited every input figure correctly incl. payroll/unemployment divergence risk flag;
ask computed MoM inflation from raw index levels (+0.074% July ✓), caught missing FRED observation,
correctly refused mortgage question via INSUFFICIENT_DATA with specific missing-data list.
Latency note: ~25s per ask (reasoning model). Agents should use generous HTTP timeouts.
