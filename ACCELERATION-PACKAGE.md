# Mercury402 Acceleration Package
**Generated:** 2026-03-04  
**Objective:** Make Mercury402 deterministic, testable, and integration-ready

---

## 1. ENDPOINT INVENTORY

| Route | Method | Params | Price | Upstream | Caching | Determinism Risks |
|-------|--------|--------|-------|----------|---------|-------------------|
| `/v1/fred/{series_id}` | GET | `series_id` (path), `date`, `observation_start`, `observation_end`, `limit` (query) | $0.15 single / $0.30 range | FRED API (api.stlouisfed.org/fred/series/observations) | None | • FRED upstream changes<br>• Timezone handling (date boundaries)<br>• API response schema drift<br>• Missing data / null handling<br>• Upstream revisions |
| `/v1/treasury/yield-curve/daily-snapshot` | GET | `date` (optional), `v` (version: 0.9 or 1.0) | $0.10 | **MOCK DATA** (placeholder) | None | • Not yet implemented (returns hardcoded mock)<br>• No real Treasury.gov scraper<br>• Date parsing not enforced<br>• v0.9 vs v1.0 format drift |
| `/v1/composite/economic-dashboard` | GET | None | $0.50 | FRED API (GDP, CPIAUCSL, UNRATE) | None | • Inherits all FRED risks × 3<br>• Composite timing (series not always aligned)<br>• Missing units/metadata from one source<br>• Parallel fetch ordering (race) |
| `/v1/composite/inflation-tracker` | GET | None | $0.40 | FRED API (CPIAUCSL, PCEPI, CPILFESL) | None | • Inherits all FRED risks × 3<br>• Inflation data often revised<br>• Series frequency mismatch |
| `/v1/composite/labor-market` | GET | None | $0.40 | FRED API (UNRATE, ICSA, PAYEMS) | None | • Inherits all FRED risks × 3<br>• Labor data heavily revised (NFP)<br>• Weekly vs monthly frequency conflict |
| `/.well-known/x402` | GET | None | FREE | Static config | Forever | None (static manifest) |
| `/health` | GET | None | FREE | Runtime state | None | Signing wallet state only |
| `/` | GET | None | FREE | Static HTML/JSON | Forever | None |
| `/docs` | GET | None | FREE | Static HTML | Forever | None |
| `/meta.json` | GET | None | FREE | Static manifest | Forever | None |
| `/sdk-examples` | GET | None | FREE | Static markdown | Forever | None |
| `/demo` | GET | None | FREE | Static HTML | Forever | None |

### Current Determinism Status: **🔴 POOR**
- FRED data has NO caching → every call hits live API (subject to revisions)
- Treasury endpoint is **mock data** → not production-ready
- No timestamp normalization (all times use `Date.now()` / `new Date()`)
- Composite endpoints have race conditions (parallel fetches)
- No versioning strategy for schema changes
- Provenance signature uses `fetched_at` (non-deterministic timestamp)

---

## 2. DETERMINISM SPECIFICATION

### 2.1 Timezone Rules
**Problem:** `new Date().toISOString()` uses server local time, not UTC canonical.

**Solution:**
- ALL timestamps MUST use UTC and ISO 8601 format: `YYYY-MM-DDTHH:mm:ss.sssZ`
- Date-only queries (`?date=2026-01-01`) MUST be interpreted as UTC start-of-day (00:00:00Z)
- FRED `observation_start`/`observation_end` params forwarded as-is (assume FRED handles date boundaries)
- `fetched_at` in provenance MUST use UTC

**Implementation:**
```javascript
// Replace: new Date().toISOString()
// With:
function utcNow() {
  return new Date().toISOString(); // already UTC if done correctly
}

// For date-only params:
function parseUTCDate(dateStr) {
  return new Date(`${dateStr}T00:00:00.000Z`);
}
```

### 2.2 Rounding & Precision
**Problem:** FRED returns values as strings (e.g., `"4.3"`). No explicit rounding policy.

**Solution:**
- Preserve FRED string values AS-IS in `observations[].value`
- Do NOT parse to float and re-stringify (introduces rounding)
- Treasury mock data uses 2 decimal places → standardize to **4 decimals** for rates

### 2.3 Missing Data / Null Handling
**Problem:** FRED returns `"."` for missing values. No explicit handling.

