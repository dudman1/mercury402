// Mercury x402 Endpoint Pricing Configuration
// Prices in USD (USDC on Base)

const PRICING = {
  // FRED series (must be explicit for x402 manifest discovery)
  '/v1/fred/{series_id}': 0.01,
  
  // Premium composite endpoints
  '/v1/macro/snapshot/all': 0.05,
  
  // Treasury endpoints
  '/v1/treasury/yield-curve/historical': 0.03,
  '/v1/treasury/auction-results/recent': 0.02,
  '/v1/treasury/tips-rates/current': 0.02,
  '/v1/treasury/yield-curve/daily-snapshot': 0.02,
  
  // Composite dashboards (existing)
  '/v1/composite/economic-dashboard': 0.50,
  '/v1/composite/inflation-tracker': 0.40,
  '/v1/composite/labor-market': 0.40,
  
  // Default fallback price (applies to FRED series and any unspecified endpoints)
  default: 0.01
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
