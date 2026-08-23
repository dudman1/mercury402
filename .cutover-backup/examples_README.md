# Mercury x402 Demo Agent

Mercury402 is a pay-per-call financial data API using the [x402 protocol](https://x402.org). Instead of subscriptions or API keys, you pay tiny amounts of USDC (on Base) for each request—like a vending machine for economic data.

This demo agent fetches Treasury yield curves, unemployment data, and macro indicators, then prints a formatted daily economic brief.

---

## Quick Start

### 1. With a prebuilt payment-signature

```bash
cd examples
PAYMENT_SIGNATURE='<base64_x402_payment_payload>' node mercury-agent.js
```

**Requirements:**
- Node.js 16+
- No npm install needed (uses only Node built-ins)
- A valid x402 payment payload for the request you are making

### 2. Production Mode (Real Payments)

```bash
MERCURY_WALLET_KEY=0x... node mercury-agent.js
```

**Requirements:**
- Funded wallet with USDC on Base (chain 8453)
- x402 wallet / payment processor integration that builds the `payment-signature` header

### 3. Custom Server

```bash
MERCURY_API=http://localhost:4020 PAYMENT_SIGNATURE='<base64_x402_payment_payload>' node mercury-agent.js
```

---

## How It Works

### x402 Payment Flow

```
1. GET /v1/treasury/yield-curve/daily-snapshot
   ← 402 Payment Required
   ← Payment-Required: eyJ4NDAyVmVyc2lvbiI6MiwgImFjY2VwdHMiOlt7Li4ufV19 (base64url)

2. Decode payment descriptor
   {
     "scheme": "exact",
     "network": "eip155:8453",
     "amount": "50000",
     "payTo": "0xF8d59...",
     "asset": "0x83358..."
   }

3. Pay via an x402-compatible client / processor
   ← base64 payment payload for payment-signature header

4. Retry with payment-signature
   GET /v1/treasury/yield-curve/daily-snapshot
   payment-signature: <base64_x402_payment_payload>
   ← 200 OK + data
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_API` | `https://mercury402.uk` | API base URL |
| `PAYMENT_SIGNATURE` | (none) | Optional prebuilt x402 payment payload for a demo request |
| `MERCURY_WALLET_KEY` | (none) | Private key for real x402 payment signing/integration |

### Swap in Your Own Wallet

**For production:**

1. Fund wallet with USDC on Base:
   ```
   Network: Base (8453)
   Asset: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
   ```

2. Export private key:
   ```bash
   export MERCURY_WALLET_KEY=0x1234567890abcdef...
   ```

3. Run agent:
   ```bash
   node mercury-agent.js
   ```

**Cost per run:**
- Treasury yield curve: $0.05
- FRED UNRATE: $0.05
- Macro snapshot: $0.05
- **Total: ~$0.15 per daily brief**

---

## Output Example

```
╔═══════════════════════════════════════╗
║   Mercury x402 Daily Economic Brief  ║
╚═══════════════════════════════════════╝
API: https://mercury402.uk
Mode: payment-signature flow

→ Fetching /v1/treasury/yield-curve/daily-snapshot...
  ← 402 Payment Required
  💰 Price quoted via Payment-Required
  📍 Network: eip155:8453
  💵 Asset: USDC
  🔐 Using payment-signature flow
  ↻ Retrying with payment-signature...
  ✓ Success

  📊 U.S. Treasury Yield Curve
  ────────────────────────────
  3-Month:   3.72%
  2-Year:    3.47%
  10-Year:   4.05%
  30-Year:   4.70%

→ Fetching /v1/fred/UNRATE...
  ← 402 Payment Required
  💰 Price quoted via Payment-Required
  ↻ Retrying with payment-signature...
  ✓ Success

  📈 Unemployment Rate
  ────────────────────────────
  Value:  4.0
  Date:   2026-01-01
  Series: UNRATE

╔═══════════════════════════════════════╗
║   Total Spent: $0.17                  ║
╚═══════════════════════════════════════╝
```

---

## Links

- **x402scan Listing**: https://www.x402scan.com/server/dff9ad75-5d4b-4921-b975-fec7f38a1369
- **Swagger UI (Interactive Docs)**: https://mercury402.uk/docs/api
- **OpenAPI Spec (JSON)**: https://mercury402.uk/openapi.json
- **Quickstart Guide**: https://mercury402.uk/docs
- **Health Check**: https://mercury402.uk/health
- **x402 Protocol Spec**: https://x402.org

---

## Troubleshooting

### `402 Payment Required`

**Problem:** Server keeps rejecting your request

**Solution:** Your client must retry with a valid `payment-signature` generated from the current `Payment-Required` descriptor. Manually constructed `Authorization: Bearer x402_<token>` values are rejected in production.

### `Request timeout`

**Problem:** Server not responding

**Solution:** Check server status:
```bash
curl https://mercury402.uk/health
```

### `No payment-signature provided`

**Problem:** Running the demo without a payment integration

**Solution:** Either export a valid `PAYMENT_SIGNATURE` for a single request or wire the demo to your x402 wallet / processor.

---

## Extending the Demo

### Add More Endpoints

```javascript
// Fetch inflation tracker
const inflation = await fetchWithPayment('/v1/composite/inflation-tracker');

// Fetch specific FRED series
const gdp = await fetchWithPayment('/v1/fred/GDP');
```

### Custom Formatting

```javascript
function formatCustom(data) {
  // Your custom formatting logic
  return `...`;
}
```

### Save to File

```javascript
const fs = require('fs');
fs.writeFileSync('daily-brief.txt', formatYieldCurve(treasury));
```

---

## Production Deployment

### As a Cron Job

```bash
# Run daily at 9 AM
0 9 * * * cd /path/to/examples && node mercury-agent.js >> daily-brief.log 2>&1
```

### As a GitHub Action

```yaml
name: Daily Economic Brief
on:
  schedule:
    - cron: '0 9 * * *'  # 9 AM UTC daily
jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: |
          cd examples
          PAYMENT_SIGNATURE='${{ secrets.MERCURY_PAYMENT_SIGNATURE }}' node mercury-agent.js
```

### With Docker

```dockerfile
FROM node:18-alpine
COPY examples/mercury-agent.js /app/
WORKDIR /app
CMD ["node", "mercury-agent.js"]
```

---

## Support

Questions or issues? Open an issue at:
https://github.com/your-repo/mercury-x402-service

---

**Built with ❤️ using the x402 protocol**

---
*Last updated: 2026-04-20 22:53 ET | Updated by: Forge*