**Solution:**
- If `obs.value === "."`, treat as `null` in JSON response
- Document missing data policy in provenance: `"missing_value_strategy": "null"`

```javascript
observations: fredData.observations.map(obs => ({
  date: obs.date,
  value: obs.value === "." ? null : obs.value
}))
```

### 2.4 Upstream Revisions
**Problem:** FRED data can be revised (GDP, NFP, etc.). Historical calls may return different values over time.

**Solution:**
- Add `data_vintage` field to provenance (FRED provides `last_updated`)
- Enable clients to request specific vintage: `?as_of_date=2026-03-01` (requires caching layer)
- Document revision policy: "Latest available data unless `as_of_date` specified"

### 2.5 Caching Strategy
**Problem:** No caching → every call hits upstream → non-deterministic over time.

**Solution (Phase 1 — Simple):**
- Cache FRED responses for **24 hours** keyed by `{series_id, date, observation_start, observation_end}`
- Cache Treasury snapshot for **24 hours** keyed by `{date}`
- Use in-memory LRU cache (production: Redis)

**Solution (Phase 2 — Deterministic Archive):**
- Store every upstream response with `{fetched_at, series_id, params, response_hash}`
- Allow clients to query historical cache: `?as_of=2026-03-01T12:00:00Z`
- Signature covers `{data, fetched_at}` → reproducible provenance

### 2.6 Versioning
**Problem:** `/v1/` prefix exists but no schema versioning beyond Treasury's `?v=0.9`.

**Solution:**
- Introduce `X-Mercury-Version: 1.0` response header on all endpoints
- Breaking changes require new major version: `/v2/fred/{series_id}`
- Non-breaking additions (new fields) allowed in v1

### 2.7 Provenance Signature Determinism
**Problem:** Signature includes `fetched_at` (changes every call) → non-reproducible.

**Solution:**
- For deterministic signatures, sign ONLY canonical data:
  ```javascript
  const canonical = JSON.stringify({
    series_id: seriesId,
    observations: data.observations, // sorted by date
    params: { date, observation_start, observation_end }
    // NO fetched_at
  });
  ```
- Add separate `temporal_signature` that includes `fetched_at` for audit trail

---

## 3. OPENAPI SCHEMA

Save as: `~/mercury-x402-service/openapi.yaml`

