# Mercury x402 Service

Deterministic financial data with cryptographic provenance.

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your FRED_API_KEY and SERVER_PRIVATE_KEY

# Start server
npm start

# Development (with auto-reload)
npm run dev
```

## Endpoints

### FRED Economic Data

```bash
# Latest unemployment rate
curl http://localhost:4020/v1/fred/UNRATE

# 10Y Treasury rate on specific date
curl 'http://localhost:4020/v1/fred/DGS10?date=2026-01-01'

# GDP historical range
curl 'http://localhost:4020/v1/fred/GDP?observation_start=2020-01-01&observation_end=2023-12-31'
```

### Treasury Yield Curve

```bash
# Daily snapshot (with provenance)
curl http://localhost:4020/v1/treasury/yield-curve/daily-snapshot

# Legacy format (without provenance)
curl 'http://localhost:4020/v1/treasury/yield-curve/daily-snapshot?v=0.9'
```

### Discovery & Health

```bash
# x402 discovery document
curl http://localhost:4020/.well-known/x402

# Health check
curl http://localhost:4020/health
```

## Configuration

### Required Environment Variables

- `FRED_API_KEY` - Get free API key at https://fred.stlouisfed.org/docs/api/api_key.html
- `SERVER_PRIVATE_KEY` - Ethereum private key for signing provenance (without 0x prefix)

### Optional Environment Variables

- `PORT` - Server port (default: 4020)

## Generate Signing Key

```bash
# Generate new private key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Get corresponding address
node -e "const {Wallet} = require('ethers'); const w = new Wallet('YOUR_PRIVATE_KEY'); console.log(w.address)"
```

## Deployment

### Local Testing

```bash
npm install
npm start
```

Server runs on http://localhost:4020

### Production (mercury402.uk)

Options:
1. Deploy as Node.js service with PM2/systemd
2. Deploy to Cloudflare Workers (requires adaptation)
3. Deploy to Vercel/Netlify Functions

Recommended: Node.js with reverse proxy (nginx/Caddy) handling SSL termination.

## Verification

Test complete 402 → pay → 200 flow:

```bash
# Should return 402 (if x402 payment gate enabled)
curl -is http://localhost:4020/v1/fred/UNRATE

# After payment, should return 200 with data
# (x402 payment logic not yet implemented - returns data immediately for testing)
```

## Next Steps

1. ✅ Service created
2. ⏳ Install dependencies
3. ⏳ Configure environment (.env)
4. ⏳ Start server locally
5. ⏳ Test endpoints
6. ⏳ Deploy to mercury402.uk
7. ⏳ Enable x402 payment logic
8. ⏳ Submit to x402scan marketplace

## Support

Specs: `/Users/openclaw/.openclaw/workspace-mercury/`
Docs: https://mercury402.uk/docs (after deployment)
