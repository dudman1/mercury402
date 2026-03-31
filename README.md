# Mercury402

![Live](https://img.shields.io/badge/status-live-brightgreen) ![Endpoints](https://img.shields.io/badge/endpoints-76-blue) ![Base/USDC](https://img.shields.io/badge/chain-Base%20%2F%20USDC-blue) ![x402](https://img.shields.io/badge/protocol-x402-purple)

## Deterministic Finance Data for Autonomous Agents

Mercury402 provides pay-per-call economic data APIs for AI agents and autonomous systems. No API keys, no accounts, no rate limits—just pay in USDC on Base via the x402 protocol and get instant access to Federal Reserve data, Treasury yields, and macro indicators with cryptographic provenance.

**Live at:** https://mercury402.uk

---

## Endpoints

| Endpoint | Data | Price (USDC) |
|----------|------|--------------|
| `GET /v1/fred/{series_id}` | Any FRED economic series | $0.01 |
| `GET /v1/treasury/yield-curve/daily-snapshot` | Current Treasury yield curve (11 maturities) | $0.02 |
| `POST /v1/macro/snapshot/all` | Complete macro snapshot (GDP, CPI, unemployment, rates, VIX, dollar index, sentiment) | $0.05 |
| `POST /v1/treasury/yield-curve/historical` | Historical yield curves (max 90-day range) | $0.03 |
| `POST /v1/treasury/auction-results/recent` | Recent auction results (HQM proxy) | $0.02 |
| `POST /v1/treasury/tips-rates/current` | Current TIPS rates (5, 7, 10, 20, 30-year) | $0.02 |
| `POST /v1/composite/economic-dashboard` | Economic overview (GDP, CPI, unemployment) | $0.50 |
| `POST /v1/composite/inflation-tracker` | Inflation metrics (CPI, PCE, Core CPI) | $0.40 |
| `POST /v1/composite/labor-market` | Labor market data (unemployment, claims, payrolls) | $0.40 |
| `GET /.well-known/x402` | x402 discovery document | Free |
| `GET /health` | Health check | Free |
| `GET /metrics` | Revenue and usage stats | Free |
| `GET /openapi.json` | OpenAPI 3.1 spec | Free |
| `GET /docs/api` | Interactive Swagger UI | Free |

**76 total endpoints** (72 standard data endpoints + 2 premium composite + 2 free discovery/health endpoints)

---

## Quick Start

```bash
# 1. Try a free health check
curl https://mercury402.uk/health

# 2. Attempt to access data (returns 402 Payment Required)
curl https://mercury402.uk/v1/fred/UNRATE

# 3. Pay via x402 and retry with your token
curl -H "Authorization: Bearer x402_YOUR_TOKEN" \
  https://mercury402.uk/v1/fred/UNRATE
```

See [`examples/`](./examples/) for agent integration code.

---

## x402 Payment Flow

1. **Request data** → Server returns `402 Payment Required` with payment details
2. **Pay in USDC** → Transfer via Base blockchain to merchant wallet
3. **Get token** → x402 gateway verifies payment and issues bearer token
4. **Retry request** → Include `Authorization: Bearer x402_<token>` header
5. **Receive data** → Server validates token and returns data with cryptographic signature

**Marketplace listing:** https://www.x402scan.com/server/mercury402

---

## Documentation

- **Swagger UI:** https://mercury402.uk/docs/api
- **OpenAPI Spec:** https://mercury402.uk/openapi.json
- **x402scan Listing:** https://www.x402scan.com/server/mercury402
- **Examples:** [`examples/README.md`](./examples/README.md)

---

## Features

✅ **No API keys or accounts** — Pay-per-call via USDC on Base  
✅ **Deterministic data** — All responses include FRED series metadata and provenance signatures  
✅ **Cryptographic provenance** — ECDSA signatures verify data authenticity  
✅ **Rate-limited free tier** — Health and discovery endpoints always available  
✅ **Agent-friendly** — Designed for autonomous systems and AI agents  

---

## Tech Stack

- **Runtime:** Node.js + Express
- **Data source:** Federal Reserve Economic Data (FRED) API
- **Payment:** x402 protocol (USDC on Base)
- **Signing:** ethers.js + ECDSA

---

## Self-Hosting

```bash
# Clone and install
git clone https://github.com/dudman1/mercury402.git
cd mercury402
npm install

# Configure environment
cp .env.example .env
# Add your FRED_API_KEY and SERVER_PRIVATE_KEY

# Start server
npm start
```

Server runs on http://localhost:4020

See [deployment docs](./docs/DEPLOYMENT.md) for production setup.

---

## Support

**Issues:** [GitHub Issues](https://github.com/dudman1/mercury402/issues)  
**Funding:** https://mercury402.uk

---

## License

MIT