```yaml
openapi: 3.1.0
info:
  title: Mercury x402 API
  version: 1.0.0
  description: |
    Deterministic financial data with cryptographic provenance.
    Payment required via x402 protocol (HTTP 402 + USDC on Base).
  contact:
    name: Mercury Support
    url: https://mercury402.uk
servers:
  - url: https://mercury402.uk
    description: Production
  - url: http://localhost:4020
    description: Local development

security:
  - x402Bearer: []

paths:
  /v1/fred/{series_id}:
    get:
      summary: Fetch FRED economic series data
      operationId: getFredSeries
      tags: [FRED]
      security:
        - x402Bearer: []
      parameters:
        - name: series_id
          in: path
          required: true
          schema:
            type: string
          example: UNRATE
          description: FRED series ID (e.g., GDP, UNRATE, DGS10)
        - name: date
          in: query
          schema:
            type: string
            format: date
          example: "2026-01-01"
          description: Single date observation (YYYY-MM-DD)
        - name: observation_start
          in: query
          schema:
            type: string
            format: date
          example: "2020-01-01"
          description: Start date for range query
        - name: observation_end
          in: query
          schema:
            type: string
            format: date
          example: "2023-12-31"
          description: End date for range query
        - name: limit
          in: query
          schema:
            type: integer
            minimum: 1
            maximum: 1000
            default: 1
          description: Max observations to return (default 1 = latest)
      responses:
        '200':
          description: Successful response with data and provenance
          headers:
            X-Mercury-Price:
              schema:
                type: string
              example: "$0.15"
            X-Mercury-Version:
              schema:
                type: string
              example: "1.0"
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/FREDResponse'
        '402':
          description: Payment required
          headers:
            Payment-Required:
              schema:
                type: string
              description: Base64url-encoded x402 payment descriptor
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/PaymentRequired'
        '404':
          $ref: '#/components/responses/SeriesNotFound'
        '429':
          $ref: '#/components/responses/RateLimitExceeded'
        '500':
          $ref: '#/components/responses/InternalError'
        '503':
          $ref: '#/components/responses/ServiceUnavailable'

  /v1/treasury/yield-curve/daily-snapshot:
    get:
      summary: Daily U.S. Treasury par yield curve snapshot
      operationId: getTreasuryYieldCurve
      tags: [Treasury]
      security:
        - x402Bearer: []
      parameters:
        - name: date
          in: query
          schema:
            type: string
            format: date
          example: "2026-03-01"
          description: Specific date (defaults to latest)
        - name: v
          in: query
          schema:
            type: string
            enum: ["0.9", "1.0"]
            default: "1.0"
          description: Response format version
      responses:
        '200':
          description: Treasury yield curve data
          content:
            application/json:
              schema:
                oneOf:
                  - $ref: '#/components/schemas/TreasuryResponseV1'
                  - $ref: '#/components/schemas/TreasuryResponseV0_9'
        '402':
          $ref: '#/components/responses/PaymentRequired'

  /v1/composite/economic-dashboard:
    get:
      summary: Economic overview (GDP + CPI + Unemployment)
      operationId: getEconomicDashboard
      tags: [Composite]
      security:
        - x402Bearer: []
      responses:
        '200':
          description: Composite economic indicators
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CompositeResponse'
        '402':
          $ref: '#/components/responses/PaymentRequired'

  /v1/composite/inflation-tracker:
    get:
      summary: Inflation metrics (CPI + PCE + Core CPI)
      operationId: getInflationTracker
      tags: [Composite]
      security:
        - x402Bearer: []
      responses:
        '200':
          description: Inflation dashboard
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CompositeResponse'
        '402':
          $ref: '#/components/responses/PaymentRequired'

  /v1/composite/labor-market:
    get:
      summary: Labor market health (Unemployment + Claims + Payrolls)
      operationId: getLaborMarket
      tags: [Composite]
      security:
        - x402Bearer: []
      responses:
        '200':
          description: Labor market indicators
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CompositeResponse'
        '402':
          $ref: '#/components/responses/PaymentRequired'

  /.well-known/x402:
    get:
      summary: x402 protocol discovery document
      operationId: getX402Discovery
      tags: [Discovery]
      security: []
      responses:
        '200':
          description: Payment protocol configuration
          content:
            application/json:
              schema:
                type: object
                properties:
                  x402Version:
                    type: integer
                    example: 2
                  accepts:
                    type: array
                    items:
                      $ref: '#/components/schemas/X402Accept'

  /health:
    get:
      summary: Service health check
      operationId: getHealth
      tags: [Meta]
      security: []
      responses:
        '200':
          description: Health status
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    type: string
                    example: healthy
                  timestamp:
                    type: string
                    format: date-time
                  version:
                    type: string
                    example: "1.0.0"
                  signing_address:
                    type: string
                    example: "0x..."
                  fred_configured:
                    type: boolean

components:
  securitySchemes:
    x402Bearer:
      type: http
      scheme: bearer
      bearerFormat: x402_<token>
      description: |
        x402 payment token obtained after USDC payment on Base.
        Format: `Bearer x402_<token>`

  schemas:
    FREDResponse:
      type: object
      required: [data, provenance]
      properties:
        data:
          type: object
          required: [series_id, observations]
          properties:
            series_id:
              type: string
              example: UNRATE
            title:
              type: string
              example: "Unemployment Rate"
            units:
              type: string
              example: "Percent"
            frequency:
              type: string
              example: "Monthly"
            seasonal_adjustment:
              type: string
              example: "Seasonally Adjusted"
            last_updated:
              type: string
              format: date-time
            observation_count:
              type: integer
            observations:
              type: array
              items:
                type: object
                required: [date, value]
                properties:
                  date:
                    type: string
                    format: date
                  value:
                    oneOf:
                      - type: string
                      - type: "null"
                    example: "4.3"
        provenance:
          $ref: '#/components/schemas/Provenance'

    TreasuryResponseV1:
      type: object
      required: [data, provenance]
      properties:
        data:
          $ref: '#/components/schemas/TreasuryData'
        provenance:
          $ref: '#/components/schemas/Provenance'

    TreasuryResponseV0_9:
      $ref: '#/components/schemas/TreasuryData'

    TreasuryData:
      type: object
      required: [record_date, rates]
      properties:
        record_date:
          type: string
          format: date
        rates:
          type: object
          additionalProperties:
            type: number
          example:
            "1_MONTH": 4.42
            "3_MONTH": 4.38
            "10_YEAR": 4.19
            "30_YEAR": 4.52

    CompositeResponse:
      type: object
      required: [data, provenance]
      properties:
        data:
          type: object
          required: [dashboard, timestamp, indicators]
          properties:
            dashboard:
              type: string
              example: "economic-overview"
            timestamp:
              type: string
              format: date-time
            indicators:
              type: array
              items:
                type: object
                required: [series_id, value, date]
                properties:
                  series_id:
                    type: string
                  title:
                    type: string
                  value:
                    oneOf:
                      - type: string
                      - type: "null"
                  date:
                    type: string
                    format: date
                  units:
                    type: string
        provenance:
          $ref: '#/components/schemas/Provenance'

    Provenance:
      type: object
      required: [source, source_url, fetched_at, mercury_version, deterministic]
      properties:
        source:
          type: string
          example: "Federal Reserve Economic Data (FRED)"
        source_url:
          type: string
          format: uri
        fetched_at:
          type: string
          format: date-time
        mercury_version:
          type: string
          example: "v1.0"
        deterministic:
          type: boolean
          description: Whether this response is deterministic/cacheable
        cache_until:
          type: string
          format: date-time
          description: Suggested cache expiry (if deterministic)
        signature:
          type: string
          description: ECDSA signature of canonical data (hex)
        requested_date:
          type: string
          format: date
        observation_start:
          type: string
          format: date
        observation_end:
          type: string
          format: date

    PaymentRequired:
      type: object
      required: [error, price]
      properties:
        error:
          type: string
          enum: [PAYMENT_REQUIRED, INVALID_PAYMENT_TOKEN]
        message:
          type: string
        price:
          type: string
          example: "$0.15 USDC (Base)"
        paymentUri:
          type: string
          format: uri
        instructions:
          type: array
          items:
            type: string

    X402Accept:
      type: object
      required: [scheme, network, amount, payTo, maxTimeoutSeconds, asset]
      properties:
        scheme:
          type: string
          enum: [exact]
        network:
          type: string
          example: "eip155:8453"
        amount:
          type: string
          example: "150000"
          description: Amount in wei (USDC has 6 decimals)
        payTo:
          type: string
          example: "0xF8d59270cBC746a7593D25b6569812eF1681C6D2"
        maxTimeoutSeconds:
          type: integer
        asset:
          type: string
          example: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
        extra:
          type: object

  responses:
    PaymentRequired:
      description: Payment required via x402
      headers:
        Payment-Required:
          schema:
            type: string
          description: Base64url-encoded payment descriptor
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/PaymentRequired'

    SeriesNotFound:
      description: FRED series not found
      content:
        application/json:
          schema:
            type: object
            properties:
              error:
                type: object
                properties:
                  code:
                    type: string
                    example: SERIES_NOT_FOUND
                  message:
                    type: string
                  series_id:
                    type: string

    RateLimitExceeded:
      description: FRED API rate limit exceeded
      content:
        application/json:
          schema:
            type: object
            properties:
              error:
                type: object
                properties:
                  code:
                    type: string
                    example: RATE_LIMIT_EXCEEDED
                  message:
                    type: string
                  retry_after:
                    type: integer

    InternalError:
      description: Internal server error
      content:
        application/json:
          schema:
            type: object
            properties:
              error:
                type: object
                properties:
                  code:
                    type: string
                    example: INTERNAL_ERROR
                  message:
                    type: string

    ServiceUnavailable:
      description: Service configuration issue (e.g., missing API key)
      content:
        application/json:
          schema:
            type: object
            properties:
              error:
                type: object
                properties:
                  code:
                    type: string
                    example: SERVICE_UNAVAILABLE
                  message:
                    type: string
```

