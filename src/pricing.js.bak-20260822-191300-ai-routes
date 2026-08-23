// Mercury x402 Endpoint Pricing Configuration — UPDATED
// Prices in USD (USDC on Base)
// Date: 2026-03-24
// Reason: Bankr minimum transfer is $0.05 — 6 endpoints were below this floor,
// making them unpurchasable via Bankr. All sub-$0.05 prices raised to $0.05.

const PRICING = {
  // FRED series (must be explicit for x402 manifest discovery)
  // WAS: $0.01 — raised to meet Bankr $0.05 minimum
  '/v1/fred/{series_id}': 0.05,

  // ── Named FRED Series (40+ endpoints) ──
  // Prices
  '/v1/fred/cpi':                       0.05,
  '/v1/fred/cpi-core':                  0.05,
  '/v1/fred/ppi':                       0.05,
  '/v1/fred/pce':                       0.05,
  '/v1/fred/pce-core':                  0.05,
  '/v1/fred/pce-deflator':              0.05,
  // Employment
  '/v1/fred/unemployment-rate':         0.05,
  '/v1/fred/nonfarm-payrolls':          0.05,
  '/v1/fred/initial-claims':            0.05,
  '/v1/fred/continuing-claims':         0.05,
  '/v1/fred/labor-force-participation': 0.05,
  '/v1/fred/average-hourly-earnings':   0.05,
  '/v1/fred/jolts-openings':            0.05,
  '/v1/fred/quits-rate':                0.05,
  '/v1/fred/u6-unemployment':           0.05,
  // Growth
  '/v1/fred/gdp':                       0.05,
  '/v1/fred/gdp-growth':                0.05,
  '/v1/fred/gdi':                       0.05,
  '/v1/fred/gdp-deflator':              0.05,
  '/v1/fred/corporate-profits':         0.05,
  // Money Supply & Rates
  '/v1/fred/m1-money-stock':            0.05,
  '/v1/fred/m2-money-stock':            0.05,
  '/v1/fred/fed-funds-rate':            0.05,
  '/v1/fred/fed-funds-target-upper':    0.05,
  '/v1/fred/treasury-3m':               0.05,
  '/v1/fred/treasury-2y':               0.05,
  '/v1/fred/treasury-5y':               0.05,
  '/v1/fred/treasury-10y':              0.05,
  '/v1/fred/treasury-30y':              0.05,
  '/v1/fred/mortgage-30y':              0.05,
  '/v1/fred/bbb-corporate-yield':       0.05,
  '/v1/fred/high-yield-spread':         0.05,
  '/v1/fred/a-rated-spread':            0.05,
  // Sentiment
  '/v1/fred/consumer-confidence':       0.05,
  '/v1/fred/conference-board-ci':       0.05,
  '/v1/fred/inflation-expectations':    0.05,
  '/v1/fred/leading-indicators':        0.05,
  // Trade
  '/v1/fred/trade-balance':             0.05,
  '/v1/fred/current-account':           0.05,
  // Housing
  '/v1/fred/housing-starts':            0.05,
  '/v1/fred/building-permits':          0.05,
  '/v1/fred/existing-home-sales':       0.05,
  '/v1/fred/case-shiller':              0.05,
  '/v1/fred/homeownership-rate':        0.05,
  // Other
  '/v1/fred/industrial-production':     0.05,
  '/v1/fred/retail-sales':              0.05,
  '/v1/fred/personal-income':           0.05,
  '/v1/fred/personal-saving-rate':      0.05,
  '/v1/fred/total-vehicle-sales':       0.05,
  '/v1/fred/federal-debt':              0.05,
  '/v1/fred/federal-deficit':           0.05,
  '/v1/fred/vix':                       0.05,

  // ── Forex Cross-Rates (FRED DEX series) ──
  '/v1/forex/eur-usd':  0.05,
  '/v1/forex/gbp-usd':  0.05,
  '/v1/forex/usd-jpy':  0.05,
  '/v1/forex/usd-cny':  0.05,

  // ── Yield Curve Spreads (computed) ──
  '/v1/yield-spread/10y-2y':    0.05,
  '/v1/yield-spread/10y-3m':    0.05,
  '/v1/yield-spread/5y-2y':     0.05,
  '/v1/yield-spread/30y-5y':    0.05,
  '/v1/yield-spread/10y-5y':    0.05,

  // ── Breakeven Inflation (TIPS) ──
  '/v1/breakeven/5y':   0.05,
  '/v1/breakeven/10y':  0.05,
  '/v1/breakeven/2y':   0.05,
  '/v1/breakeven/5y5y': 0.05,

  // ── Premium Composite Endpoints ──
  '/v1/macro/bundle':                0.10,
  '/v1/macro/recession-probability': 0.10,
  
  // Premium composite endpoints
  '/v1/macro/snapshot/all': 0.05,
  
  // Treasury endpoints
  // WAS: $0.03 — raised to meet Bankr $0.05 minimum
  '/v1/treasury/yield-curve/historical': 0.05,
  // WAS: $0.02 — raised to meet Bankr $0.05 minimum
  '/v1/treasury/auction-results/recent': 0.05,
  // WAS: $0.02 — raised to meet Bankr $0.05 minimum
  '/v1/treasury/tips-rates/current': 0.05,
  // WAS: $0.02 — raised to meet Bankr $0.05 minimum
  '/v1/treasury/yield-curve/daily-snapshot': 0.05,
  
  // Composite dashboards (unchanged — already above $0.05)
  '/v1/composite/economic-dashboard': 0.50,
  '/v1/composite/inflation-tracker': 0.40,
  '/v1/composite/labor-market': 0.40,
  
  // Default fallback price (applies to FRED series and any unspecified endpoints)
  // WAS: $0.01 — raised to meet Bankr $0.05 minimum
  default: 0.05
};

// Get price for an endpoint (supports path matching)
function getPrice(endpoint) {
  // Exact match first
  if (PRICING[endpoint] !== undefined) {
    return PRICING[endpoint];
  }
  
  // Check for FRED series pattern
  if (endpoint.startsWith('/v1/fred/')) {
    return PRICING['/v1/fred/{series_id}'] ?? PRICING.default;
  }
  
  // Default fallback
  return PRICING.default;
}

module.exports = {
  PRICING,
  getPrice
};
