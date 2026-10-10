// Mercury402 endpoint catalog — the machine-readable index of every paid
// endpoint, built from the route modules themselves instead of a hand-copied
// list. Consumed by:
//   - src/server.js            -> GET / (JSON manifest), GET /meta.json, GET /llms.txt
//   - mcp-server/scripts/generate-catalog.cjs -> mcp-server/src/catalog.json
//   - test/catalog.test.js
//
// Sources of truth:
//   src/pricing.js       which endpoints exist and what they cost
//   src/new-routes.js    descriptions + methods for FRED/forex/spreads/breakeven/macro
//   src/ai-routes.js     descriptions + methods for /v1/ai/*
// The x402 descriptors served by /.well-known/x402 read the same PRICING map, so
// payment metadata stays owned by pricing.js and never drifts from this index.

const { PRICING } = require('./pricing');
const { buildEndpointMeta } = require('./new-routes');
const { registerAiRoutes } = require('./ai-routes');

// Descriptions for endpoints that predate the expansion route modules. Mirrors
// BASE_DESCRIPTIONS in the /.well-known/x402 handler in src/server.js.
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
    { name: 'limit', in: 'query', required: false, type: 'integer', description: 'Max observations to return, 1-1000 (limit > 1 costs 2x; ignored when date or a range is given)' },
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
  '/v1/fred/{series_id}': 'Price doubles (2x) for a multi-observation response: when both observation_start and observation_end are supplied, or when limit > 1.',
};

// Payment block published to agents alongside the endpoint list. The live
// per-call payTo address comes from MERCHANT_WALLET and is only published in the
// x402 descriptors (/.well-known/x402), never duplicated here.
const PAYMENT = {
  protocol: 'x402',
  scheme: 'exact',
  network: 'eip155:8453',
  asset: 'USDC',
  asset_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
};

const GENERATED_FROM = ['src/pricing.js', 'src/new-routes.js', 'src/ai-routes.js', 'src/server.js'];

const CATEGORY_BY_SEGMENT = {
  fred: 'fred',
  forex: 'forex',
  'yield-spread': 'yield-spread',
  breakeven: 'breakeven-inflation',
  macro: 'macro',
  composite: 'composite',
  treasury: 'treasury',
  ai: 'ai',
};

function categoryFor(path) {
  const seg = path.split('/')[2];
  return CATEGORY_BY_SEGMENT[seg] || seg;
}

function endpointMeta() {
  // Collect AI endpoint metadata without starting anything: register onto a
  // no-op app (src/ai-routes.js only needs these deps to declare its routes).
  const noopApp = { get() {}, post() {}, use() {} };
  const aiMeta = registerAiRoutes(noopApp, { require402Payment: () => () => {}, getPrice: () => 0 });
  return { ...buildEndpointMeta(), ...aiMeta };
}

/**
 * Full endpoint index: one entry per priced endpoint in src/pricing.js.
 * @returns {{generated_from: string[], payment: object, count: number, endpoints: object[]}}
 */
function buildCatalog() {
  const meta = endpointMeta();
  const endpoints = Object.entries(PRICING)
    .filter(([path]) => path !== 'default')
    .map(([path, price]) => {
      const routeMeta = meta[path] || {};
      const method = path === '/v1/treasury/yield-curve/historical' ? 'POST' : (routeMeta.method || 'GET');
      const description = BASE_DESCRIPTIONS[path] || routeMeta.desc;
      if (!description) throw new Error(`No description found for ${path}; update src/catalog.js`);
      const entry = {
        path,
        method,
        category: categoryFor(path),
        description,
        price_usd: price,
        price_usdc_atomic: String(Math.floor(price * 1000000)),
        params: PARAMS[path] || [],
      };
      if (routeMeta.seriesId) entry.fred_series_id = routeMeta.seriesId;
      if (PRICE_NOTES[path]) entry.price_note = PRICE_NOTES[path];
      return entry;
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path));

  return { generated_from: GENERATED_FROM, payment: PAYMENT, count: endpoints.length, endpoints };
}

let cached = null;

/** Memoized buildCatalog() — the route table cannot change at runtime. */
function getCatalog() {
  if (!cached) cached = buildCatalog();
  return cached;
}

module.exports = { buildCatalog, getCatalog, BASE_DESCRIPTIONS, PARAMS, PRICE_NOTES, PAYMENT, categoryFor };