---

## 4. GOLDEN REGRESSION TEST PLAN

### 4.1 Test Framework
**Tool:** `jest` + `supertest` (Node.js standard)

**Install:**
```bash
cd ~/mercury-x402-service
npm install --save-dev jest supertest
```

**package.json:**
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "coveragePathIgnorePatterns": ["/node_modules/"],
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

### 4.2 Golden Fixture Structure
```
~/mercury-x402-service/
  tests/
    fixtures/
      fred/
        UNRATE-single-2026-01-01.json         # Single date query
        UNRATE-range-2020-2023.json           # Range query
        GDP-latest.json                        # Latest observation
        DGS10-missing-value.json               # Contains "." (missing)
      treasury/
        daily-snapshot-2026-03-01.json
        daily-snapshot-v0.9-2026-03-01.json   # Legacy format
      composite/
        economic-dashboard-2026-03-01.json
        inflation-tracker-2026-03-01.json
        labor-market-2026-03-01.json
    unit/
      fred.test.js
      treasury.test.js
      composite.test.js
      provenance.test.js
      payment.test.js
    integration/
      e2e-payment-flow.test.js
    golden/
      determinism.test.js                     # Replay fixtures → assert identical
```

### 4.3 Golden Test Runner
**File:** `tests/golden/determinism.test.js`

