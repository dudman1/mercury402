# Mercury402 Launch Distribution Assets
**Date:** 2026-03-04  
**Version:** 1.0.0  
**Status:** Ready for distribution

⚠️ **DO NOT POST WITHOUT REVIEW** — These are draft assets for approval

---

## 1. SHOW HN POST

**Title:**
```
Show HN: Mercury402 – Pay-per-call finance data API for AI agents (x402/USDC)
```

**Body:**
```
I built Mercury402 (https://mercury402.uk) – a pay-per-call API for economic data designed specifically for autonomous agents. No API keys, no accounts, no rate limits. Just pay $0.01-0.50 per call in USDC on Base and get Federal Reserve data, Treasury yields, and macro indicators with cryptographic signatures.

Traditional finance APIs require developers to manage API keys, subscriptions, and monthly minimums. For autonomous agents, this creates friction: agents can't sign up for accounts, can't store credentials securely, and can't easily pay for what they use. Mercury402 uses the x402 protocol (https://x402.org) – think HTTP 402 "Payment Required" but actually implemented. An agent requests data, gets back payment instructions, transfers USDC on Base, receives a bearer token, and retries. Total flow: ~3 seconds.

Current endpoints: 14 live, including any FRED economic series ($0.01), Treasury yield curves ($0.02), complete macro snapshots with 10 indicators ($0.05), and historical yield curve data ($0.03). Full pricing at https://mercury402.uk/docs/api. Data includes ECDSA signatures for provenance verification. OpenAPI 3.1 spec available at /openapi.json.

Listed on x402scan marketplace with organic agent discovery. Still iterating on pricing and expanding endpoint coverage. Built this because I wanted AI agents to access real financial data without the traditional API gatekeeping. Open to feedback on what endpoints would be most valuable. Try it at https://mercury402.uk/docs/api (interactive Swagger UI) or check the marketplace listing: https://www.x402scan.com/server/mercury402
```

---

## 2. X/TWITTER THREAD

**Post 1 (Hook):**
```
AI agents can't sign up for Stripe accounts or manage API keys.

But they need real-time economic data: GDP, unemployment, Treasury yields, inflation.

How do you build a finance API that agents can actually pay for? 🧵
```

**Post 2 (Solution):**
```
Enter x402: HTTP 402 "Payment Required" actually implemented.

1. Agent requests data → gets 402 + payment details
2. Pays $0.01-0.50 USDC on Base
3. Gets bearer token from x402 gateway
4. Retries with token → receives data

No accounts. No API keys. Just pay per call.
```

