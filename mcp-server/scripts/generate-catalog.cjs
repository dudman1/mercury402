#!/usr/bin/env node
// Generates mcp-server/src/catalog.json from the Mercury402 API source of truth:
//   - src/pricing.js        -> endpoint list + prices (exactly what /.well-known/x402 publishes)
//   - src/new-routes.js     -> descriptions/methods for FRED, forex, spreads, breakeven, macro
//   - src/ai-routes.js      -> descriptions/methods for /v1/ai/*
// Base endpoint descriptions mirror BASE_DESCRIPTIONS in src/server.js (that file
// boots the HTTP server on require, so it cannot be imported here).
//
// Run from mcp-server/: npm run generate:catalog

const path = require('path');
const fs = require('fs');

const REPO_SRC = path.join(__dirname, '..', '..', 'src');
const OUT = path.join(__dirname, '..', 'src', 'catalog.json');

const { PRICING } = require(path.join(REPO_SRC, 'pricing.js'));
const { buildEndpointMeta } = require(path.join(REPO_SRC, 'new-routes.js'));
const { registerAiRoutes } = require(path.join(REPO_SRC, 'ai-routes.js'));

// Collect AI endpoint metadata without starting anything: register onto a no-op app.
const noopApp = { get() {}, post() {}, use() {} };
const AI_META = registerAiRoutes(noopApp, { require402Payment: () => () => {}, getPrice: () => 0 });
const NEW_META = buildEndpointMeta();

// Mirrors BASE_DESCRIPTIONS in src/server.js (/.well-known/x402 handler).
const BASE_DESCRIPTIONS = {
  '/v1/fred/{series_id}': 'Federal Reserve Economic Data (FRED) series',
  '/v1/treasury/yield-curve/daily-snapshot': 'U.S. Treasury yield curve (FRED-sourced, 11 maturities)',
  '/v1/treasury/yield-curve/historical': 'Historical yield curve data (max 90-day range)',
  '/v1/treasury/auction-results/recent': 'Recent Treasury auction results',
  '/v1/treasury/tips-rates/current': 'Current TIPS rates (5, 7, 10, 20, 30-year)',
  '/v1/macro/snapshot/all': 'Complete macro snapshot: GDP, CPI, UNRATE, yields, VIX',
  '/v1/composite/economic-dashboard': 'Economic overview: GDP, CPI, and Unemployment in one call',
  '/v1/composite/inflation-tracker': 'Inflation metrics: CPI, PCE, and Core CPI',
  '/v1/composite/labor-market': 'Labor market health: Unemployment, Jobless Claims, Nonfarm Payrolls',
};

// Parameters accepted by each route (from the route handlers in src/).
const PARAMS = {
  '/v1/fred/{series_id}': [
    { name: 'series_id', in: 'path', required: true, type: 'string', description: 'FRED series id, e.g. UNRATE, CPIAUCSL, DGS10' },
    { name: 'date', in: 'query', required: false, type: 'string', description: 'Single observation date YYYY-MM-DD' },
    { name: 'observation_start', in: 'query', required: false, type: 'string', description: 'Range start YYYY-MM-DD (range queries cost 2x)' },
    { name: 'observation_end', in: 'query', required: false, type: 'string', description: 'Range end YYYY-MM-DD (range queries cost 2x)' },
    { name: 'limit', in: 'query', required: false, type: 'integer', description: 'Max observations to return' },
  ],
  '/v1/treasury/yield-curve/daily-snapshot': [
    { name: 'date', in: 'query', required: false, type: 'string', description: 'Snapshot date YYYY-MM-DD (default: latest)' },
  ],
  '/v1/treasury/yield-curve/historical': [
    { name: 'start_date', in: 'body', required: true, type: 'string', description: 'Start date YYYY-MM-DD' },
    { name: 'end_date', in: 'body', required: true, type: 'string', description: 'End date YYYY-MM-DD (max 90 days after start)' },
  ],
  '/v1/ai/ask': [
    { name: 'question', in: 'body', required: true, type: 'string', description: 'Natural-language question (8-500 chars)' },
    { name: 'series', in: 'body', required: false, type: 'string[]', description: 'Optional Mercury402 FRED paths, e.g. ["/v1/fred/cpi"] (max 6)' },
  ],
};

const PRICE_NOTES = {
  '/v1/fred/{series_id}': 'Price doubles (2x) when both observation_start and observation_end are supplied.',
};

function categoryFor(p) {
  const seg = p.split('/')[2];
  const map = {
    fred: 'fred',
    forex: 'forex',
    'yield-spread': 'yield-spread',
    breakeven: 'breakeven-inflation',
    macro: 'macro',
    composite: 'composite',
    treasury: 'treasury',
    ai: 'ai',
  };
  return map[seg] || seg;
}

const endpoints = Object.entries(PRICING)
  .filter(([p]) => p !== 'default')
  .map(([p, price]) => {
    const meta = NEW_META[p] || AI_META[p] || {};
    const method = p === '/v1/treasury/yield-curve/historical' ? 'POST' : (meta.method || 'GET');
    const description = BASE_DESCRIPTIONS[p] || meta.desc;
    if (!description) throw new Error(`No description found for ${p}; update generate-catalog.cjs`);
    const entry = {
      path: p,
      method,
      category: categoryFor(p),
      description,
      price_usd: price,
      price_usdc_atomic: String(Math.floor(price * 1000000)),
      params: PARAMS[p] || [],
    };
    if (meta.seriesId) entry.fred_series_id = meta.seriesId;
    if (PRICE_NOTES[p]) entry.price_note = PRICE_NOTES[p];
    return entry;
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path));

const catalog = {
  generated_from: ['src/pricing.js', 'src/new-routes.js', 'src/ai-routes.js', 'src/server.js'],
  payment: {
    protocol: 'x402',
    scheme: 'exact',
    network: 'eip155:8453',
    asset: 'USDC',
    asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  count: endpoints.length,
  endpoints,
};

fs.writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Wrote ${endpoints.length} endpoints to ${path.relative(process.cwd(), OUT)}`);