```javascript
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const app = require('../../src/server');

describe('Golden Regression Tests — Determinism', () => {
  // Mock FRED API responses to use fixtures
  beforeEach(() => {
    jest.mock('axios');
    const axios = require('axios');
    
    axios.get.mockImplementation((url, config) => {
      const seriesId = config.params.series_id;
      const fixtureFile = path.join(__dirname, '../fixtures/fred', `${seriesId}-latest.json`);
      
      if (fs.existsSync(fixtureFile)) {
        return Promise.resolve({
          data: JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
        });
      }
      
      return Promise.reject(new Error('Fixture not found'));
    });
  });

  afterEach(() => {
    jest.unmock('axios');
  });

  test('FRED UNRATE single date → deterministic response hash', async () => {
    const res = await request(app)
      .get('/v1/fred/UNRATE?date=2026-01-01')
      .set('Authorization', 'Bearer x402_test')
      .expect(200);

    // Strip non-deterministic fields
    const canonical = {
      series_id: res.body.data.series_id,
      observations: res.body.data.observations
    };

    const hash = crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // Update after first run
    
    expect(hash).toBe(expected);
  });

  test('Treasury snapshot → deterministic signature', async () => {
    const res = await request(app)
      .get('/v1/treasury/yield-curve/daily-snapshot?date=2026-03-01')
      .set('Authorization', 'Bearer x402_test')
      .expect(200);

    // Signature should be reproducible if data + signing key unchanged
    expect(res.body.provenance.signature).toBeDefined();
    expect(res.body.provenance.signature).toMatch(/^0x[a-fA-F0-9]+$/);
  });

  test('Composite dashboard → parallel fetch order does not affect result', async () => {
    const results = [];
    
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .get('/v1/composite/economic-dashboard')
        .set('Authorization', 'Bearer x402_test')
        .expect(200);
      
      results.push(JSON.stringify(res.body.data.indicators));
    }

    // All 5 calls should produce identical JSON (no race condition)
    const firstResult = results[0];
    results.forEach(result => {
      expect(result).toBe(firstResult);
    });
  });

  test('Missing value handling → FRED "." becomes null', async () => {
    const res = await request(app)
      .get('/v1/fred/DGS10?date=2020-01-01') // Assume fixture has "."
      .set('Authorization', 'Bearer x402_test')
      .expect(200);

    const obs = res.body.data.observations.find(o => o.value === null);
    expect(obs).toBeDefined();
  });
});
```

### 4.4 CI Integration
**File:** `~/mercury-x402-service/.github/workflows/test.yml`

```yaml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm test
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

### 4.5 Test Commands
```bash
# Run all tests
npm test

# Watch mode (during development)
npm run test:watch

# Coverage report
npm run test:coverage

# Run only golden tests
npm test -- tests/golden/

# Run specific test file
npm test -- tests/unit/fred.test.js
```

---

## 5. OBSERVABILITY SCHEMA

### 5.1 Structured Logging Fields
**Format:** JSON per line (NDJSON)

**Log Entry Schema:**
```json
{
  "timestamp": "2026-03-04T17:22:00.000Z",
  "level": "info",
  "service": "mercury-x402",
  "version": "1.0.0",
  "endpoint": "/v1/fred/UNRATE",
  "method": "GET",
  "status": 200,
  "response_time_ms": 234,
  "customer_id": "anon",
  "payment_token_prefix": "x402_abc",
  "price_usd": 0.15,
  "series_id": "UNRATE",
  "observation_count": 1,
  "upstream_duration_ms": 187,
  "cache_hit": false,
  "error_code": null,
  "error_message": null,
  "user_agent": "axios/1.6.0",
  "ip": "127.0.0.1",
  "signing_wallet": "0x...",
  "provenance_signature": "0x...",
  "fred_api_calls": 1,
  "composite_sub_calls": null
}
```

**Implementation:**
```javascript
// src/middleware/logger.js
const fs = require('fs');
const path = require('path');