**Post 3 (What's Available):**
```
Mercury402 endpoints (live now):

📊 Any FRED series: $0.01
📈 Treasury yield curve: $0.02
🌍 Macro snapshot (10 indicators): $0.05
📉 Historical yields (90d): $0.03
💰 TIPS rates: $0.02

All with cryptographic provenance signatures.

14 endpoints total.
```

**Post 4 (How to Try):**
```
Try it in 3 commands:

curl https://mercury402.uk/health

curl https://mercury402.uk/v1/fred/UNRATE
# Returns 402 + payment instructions

# Pay via x402 → get token → retry
curl -H "Authorization: Bearer x402_TOKEN" \
  https://mercury402.uk/v1/fred/UNRATE
```

**Post 5 (CTA):**
```
Built for autonomous agents + AI systems.

🔗 Interactive docs: https://mercury402.uk/docs/api
🔗 x402 marketplace: https://x402scan.com/server/mercury402
🔗 GitHub: [TBD after repo public]

Feedback welcome — what endpoints would you want?
```

---

## 3. X402 COMMUNITY POST

**Title:**
```
Mercury402 — 14-endpoint finance data server, USDC on Base
```

**Body:**
```
Hey x402 community! 👋

Just launched Mercury402 (https://mercury402.uk) – a pay-per-call finance data API for autonomous agents. Built it as a real-world x402 implementation and would love feedback from this community.

**What it is:**
Pay-per-call access to Federal Reserve Economic Data (FRED), Treasury yields, and macro indicators. No API keys, no accounts—just x402 payment tokens and USDC on Base.

**Architecture:**
- Runtime: Node.js + Express
- Upstream: FRED API (800,000+ economic series)
- Cache: 6-hour TTL on all premium endpoints
- Pricing: Tiered by endpoint value ($0.01-0.50 per call)
- Signing: ECDSA signatures for data provenance
- OpenAPI: Full spec at /openapi.json + Swagger UI at /docs/api

**x402 Implementation:**
Currently using base64-encoded JSON tokens (`x402_<base64(payload)>`). Token decoder extracts wallet_address and tx_hash for tracking. On-chain verification via Base RPC is next (Phase 2).

Token structure I'm seeing from the gateway:
```json
{
  "wallet": "0x...",
  "tx": "0x...",
  "merchant": "0xF8d59270cBC746a7593D25b6569812eF1681C6D2",
  "amount": "20000",
  "network": "8453",
  "timestamp": 1772661294410
}
```

Is this the standard x402 token format? Or should I expect JWT?

**Endpoints (14 live):**

*Premium:*
- Macro snapshot (10 indicators): $0.05
- Treasury historical (90d): $0.03
- Treasury yield curve: $0.02
- TIPS rates: $0.02
- Auction results (HQM proxy): $0.02

*Composite:*
- Economic dashboard: $0.50
- Inflation tracker: $0.40
- Labor market: $0.40

*Basic:*
- Any FRED series: $0.01

*Free:*
- Health, metrics, discovery, OpenAPI, Swagger UI

**Observability:**
- Revenue monitoring: Convex webhook on each paid call
- Access logging: JSONL with wallet tracking
- Metrics endpoint: /metrics (unique wallets, revenue, cache hit rate)
- GitHub Actions: Health check every 6 hours

**Current traction:**
Listed on x402scan marketplace with organic agent discovery working pre-announcement.

**Questions for the community:**

1. **Pricing:** Is $0.01-0.50 per call reasonable for finance data? FRED is free but rate-limited, Bloomberg Terminal is $2k/month. Trying to find the agent-native middle ground.

2. **Token format:** Should I implement full JWT verification? Or is base64 JSON + on-chain verification sufficient?

3. **Payment bridge:** Waiting on x402 gateway integration. Should I implement direct Base RPC verification in the meantime?

4. **Endpoint coverage:** What other finance data would be valuable? Crypto prices? Stock quotes? FX rates?

5. **Provenance:** Currently signing all responses with ECDSA. Is this overkill or do agents actually verify signatures?

**Try it:**
- Swagger UI: https://mercury402.uk/docs/api
- x402scan listing: https://www.x402scan.com/server/mercury402
- Health check: `curl https://mercury402.uk/health`

**Code:**
Planning to open-source once I clean up the repo. Built with Express, ethers.js, axios, js-yaml for OpenAPI. Pretty standard Node stack.

Would love feedback on pricing, endpoints, or x402 integration! This is my first x402 service so learning as I go.

— Mercury402 Team
```

---

## 4. RAPIDAPI LISTING

**Title:**
```
Mercury402 - Finance Data for AI Agents
```

**Tagline:**
```
Pay-per-call economic data API with x402 protocol. No API keys needed.
```

**Category:**
```
Financial / Data APIs
```

**Long Description (150 words):**
```
Mercury402 provides pay-per-call access to Federal Reserve Economic Data (FRED), U.S. Treasury yields, and macro indicators designed for autonomous agents and AI systems. Instead of traditional API keys and subscriptions, Mercury402 uses the x402 protocol: pay in USDC on Base blockchain and receive instant access with cryptographic signatures for data provenance.

Access 800,000+ FRED economic series ($0.01/call), current Treasury yield curves ($0.02), complete macro snapshots with GDP, unemployment, inflation, and market sentiment ($0.05), historical yield data ($0.03), and TIPS rates ($0.02). All responses include ECDSA signatures for verification.

Designed for autonomous systems that can't manage traditional API credentials. No rate limits, no monthly minimums, no account setup—just pay per call. Perfect for AI agents, trading bots, economic research tools, and automated financial analysis systems.
```

**Use Cases:**

1. **Autonomous Trading Bots**
   AI agents monitoring Treasury yields and macro indicators to inform trading decisions without managing API keys or subscriptions.

2. **Economic Research Automation**
   Research bots pulling GDP, unemployment, and inflation data for automated analysis and report generation.

3. **Financial Dashboard Agents**
   AI systems building real-time economic dashboards with data from multiple FRED series and Treasury endpoints.

4. **Market Sentiment Analysis**
   Agents tracking VIX, dollar index, and consumer sentiment alongside core economic indicators for comprehensive market views.

5. **Backtesting Systems**
   Automated systems pulling historical yield curves and macro data for strategy backtesting without API rate limits.

**Pricing Table:**

| Endpoint | Price (USDC) | Description |
|----------|--------------|-------------|
| FRED Series | $0.01 | Any of 800,000+ economic series |
| Treasury Yield Curve | $0.02 | Current rates (11 maturities) |
| Macro Snapshot | $0.05 | GDP, CPI, unemployment, rates, VIX, sentiment |
| Historical Yields | $0.03 | 90-day historical yield curves |
| TIPS Rates | $0.02 | Treasury Inflation-Protected Securities |
| Auction Results | $0.02 | Recent Treasury auction data (HQM proxy) |
| Economic Dashboard | $0.50 | Composite GDP, CPI, unemployment |
| Inflation Tracker | $0.40 | CPI, PCE, Core CPI composite |
| Labor Market | $0.40 | Unemployment, claims, payrolls composite |

**Authentication Method:**
```
x402 Bearer Token

1. Request data → Receive 402 Payment Required
2. Pay USDC on Base (chain 8453)
3. Receive x402 bearer token from payment gateway
4. Retry request with: Authorization: Bearer x402_<token>

No API key required. No account signup. Pay per call.
```

**Base URL:**
```
https://mercury402.uk
```

**Documentation:**
```
https://mercury402.uk/docs/api (Interactive Swagger UI)
https://mercury402.uk/openapi.json (OpenAPI 3.1 spec)
```

---

## 5. X402SCAN LISTING UPDATE

**Current listing:**
```
https://www.x402scan.com/server/dff9ad75-5d4b-4921-b975-fec7f38a1369
```

**New Description (max 300 chars):**
```
Pay-per-call finance data API for AI agents. 14 endpoints: FRED economic series ($0.01), Treasury yields ($0.02), macro snapshots ($0.05), historical data ($0.03). No API keys. USDC on Base. OpenAPI spec + Swagger UI. Cryptographic provenance on all data.
```

**Alternative (tighter, 280 chars):**
```
Economic data for autonomous agents. 14 endpoints: FRED series ($0.01), Treasury yields ($0.02), macro indicators ($0.05), historical curves ($0.03). No API keys, just x402 + USDC on Base. Full OpenAPI spec. Provenance signatures included.
```

**Tags to Request:**
- Finance
- Economics
- Treasury
- FRED
- Macro
- Data
- AI-Agents
- Autonomous
- Base
- USDC

**Version:**
```
v1.0.0 (14 endpoints, tiered pricing, OpenAPI 3.1)
```

**Updated Endpoint List:**

| Endpoint | Method | Price |
|----------|--------|-------|
| /v1/fred/{series_id} | GET | $0.01 |
| /v1/treasury/yield-curve/daily-snapshot | GET | $0.02 |
| /v1/macro/snapshot/all | POST | $0.05 |
| /v1/treasury/yield-curve/historical | POST | $0.03 |
| /v1/treasury/auction-results/recent | POST | $0.02 |
| /v1/treasury/tips-rates/current | POST | $0.02 |
| /v1/composite/economic-dashboard | POST | $0.50 |
| /v1/composite/inflation-tracker | POST | $0.40 |
| /v1/composite/labor-market | POST | $0.40 |
| /.well-known/x402 | GET | Free |
| /health | GET | Free |
| /metrics | GET | Free |
| /openapi.json | GET | Free |
| /docs/api | GET | Free |

**Support URL:**
```
https://github.com/YOUR_USERNAME/mercury402/issues
```

**Homepage:**
```
https://mercury402.uk
```

---

## CLAIMS REQUIRING VERIFICATION

Before posting any of these assets, verify:

1. **"~13 agents discovering endpoints"**
   - Check actual count in access logs
   - Verify these are real agent calls (not test traffic)

2. **"Early revenue: $0.30-0.50/day baseline"**
   - Check current revenue in metrics endpoint
   - Confirm this is accurate as of launch date

3. **"800,000+ FRED series available"**
   - Verify this is the correct count from FRED documentation
   - Source: https://fred.stlouisfed.org/

4. **"Cryptographic provenance on all data"**
   - Confirm ECDSA signatures are working in production
   - Test a few endpoints to verify signature field is present

5. **"6-hour TTL cache"**
   - Verify CACHE_TTL constant in server.js is 6 hours
   - Confirm this is applied to all premium endpoints

6. **"Base chain 8453"**
   - Verify merchant wallet is on Base mainnet
   - Confirm USDC contract address is correct for Base

7. **x402 token format (base64 JSON)**
   - Verify this is what's actually being observed in production
   - Check if x402 gateway documentation specifies format

8. **Merchant wallet address**
   - Confirm: 0xF8d59270cBC746a7593D25b6569812eF1681C6D2
   - Verify this is the correct production wallet

9. **GitHub repository URL**
   - Replace YOUR_USERNAME with actual org/username
   - Confirm repo is public before sharing links

10. **x402scan listing UUID**
    - Verify: dff9ad75-5d4b-4921-b975-fec7f38a1369
    - Confirm this is the correct live listing

---

## SUGGESTED POSTING ORDER

For maximum impact, follow this sequence:

### Phase 1: Community Validation (Day 1)
**x402 Community Post** (Discord/forum)
- **Why first:** Get technical feedback from protocol experts
- **Timing:** Morning (9-10 AM ET)
- **Goal:** Validate x402 implementation, get pricing feedback
- **Expected:** 5-10 technical responses, potential bug reports

### Phase 2: Developer Discovery (Day 1-2)
**Show HN Post** (news.ycombinator.com)
- **Why second:** Hacker News front page = developer attention
- **Timing:** 8-9 AM ET on a weekday (Tuesday-Thursday best)
- **Goal:** Drive technical users to Swagger UI, gather feedback
- **Expected:** 20-50 upvotes if well-received, comments = engagement

### Phase 3: Social Amplification (Day 2-3)
**X/Twitter Thread**
- **Why third:** Amplify HN traction, reach agent developers
- **Timing:** 2-3 hours after Show HN post (if gaining traction)
- **Goal:** Drive traffic to x402scan listing, build awareness
- **Expected:** 10-20 retweets from agent/crypto community

### Phase 4: Marketplace Listings (Day 3-7)
**x402scan Update** + **RapidAPI Listing**
- **Why last:** Already have social proof and feedback
- **Timing:** After collecting initial feedback from HN/Twitter
- **Goal:** Capture search traffic, establish marketplace presence
- **Expected:** Organic agent discovery, baseline revenue growth

---

## POST-LAUNCH MONITORING

After posting, track:

1. **Traffic spikes:**
   - `tail -f ~/.openclaw/LOGS/mercury402-access.jsonl`
   - Check /metrics endpoint for unique_wallets growth

2. **GitHub issues:**
   - Monitor repo for bug reports, feature requests
   - Health check workflow may create issues if traffic spikes

3. **x402scan discovery:**
   - Check if new agents are calling /.well-known/x402
   - Monitor unique wallet_address count

4. **Social engagement:**
   - HN: Respond to comments within 2-4 hours
   - Twitter: Engage with replies and retweets
   - x402 community: Answer technical questions promptly

5. **Revenue metrics:**
   - Expect 2-10x baseline revenue in first 48 hours
   - Log rotation may trigger if traffic exceeds 250k requests

---

## CONTINGENCY PLANS

**If server goes down during launch:**
1. GitHub Actions will create issue within 6 hours
2. Check cloudflared tunnel status
3. Restart server: `pm2 restart mercury402` or manual restart
4. Post status update: "Experiencing high traffic, scaling up"

**If pricing seems wrong:**
1. Do NOT change prices during first 48 hours
2. Collect feedback in GitHub issues
3. Consider pricing adjustment after initial wave

**If x402 bridge breaks:**
1. Tokens may fail validation
2. Fall back to test token mode temporarily
3. Notify x402 community of bridge issues

**If FRED API rate limits hit:**
1. Cache will serve most requests
2. 503 errors will appear for cache misses
3. Consider upgrading FRED API key tier

---

## DRAFT STATUS

**Ready to post:**
- ✅ Show HN (needs verification of claims)
- ✅ Twitter thread (ready as-is)
- ✅ x402 community (needs token format confirmation)

**Needs updates before posting:**
- ⏳ RapidAPI (depends on marketplace approval process)
- ⏳ x402scan (needs confirmation of UUID and tag approval)

**Blocked until:**
- ❌ GitHub repo is public (replace YOUR_USERNAME placeholders)
- ❌ Claims verified (see "Claims Requiring Verification" section)

---

**END OF LAUNCH ASSETS**

**Date Generated:** 2026-03-04  
**Status:** Draft — Review required before posting  
**Next Step:** Verify all claims, update placeholders, make repo public
