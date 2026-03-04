# Changelog

All notable changes to Mercury402 will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-03-04

### Initial Public Release

**14 Live Endpoints:**
- FRED economic series access (11 Treasury yields, 10 macro indicators, 5 TIPS rates, 5 HQM proxies)
- Treasury yield curve snapshots
- Macro indicator snapshots
- Historical Treasury data
- TIPS rates
- Auction results (HQM proxy)
- Composite endpoints (economic dashboard, inflation tracker, labor market)

**Payment Protocol:**
- x402 protocol integration (USDC on Base, chain 8453)
- Tiered pricing: $0.01-$0.50 per call
- Base64 JSON token decoding
- Wallet address tracking
- Transaction hash logging

**API Infrastructure:**
- OpenAPI 3.1 specification at `/openapi.json`
- Interactive Swagger UI at `/docs/api`
- x402 discovery document at `/.well-known/x402`
- Health endpoint with service diagnostics
- Metrics endpoint with revenue tracking

**Observability:**
- Access logging (JSONL format with wallet metadata)
- Revenue monitoring with Convex webhook integration
- Log rotation (50MB max file size, keep last 7 rotated files)
- Metrics endpoint rate limiting (60 req/min per IP)
- Startup directory validation

**Performance:**
- 6-hour TTL cache for all premium endpoints
- Concurrency limiting (5 concurrent FRED requests)
- 90-day maximum range for historical endpoints
- Cache hit rate tracking

**Data Provenance:**
- ECDSA signatures on all paid responses
- Signing wallet: `0xe76795db4100E10374d19E91742A392C658f3a43`
- Timestamp inclusion in all responses
- Cryptographic verification support

**Operational:**
- GitHub Actions health check workflow (runs every 6 hours)
- Automated issue creation on health check failures
- Production-ready error handling
- CORS support for browser-based agents

**Documentation:**
- Public-facing README with badges and endpoint table
- Example curl commands in `examples/README.md`
- OpenAPI 3.1 spec with full endpoint documentation
- Launch distribution assets for community outreach

---

## [Unreleased]

### Planned

- Full on-chain payment verification via Base RPC
- Additional composite endpoints (FX rates, crypto correlation)
- Websocket support for real-time data streams
- Historical data export (CSV/JSON bulk downloads)
- API client libraries (Python, JavaScript, Rust)

---

[1.0.0]: https://github.com/dudman1/mercury402/releases/tag/v1.0.0