const LOG_PATH = process.env.LOG_PATH || '/Users/openclaw/.openclaw/LOGS/mercury402-access.jsonl';

function log(entry) {
  const fullEntry = {
    timestamp: new Date().toISOString(),
    service: 'mercury-x402',
    version: '1.0.0',
    ...entry
  };
  
  const dir = path.dirname(LOG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.appendFileSync(LOG_PATH, JSON.stringify(fullEntry) + '\n');
}

function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    log({
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      endpoint: req.path,
      method: req.method,
      status: res.statusCode,
      response_time_ms: duration,
      customer_id: req.headers['x-customer-id'] || req.ip || 'anon',
      payment_token_prefix: req.headers.authorization?.split('_')[0] || null,
      user_agent: req.headers['user-agent'],
      ip: req.ip
    });
  });
  
  next();
}

module.exports = { log, requestLogger };
```

**Usage in server.js:**
```javascript
const { requestLogger } = require('./middleware/logger');
app.use(requestLogger);
```

### 5.2 Metrics Schema
**Storage:** JSON lines (JSONL) → queryable by jq / Mission Control

**File:** `/Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl`

**Entry Schema:**
```json
{
  "timestamp": "2026-03-04T17:22:00.000Z",
  "metric": "api_call",
  "endpoint": "/v1/fred/UNRATE",
  "status": 200,
  "duration_ms": 234,
  "price_usd": 0.15,
  "customer_id": "anon",
  "cache_hit": false
}
```

**Aggregation Queries (jq):**
```bash
# Total revenue last 24h
jq -s 'map(select(.metric == "api_call" and .status == 200)) | map(.price_usd) | add' \
  /Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl

# Calls per endpoint
jq -s 'group_by(.endpoint) | map({endpoint: .[0].endpoint, count: length})' \
  /Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl

# Average response time
jq -s 'map(.duration_ms) | add / length' \
  /Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl

# Unique customers
jq -s 'map(.customer_id) | unique | length' \
  /Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl
```

### 5.3 Mission Control Integration
**Endpoint:** `/metrics` (new)

```javascript
app.get('/metrics', async (req, res) => {
  const METRICS_FILE = '/Users/openclaw/.openclaw/METRICS/mercury402-metrics.jsonl';
  
  if (!fs.existsSync(METRICS_FILE)) {
    return res.json({
      total_revenue_usd: 0,
      total_calls: 0,
      unique_customers: 0,
      endpoints: []
    });
  }
  
  const lines = fs.readFileSync(METRICS_FILE, 'utf8').trim().split('\n');
  const entries = lines.map(line => JSON.parse(line));
  
  const totalRevenue = entries
    .filter(e => e.status === 200)
    .reduce((sum, e) => sum + (e.price_usd || 0), 0);
  
  const totalCalls = entries.filter(e => e.metric === 'api_call').length;
  
  const uniqueCustomers = new Set(entries.map(e => e.customer_id)).size;
  
  const endpointStats = {};
  entries.forEach(e => {
    if (!endpointStats[e.endpoint]) {
      endpointStats[e.endpoint] = { calls: 0, revenue: 0 };
    }
    endpointStats[e.endpoint].calls++;
    if (e.status === 200) {
      endpointStats[e.endpoint].revenue += (e.price_usd || 0);
    }
  });
  
  res.json({
    total_revenue_usd: totalRevenue.toFixed(2),
    total_calls: totalCalls,
    unique_customers: uniqueCustomers,
    endpoints: Object.entries(endpointStats).map(([path, stats]) => ({
      path,
      calls: stats.calls,
      revenue_usd: stats.revenue.toFixed(2)
    }))
  });
});
```

### 5.4 Error Tracking
**Fields for error logs:**
```json
{
  "timestamp": "2026-03-04T17:22:00.000Z",
  "level": "error",
  "error_code": "FRED_TIMEOUT",
  "error_message": "FRED API request timed out after 5000ms",
  "endpoint": "/v1/fred/UNRATE",
  "customer_id": "anon",
  "stack_trace": "Error: timeout...",
  "fred_api_status": 503,
  "retry_attempted": true
}
```

### 5.5 Health Check Fields
**Current `/health` response is basic. Enhance:**

```json
{
  "status": "healthy",
  "timestamp": "2026-03-04T17:22:00.000Z",
  "version": "1.0.0",
  "signing_address": "0x...",
  "fred_configured": true,
  "uptime_seconds": 3600,
  "last_fred_call_ms": 234,
  "cache_size_entries": 45,
  "revenue_last_24h_usd": "12.45",
  "calls_last_24h": 83,
  "errors_last_hour": 0
}
```

---

## 6. IMPLEMENTATION ROADMAP

### Phase 1: Determinism Hardening (Priority)
- [ ] Replace all `new Date()` with UTC-aware `utcNow()`
- [ ] Implement missing value handling (`"." → null`)
- [ ] Add `X-Mercury-Version: 1.0` header
- [ ] Normalize composite endpoint fetch ordering (sort before response)
- [ ] Document timezone/rounding rules in `/docs`

**Estimated effort:** 2–4 hours  
**Blockers:** None

### Phase 2: Caching Layer
- [ ] Install `node-cache` or integrate Redis client
- [ ] Cache FRED responses (24h TTL)
- [ ] Cache Treasury snapshot (24h TTL)
- [ ] Add `cache_until` field to provenance
- [ ] Add `X-Cache-Hit: true/false` response header

**Estimated effort:** 4–6 hours  
**Blockers:** Redis setup (optional, can start with in-memory)

### Phase 3: Golden Tests
- [ ] Install jest + supertest
- [ ] Create fixture files for top 10 FRED series
- [ ] Write determinism test suite (`tests/golden/determinism.test.js`)
- [ ] Add CI workflow (`.github/workflows/test.yml`)
- [ ] Target 80% coverage

**Estimated effort:** 6–8 hours  
**Blockers:** None

### Phase 4: Observability
- [ ] Implement structured logging middleware
- [ ] Add `/metrics` endpoint
- [ ] Create metrics aggregation script (`scripts/metrics-summary.sh`)
- [ ] Enhance `/health` with runtime stats
- [ ] Document log schema in `/docs/observability.md`

**Estimated effort:** 3–4 hours  
**Blockers:** None

### Phase 5: Treasury Implementation (Currently Mock)
- [ ] Implement real Treasury.gov scraper
- [ ] Add date validation and error handling
- [ ] Test against historical snapshots
- [ ] Cache Treasury data (24h TTL)
- [ ] Update fixtures + tests

**Estimated effort:** 8–12 hours  
**Blockers:** Treasury.gov scraping logic (rate limits, captcha risk)

### Phase 6: OpenAPI + Documentation
- [ ] Generate OpenAPI spec (`openapi.yaml`)
- [ ] Add Swagger UI at `/docs/api`
- [ ] Generate SDK clients (optional: Python, JS, Go)
- [ ] Update landing page with OpenAPI link

**Estimated effort:** 2–3 hours  
**Blockers:** None

---

## 7. SUCCESS CRITERIA

✅ **Determinism:**
- Same request → same response hash (excluding `fetched_at`)
- Golden tests pass 100%
- Documented timezone/rounding/null-handling rules

✅ **Testability:**
- 80%+ code coverage
- CI runs tests on every commit
- Fixtures for top 10 FRED series

✅ **Integration-Ready:**
- OpenAPI spec published at `/docs/api`
- `/metrics` endpoint live
- Mission Control can ingest metrics JSONL

✅ **Observability:**
- Structured logs (JSONL)
- Revenue/call/customer metrics queryable via jq
- Enhanced `/health` endpoint

---

## END OF ACCELERATION PACKAGE

**Next Actions:**
1. Review this document with Dustin
2. Prioritize phases (suggest: 1 → 3 → 4 → 2 → 6 → 5)
3. Execute Phase 1 immediately (determinism fixes are low-risk, high-impact)
4. Ship golden tests before adding new endpoints
