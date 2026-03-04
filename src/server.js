const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getPrice } = require('./pricing');

const app = express();
const PORT = process.env.PORT || 4020;

// Simple concurrency limiter for FRED API (max 10 concurrent requests)
class ConcurrencyLimiter {
  constructor(limit) {
    this.limit = limit;
    this.running = 0;
    this.queue = [];
  }

  async run(fn) {
    while (this.running >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const fredLimit = new ConcurrencyLimiter(10);

// TTL Cache
const cache = new Map();
const cacheStats = {
  hits: 0,
  misses: 0,
  staleHits: 0
};

const CACHE_TTL = {
  FRED: 6 * 60 * 60 * 1000,      // 6 hours
  TREASURY: 6 * 60 * 60 * 1000   // 6 hours
};

function getCacheKey(endpoint, params = {}) {
  return `${endpoint}:${JSON.stringify(params)}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  
  const now = Date.now();
  if (now < entry.expiresAt) {
    // Fresh cache hit
    cacheStats.hits++;
    return { data: entry.data, age: Math.floor((now - entry.cachedAt) / 1000), stale: false };
  }
  
  // Expired but keep for fallback
  return { data: entry.data, age: Math.floor((now - entry.cachedAt) / 1000), stale: true };
}

function setCache(key, data, ttl) {
  const now = Date.now();
  cache.set(key, {
    data: data,
    cachedAt: now,
    expiresAt: now + ttl
  });
}

function getCacheMetrics() {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? ((cacheStats.hits / total) * 100).toFixed(1) : 0;
  
  // Find oldest entry
  let oldestAge = 0;
  const now = Date.now();
  for (const entry of cache.values()) {
    const age = Math.floor((now - entry.cachedAt) / 1000);
    if (age > oldestAge) oldestAge = age;
  }
  
  return {
    cache_size: cache.size,
    cache_hit_rate_pct: parseFloat(hitRate),
    oldest_entry_age_seconds: oldestAge
  };
}

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Configuration
const FRED_API_KEY = process.env.FRED_API_KEY;
const SERVER_PRIVATE_KEY = process.env.SERVER_PRIVATE_KEY;
const MERCHANT_WALLET = process.env.MERCHANT_WALLET;

if (!MERCHANT_WALLET) {
  console.error('❌ MERCHANT_WALLET not set in environment — refusing to start (no valid payTo)');
  process.exit(1);
}

if (!FRED_API_KEY) {
  console.warn('⚠️  FRED_API_KEY not set - FRED endpoint will fail');
}

if (!SERVER_PRIVATE_KEY) {
  console.warn('⚠️  SERVER_PRIVATE_KEY not set - provenance signatures will be unavailable');
}

// Signing wallet for provenance
let signingWallet;
if (SERVER_PRIVATE_KEY) {
  try {
    signingWallet = new ethers.Wallet(SERVER_PRIVATE_KEY);
    console.log(`✅ Signing wallet initialized: ${signingWallet.address}`);
  } catch (e) {
    console.error('❌ Failed to initialize signing wallet:', e.message);
  }
}

// ============================================
// REVENUE LOGGING
// ============================================

const REVENUE_LEDGER = '/Users/openclaw/.openclaw/LEDGER/mercury402-revenue.jsonl';
const ACCESS_LOG = '/Users/openclaw/.openclaw/LOGS/mercury402-access.jsonl';

// Parse x402 token for payment metadata (wallet, tx_hash)
// Current implementation: token is opaque string, real fields will come from bridge
function parsePaymentToken(token) {
  // TODO: Once x402 payment bridge is integrated, decode token to extract:
  // - wallet_address (payer's wallet)
  // - tx_hash (on-chain transaction hash)
  // For now, return null (fields not yet available)
  return {
    wallet_address: null,
    tx_hash: null,
    token_id: token // Store token for audit trail
  };
}

function logPayment(endpoint, amount, customerId = 'anon', verified = false, reason = null) {
  const entry = {
    timestamp: Date.now(),
    date: new Date().toISOString(),
    endpoint,
    amount,
    customer: customerId,
    success: true,
    verified: verified,
    rejection_reason: reason
  };
  
  try {
    const dir = path.dirname(REVENUE_LEDGER);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(REVENUE_LEDGER, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to log payment:', e.message);
  }
}

// Structured access logging with payment metadata
function logAccess(req, res, startTime, paymentMeta = null) {
  const duration = Date.now() - startTime;
  const entry = {
    timestamp: Date.now(),
    endpoint: req.path,
    wallet_address: paymentMeta?.wallet_address || null,
    tx_hash: paymentMeta?.tx_hash || null,
    verified: paymentMeta?.verified || false,
    status: res.statusCode,
    duration_ms: duration,
    price_usd: paymentMeta?.price_usd || 0,
    cache_hit: res.locals.cacheHit || false
  };
  
  try {
    const dir = path.dirname(ACCESS_LOG);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(ACCESS_LOG, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('Failed to log access:', e.message);
  }
}

// Fire-and-forget Convex webhook for verified payments
function emitToConvex(endpoint, revenue_usd, wallet_address) {
  if (revenue_usd <= 0) return; // Only emit successful paid calls
  
  const payload = {
    endpoint,
    revenue_usd,
    wallet_address: wallet_address || 'unknown',
    timestamp: Date.now()
  };
  
  axios.post('https://rapid-hummingbird-980.convex.cloud/api/mutation', {
    path: 'api/metrics:recordMercuryCall',
    args: payload
  }, {
    timeout: 5000,
    headers: { 'Content-Type': 'application/json' }
  }).catch(err => {
    // Fire-and-forget: log failure but don't block
    console.error('Convex emit failed:', err.message);
  });
}

// ============================================
// x402 PAYMENT VALIDATION
// ============================================

// Helper: Encode x402 payment info as base64url for Payment-Required header
function encodePaymentRequired(price) {
  const acceptInfo = {
    scheme: 'exact',
    network: 'eip155:8453', // Base mainnet
    amount: String(Math.floor(price * 1000000)), // Convert to wei (6 decimals for USDC)
    payTo: MERCHANT_WALLET, // Mercury's payment recipient wallet
    maxTimeoutSeconds: 30,
    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
  };
  
  const json = JSON.stringify(acceptInfo);
  const base64 = Buffer.from(json).toString('base64');
  // Convert standard base64 to base64url
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return base64url;
}

function require402Payment(endpointPath, price) {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Check for x402 payment token in Authorization header
    const authHeader = req.headers.authorization || '';
    
    // Parse token from "Bearer x402_..." format
    const bearerMatch = authHeader.match(/^Bearer\s+(x402_\S+)$/);
    const token = bearerMatch ? bearerMatch[1] : null;
    
    // Intercept response to log access with final status
    const originalJson = res.json.bind(res);
    res.json = function(body) {
      const paymentMeta = res.locals.paymentMeta || { verified: false, price_usd: 0 };
      logAccess(req, res, startTime, paymentMeta);
      return originalJson(body);
    };
    
    if (!token) {
      // No authorization header with x402 token
      const paymentRequired = encodePaymentRequired(price);
      res.locals.paymentMeta = { verified: false, price_usd: 0 };
      return res
        .status(402)
        .set('Payment-Required', paymentRequired)
        .json({
          error: 'PAYMENT_REQUIRED',
          message: 'Payment required to access this endpoint',
          price: `$${price.toFixed(2)} USDC (Base)`,
          paymentUri: `https://x402.io/pay?endpoint=${endpointPath}&amount=${(price * 1).toFixed(2)}&token=USDC&chain=base&recipient=${MERCHANT_WALLET}`,
          instructions: [
            '1. Click the paymentUri link above or visit https://x402.io',
            '2. Select this endpoint and enter your Authorization header value',
            '3. Make payment (USDC on Base blockchain)',
            '4. Retry request with Authorization header: Bearer x402_<token>'
          ]
        });
    }
    
    // Parse payment token for metadata
    const tokenMeta = parsePaymentToken(token);
    
    // Validate token: accept test tokens ONLY in development
    const isTestToken = token === 'x402_test' || token.startsWith('x402_test');
    const allowTestTokens = process.env.ALLOW_TEST_TOKEN === 'true';
    
    if (isTestToken && allowTestTokens) {
      // Test token in dev mode - log as unverified
      const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
      logPayment(endpointPath, price, customerId, false, 'test_token_dev_mode');
      
      res.locals.paymentMeta = {
        wallet_address: tokenMeta.wallet_address,
        tx_hash: tokenMeta.tx_hash,
        verified: false,
        price_usd: price
      };
      
      return next();
    }
    
    if (isTestToken && !allowTestTokens) {
      // Test token in production - reject
      const paymentRequired = encodePaymentRequired(price);
      res.locals.paymentMeta = { verified: false, price_usd: 0 };
      return res
        .status(402)
        .set('Payment-Required', paymentRequired)
        .json({
          error: 'INVALID_PAYMENT_TOKEN',
          message: 'Test tokens not allowed in production',
          price: `$${price.toFixed(2)} USDC (Base)`,
          paymentUri: `https://x402.io/pay?endpoint=${endpointPath}&amount=${(price * 1).toFixed(2)}&token=USDC&chain=base&recipient=${MERCHANT_WALLET}`
        });
    }
    
    // PRODUCTION: Reject unverifiable tokens until x402 payment ledger integration complete
    // Real tokens must be validated against on-chain payment bridge
    const paymentRequired = encodePaymentRequired(price);
    const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
    
    // Log rejected payment attempt
    logPayment(endpointPath, 0, customerId, false, 'unverified_token_no_bridge');
    
    res.locals.paymentMeta = { verified: false, price_usd: 0 };
    
    return res
      .status(402)
      .set('Payment-Required', paymentRequired)
      .json({
        error: 'PAYMENT_VERIFICATION_UNAVAILABLE',
        message: 'Payment verification system not yet operational. Token validation requires x402 bridge integration.',
        price: `$${price.toFixed(2)} USDC (Base)`,
        paymentUri: `https://x402.io/pay?endpoint=${endpointPath}&amount=${(price * 1).toFixed(2)}&token=USDC&chain=base&recipient=${MERCHANT_WALLET}`,
        status: 'Service accepts test tokens in development only (ALLOW_TEST_TOKEN=true). Production payment bridge coming soon.'
      });
  };
}

// ============================================
// FRED ENDPOINT
// ============================================

async function fetchFredData(seriesId, params) {
  // Generate cache key
  const cacheKey = getCacheKey(`fred:${seriesId}`, params);
  
  // Check cache
  const cached = getCached(cacheKey);
  if (cached && !cached.stale) {
    // Fresh cache hit
    return { ...cached.data, _cacheAge: cached.age, _cacheHit: true };
  }
  
  // Cache miss - fetch from FRED
  cacheStats.misses++;
  
  const fredUrl = 'https://api.stlouisfed.org/fred/series/observations';
  const query = {
    api_key: FRED_API_KEY,
    series_id: seriesId,
    file_type: 'json',
    ...params
  };

  try {
    // Apply concurrency limit
    const response = await fredLimit.run(() => axios.get(fredUrl, { params: query }));
    
    // Cache successful response
    setCache(cacheKey, response.data, CACHE_TTL.FRED);
    
    return { ...response.data, _cacheAge: 0, _cacheHit: false };
  } catch (error) {
    // Graceful degradation: serve stale cache on error
    if ((error.response?.status === 429 || error.response?.status === 503) && cached) {
      console.warn(`FRED error ${error.response.status}, serving stale cache for ${seriesId}`);
      cacheStats.staleHits++;
      return { ...cached.data, _cacheAge: cached.age, _cacheHit: true, _stale: true };
    }
    throw error;
  }
}

function generateProvenance(data, seriesId, params) {
  const provenance = {
    source: 'Federal Reserve Economic Data (FRED)',
    source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
    fetched_at: new Date().toISOString(),
    mercury_version: 'v1.0',
    deterministic: true
  };

  if (params.date) {
    provenance.requested_date = params.date;
  }
  if (params.observation_start && params.observation_end) {
    provenance.observation_start = params.observation_start;
    provenance.observation_end = params.observation_end;
  }

  // Generate signature if signing wallet is available
  if (signingWallet) {
    try {
      const canonical = JSON.stringify({
        series_id: seriesId,
        observations: data.observations,
        fetched_at: provenance.fetched_at
      });
      const messageHash = ethers.id(canonical);
      const signature = signingWallet.signMessageSync(ethers.getBytes(messageHash));
      provenance.signature = signature;
    } catch (e) {
      console.error('Signature generation failed:', e.message);
    }
  }

  return provenance;
}

app.get('/v1/fred/:series_id', require402Payment('/v1/fred/{series_id}', getPrice('/v1/fred/{series_id}')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'FRED API key not configured'
        }
      });
    }

    const { series_id } = req.params;
    const { date, observation_start, observation_end, limit } = req.query;

    // Determine pricing based on query type
    const basePrice = getPrice('/v1/fred/{series_id}');
    const isRange = observation_start && observation_end;
    const price = isRange ? basePrice * 2 : basePrice;

    // Build FRED API params
    const fredParams = {};
    if (date) {
      fredParams.observation_start = date;
      fredParams.observation_end = date;
    } else if (observation_start && observation_end) {
      fredParams.observation_start = observation_start;
      fredParams.observation_end = observation_end;
    } else {
      // Latest observation
      fredParams.sort_order = 'desc';
      fredParams.limit = limit || 1;
    }

    // Fetch from FRED (with caching)
    const fredData = await fetchFredData(series_id, fredParams);

    if (!fredData.observations || fredData.observations.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NO_DATA_FOUND',
          message: `No observations found for series ${series_id}`,
          series_id
        }
      });
    }

    // Format response
    const responseData = {
      series_id: series_id,
      title: fredData.title || series_id,
      units: fredData.units || 'N/A',
      frequency: fredData.frequency || 'N/A',
      seasonal_adjustment: fredData.seasonal_adjustment || 'N/A',
      last_updated: fredData.last_updated || new Date().toISOString(),
      observation_count: fredData.observations.length,
      observations: fredData.observations.map(obs => ({
        date: obs.date,
        value: obs.value
      }))
    };

    const provenance = generateProvenance(responseData, series_id, { date, observation_start, observation_end });

    // Payment validation happens in middleware - only reached if payment valid
    res.setHeader('X-Mercury-Price', `$${price.toFixed(2)}`);
    
    // Add cache headers and mark for access log
    if (fredData._cacheHit) {
      res.setHeader('X-Data-Age', fredData._cacheAge.toString());
      if (fredData._stale) {
        res.setHeader('X-Cache-Status', 'stale');
      }
      res.locals.cacheHit = true;
    }
    
    res.json({
      data: responseData,
      provenance
    });

  } catch (error) {
    console.error('FRED endpoint error:', error.message);
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        error: {
          code: 'SERIES_NOT_FOUND',
          message: `Series '${req.params.series_id}' not found in FRED database`,
          series_id: req.params.series_id
        }
      });
    }

    if (error.response?.status === 429) {
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'FRED API rate limit exceeded, try again in 60 seconds',
          retry_after: 60
        }
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});

// ============================================
// TREASURY ENDPOINT (Hardened)
// ============================================

// ============================================
// TREASURY ENDPOINT (FRED-based implementation)
// ============================================

async function fetchTreasuryYieldCurve(date) {
  if (!FRED_API_KEY) {
    throw new Error('FRED_API_KEY not configured');
  }

  // Treasury rate series from FRED
  const seriesMap = {
    '1_MONTH': 'DGS1MO',
    '3_MONTH': 'DGS3MO',
    '6_MONTH': 'DGS6MO',
    '1_YEAR': 'DGS1',
    '2_YEAR': 'DGS2',
    '3_YEAR': 'DGS3',
    '5_YEAR': 'DGS5',
    '7_YEAR': 'DGS7',
    '10_YEAR': 'DGS10',
    '20_YEAR': 'DGS20',
    '30_YEAR': 'DGS30'
  };

  // Build params for FRED API
  const fredParams = {
    sort_order: 'desc',
    limit: 1
  };

  if (date) {
    fredParams.observation_start = date;
    fredParams.observation_end = date;
  }

  // Fetch all series in parallel
  const seriesIds = Object.values(seriesMap);
  const results = await Promise.all(
    seriesIds.map(id => fetchFredData(id, fredParams).catch(err => {
      console.error(`Failed to fetch ${id}:`, err.message);
      return { observations: [] };
    }))
  );

  // Map results back to yield curve format
  const rates = {};
  const recordDates = [];
  
  Object.entries(seriesMap).forEach(([label, seriesId], index) => {
    const result = results[index];
    if (result.observations && result.observations.length > 0) {
      const obs = result.observations[0];
      // FRED returns "." for missing values
      if (obs.value && obs.value !== '.') {
        rates[label] = parseFloat(obs.value);
        recordDates.push(obs.date);
      }
    }
  });

  // Sanity checks
  if (Object.keys(rates).length === 0) {
    throw new Error('No valid Treasury rate data available for requested date');
  }

  // Use most common date as record_date (should all be same for daily snapshot)
  const dateCounts = {};
  recordDates.forEach(d => dateCounts[d] = (dateCounts[d] || 0) + 1);
  const record_date = Object.keys(dateCounts).sort((a, b) => dateCounts[b] - dateCounts[a])[0];

  // Validate: all rates are numeric
  const invalidRates = Object.entries(rates).filter(([_, v]) => isNaN(v));
  if (invalidRates.length > 0) {
    throw new Error(`Invalid rate values: ${invalidRates.map(([k]) => k).join(', ')}`);
  }

  return {
    record_date: record_date || (date || new Date().toISOString().split('T')[0]),
    rates,
    source: 'FRED (Federal Reserve Economic Data)',
    series_fetched: Object.keys(rates).length,
    total_series: Object.keys(seriesMap).length
  };
}

function buildTreasuryProvenance(data, fetchedAt) {
  const provenance = {
    source: 'Federal Reserve Economic Data (FRED) - U.S. Treasury rates',
    source_url: 'https://fred.stlouisfed.org',
    fetched_at: fetchedAt,
    mercury_version: 'v1.0',
    deterministic: true,
    cache_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    series_coverage: `${data.series_fetched}/${data.total_series} maturities`,
    record_date: data.record_date
  };

  // Generate signature
  if (signingWallet) {
    try {
      const canonical = JSON.stringify({
        record_date: data.record_date,
        rates: data.rates,
        source: data.source
      });
      const messageHash = ethers.id(canonical);
      const signature = signingWallet.signMessageSync(ethers.getBytes(messageHash));
      provenance.signature = signature;
    } catch (e) {
      console.error('Treasury signature generation failed:', e.message);
    }
  }

  return provenance;
}

app.get('/v1/treasury/yield-curve/daily-snapshot', require402Payment('/v1/treasury/yield-curve/daily-snapshot', getPrice('/v1/treasury/yield-curve/daily-snapshot')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'FRED API key not configured'
        }
      });
    }

    const { v, date } = req.query;

    // Fetch real treasury data from FRED
    const treasuryData = await fetchTreasuryYieldCurve(date);
    const fetchedAt = new Date().toISOString();

    // Sanity check: verify data quality
    if (treasuryData.series_fetched < 5) {
      console.warn(`Low series coverage: ${treasuryData.series_fetched}/11 series available`);
    }

    // Legacy format (v0.9) - just rates
    if (v === '0.9') {
      return res.json({
        record_date: treasuryData.record_date,
        rates: treasuryData.rates
      });
    }

    // New format with provenance (v1.0 default)
    const provenance = buildTreasuryProvenance(treasuryData, fetchedAt);

    res.setHeader('X-Mercury-Price', '$0.10');
    res.json({
      data: {
        record_date: treasuryData.record_date,
        rates: treasuryData.rates
      },
      provenance
    });

  } catch (error) {
    console.error('Treasury endpoint error:', error.message);
    
    if (error.message.includes('No valid Treasury rate data')) {
      return res.status(404).json({
        error: {
          code: 'NO_DATA_AVAILABLE',
          message: error.message,
          alternatives: ['/v1/fred/DGS10', '/v1/fred/DGS2', '/v1/fred/DGS30']
        }
      });
    }

    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});

// ============================================
// PREMIUM COMPOSITE ENDPOINTS
// ============================================

// Economic Dashboard - GDP + CPI + Unemployment - $0.50
app.get('/v1/composite/economic-dashboard', require402Payment('/v1/composite/economic-dashboard', getPrice('/v1/composite/economic-dashboard')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' } });
    }

    const series = ['GDP', 'CPIAUCSL', 'UNRATE'];
    const results = await Promise.all(series.map(id => fetchFredData(id, { sort_order: 'desc', limit: 1 })));

    const responseData = {
      dashboard: 'economic-overview',
      timestamp: new Date().toISOString(),
      indicators: [
        { series_id: 'GDP', title: 'Gross Domestic Product', value: results[0].observations[0]?.value, date: results[0].observations[0]?.date, units: results[0].units },
        { series_id: 'CPIAUCSL', title: 'Consumer Price Index', value: results[1].observations[0]?.value, date: results[1].observations[0]?.date, units: results[1].units },
        { series_id: 'UNRATE', title: 'Unemployment Rate', value: results[2].observations[0]?.value, date: results[2].observations[0]?.date, units: results[2].units }
      ]
    };

    const provenance = generateProvenance(responseData, 'composite/economic-dashboard', {});

    const endpointPrice = getPrice('/v1/composite/economic-dashboard');
    const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
    logPayment('/v1/composite/economic-dashboard', endpointPrice, customerId);
    
    // Emit to Convex (fire-and-forget)
    const paymentMeta = res.locals.paymentMeta || {};
    if (paymentMeta.price_usd > 0) {
      emitToConvex('/v1/composite/economic-dashboard', endpointPrice, paymentMeta.wallet_address);
    }
    
    res.setHeader('X-Mercury-Price', `$${endpointPrice.toFixed(2)}`);
    res.json({ data: responseData, provenance });

  } catch (error) {
    console.error('Economic dashboard error:', error.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// Inflation Tracker - CPI + PCE + Core CPI - $0.40
app.get('/v1/composite/inflation-tracker', require402Payment('/v1/composite/inflation-tracker', getPrice('/v1/composite/inflation-tracker')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' } });
    }

    const series = ['CPIAUCSL', 'PCEPI', 'CPILFESL'];
    const results = await Promise.all(series.map(id => fetchFredData(id, { sort_order: 'desc', limit: 1 })));

    const responseData = {
      dashboard: 'inflation-tracker',
      timestamp: new Date().toISOString(),
      indicators: [
        { series_id: 'CPIAUCSL', title: 'Consumer Price Index (All Items)', value: results[0].observations[0]?.value, date: results[0].observations[0]?.date, units: results[0].units },
        { series_id: 'PCEPI', title: 'Personal Consumption Expenditures Price Index', value: results[1].observations[0]?.value, date: results[1].observations[0]?.date, units: results[1].units },
        { series_id: 'CPILFESL', title: 'Core CPI (Less Food & Energy)', value: results[2].observations[0]?.value, date: results[2].observations[0]?.date, units: results[2].units }
      ]
    };

    const provenance = generateProvenance(responseData, 'composite/inflation-tracker', {});

    const endpointPrice = getPrice('/v1/composite/inflation-tracker');
    const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
    logPayment('/v1/composite/inflation-tracker', endpointPrice, customerId);
    
    // Emit to Convex (fire-and-forget)
    const paymentMeta = res.locals.paymentMeta || {};
    if (paymentMeta.price_usd > 0) {
      emitToConvex('/v1/composite/inflation-tracker', endpointPrice, paymentMeta.wallet_address);
    }
    
    res.setHeader('X-Mercury-Price', `$${endpointPrice.toFixed(2)}`);
    res.json({ data: responseData, provenance });

  } catch (error) {
    console.error('Inflation tracker error:', error.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// Labor Market Health - Unemployment + Initial Claims + Nonfarm Payrolls - $0.40
app.get('/v1/composite/labor-market', require402Payment('/v1/composite/labor-market', getPrice('/v1/composite/labor-market')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' } });
    }

    const series = ['UNRATE', 'ICSA', 'PAYEMS'];
    const results = await Promise.all(series.map(id => fetchFredData(id, { sort_order: 'desc', limit: 1 })));

    const responseData = {
      dashboard: 'labor-market',
      timestamp: new Date().toISOString(),
      indicators: [
        { series_id: 'UNRATE', title: 'Unemployment Rate', value: results[0].observations[0]?.value, date: results[0].observations[0]?.date, units: results[0].units },
        { series_id: 'ICSA', title: 'Initial Jobless Claims', value: results[1].observations[0]?.value, date: results[1].observations[0]?.date, units: results[1].units },
        { series_id: 'PAYEMS', title: 'Total Nonfarm Payrolls', value: results[2].observations[0]?.value, date: results[2].observations[0]?.date, units: results[2].units }
      ]
    };

    const provenance = generateProvenance(responseData, 'composite/labor-market', {});

    const endpointPrice = getPrice('/v1/composite/labor-market');
    const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
    logPayment('/v1/composite/labor-market', endpointPrice, customerId);
    
    // Emit to Convex (fire-and-forget)
    const paymentMeta = res.locals.paymentMeta || {};
    if (paymentMeta.price_usd > 0) {
      emitToConvex('/v1/composite/labor-market', endpointPrice, paymentMeta.wallet_address);
    }
    
    res.setHeader('X-Mercury-Price', `$${endpointPrice.toFixed(2)}`);
    res.json({ data: responseData, provenance });

  } catch (error) {
    console.error('Labor market error:', error.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// ============================================
// STUB ROUTES (UNDER CONSTRUCTION)
// ============================================

// Macro snapshot (all indicators in one call)
app.get('/v1/macro/snapshot/all', (req, res) => {
  res.status(503).json({
    error: 'coming_soon',
    message: 'This endpoint is under construction. Subscribe to updates at https://mercury402.uk',
    available: false
  });
});

// Treasury yield curve historical data
app.get('/v1/treasury/yield-curve/historical', (req, res) => {
  res.status(503).json({
    error: 'coming_soon',
    message: 'This endpoint is under construction. Subscribe to updates at https://mercury402.uk',
    available: false
  });
});

// Treasury auction results (recent)
app.get('/v1/treasury/auction-results/recent', (req, res) => {
  res.status(503).json({
    error: 'coming_soon',
    message: 'This endpoint is under construction. Subscribe to updates at https://mercury402.uk',
    available: false
  });
});

// Treasury TIPS rates (current)
app.get('/v1/treasury/tips-rates/current', (req, res) => {
  res.status(503).json({
    error: 'coming_soon',
    message: 'This endpoint is under construction. Subscribe to updates at https://mercury402.uk',
    available: false
  });
});

// ============================================
// DISCOVERY & HEALTH
// ============================================

app.get('/.well-known/x402', (req, res) => {
  const { PRICING } = require('./pricing');
  
  // Build accepts array dynamically from pricing config
  const endpointsByPrice = {};
  
  // Group endpoints by price
  Object.entries(PRICING).forEach(([endpoint, price]) => {
    if (endpoint === 'default') return;
    
    if (!endpointsByPrice[price]) {
      endpointsByPrice[price] = [];
    }
    
    let description = endpoint;
    if (endpoint === '/v1/fred/{series_id}') {
      description = 'Federal Reserve Economic Data (FRED) series';
    } else if (endpoint === '/v1/treasury/yield-curve/daily-snapshot') {
      description = 'U.S. Treasury yield curve (FRED-sourced, 11 maturities)';
    } else if (endpoint === '/v1/composite/economic-dashboard') {
      description = 'Economic overview: GDP, CPI, and Unemployment in one call';
    } else if (endpoint === '/v1/composite/inflation-tracker') {
      description = 'Inflation metrics: CPI, PCE, and Core CPI';
    } else if (endpoint === '/v1/composite/labor-market') {
      description = 'Labor market health: Unemployment, Jobless Claims, Nonfarm Payrolls';
    }
    
    endpointsByPrice[price].push({
      path: endpoint,
      price: price,
      description: description
    });
  });
  
  // Build accepts array
  const accepts = Object.entries(endpointsByPrice)
    .sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]))
    .map(([price, endpoints]) => ({
      scheme: 'exact',
      network: 'eip155:8453', // Base mainnet
      amount: String(Math.floor(parseFloat(price) * 1000000)), // Convert to USDC wei (6 decimals)
      payTo: MERCHANT_WALLET,
      maxTimeoutSeconds: 30,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
      extra: {
        endpoints: endpoints
      }
    }));
  
  res.json({
    x402Version: 2,
    accepts: accepts,
    extensions: {
      bazaar: {
        info: {
          input: {
            example: 'No input parameters required; query string optional',
            properties: {
              limit: {
                type: 'integer',
                description: 'Number of observations to return (FRED only)'
              },
              observation_start: {
                type: 'string',
                description: 'Start date for observation range YYYY-MM-DD (FRED only)'
              },
              observation_end: {
                type: 'string',
                description: 'End date for observation range YYYY-MM-DD (FRED only)'
              }
            }
          },
          output: {
            example: {
              data: {
                series_id: 'UNRATE',
                observations: [
                  { date: '2026-01-01', value: '4.3' }
                ]
              },
              provenance: {
                source: 'Federal Reserve Economic Data (FRED)',
                source_url: 'https://fred.stlouisfed.org/series/UNRATE',
                fetched_at: '2026-02-18T15:43:29.335Z',
                signature: '0x...'
              }
            }
          }
        },
        schema: {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              properties: {
                series_id: { type: 'string' },
                observations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: { type: 'string' },
                      value: { type: 'string' }
                    }
                  }
                }
              }
            },
            provenance: {
              type: 'object',
              properties: {
                source: { type: 'string' },
                source_url: { type: 'string' },
                fetched_at: { type: 'string' },
                signature: { type: 'string' }
              }
            }
          }
        }
      }
    }
  });
});

// Aggregate metrics from access log
function getMetricsFromLog() {
  try {
    if (!fs.existsSync(ACCESS_LOG)) {
      return {
        total_revenue_usd: 0,
        total_calls: 0,
        unique_buyers: 0,
        calls_last_24h: 0,
        revenue_last_24h_usd: 0,
        top_endpoints: [],
        verified_payment_rate_pct: 0
      };
    }

    const logData = fs.readFileSync(ACCESS_LOG, 'utf8');
    const lines = logData.trim().split('\n').filter(l => l);
    
    if (lines.length === 0) {
      return {
        total_revenue_usd: 0,
        total_calls: 0,
        unique_buyers: 0,
        calls_last_24h: 0,
        revenue_last_24h_usd: 0,
        top_endpoints: [],
        verified_payment_rate_pct: 0
      };
    }

    const entries = lines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return null;
      }
    }).filter(e => e !== null);

    const now = Date.now();
    const last24h = now - (24 * 60 * 60 * 1000);

    // Totals
    const total_revenue_usd = entries.reduce((sum, e) => sum + (e.price_usd || 0), 0);
    const total_calls = entries.length;
    
    // Unique buyers (non-null wallet addresses)
    const uniqueWallets = new Set(
      entries.filter(e => e.wallet_address).map(e => e.wallet_address)
    );
    const unique_buyers = uniqueWallets.size;

    // Last 24h
    const recent = entries.filter(e => e.timestamp >= last24h);
    const calls_last_24h = recent.length;
    const revenue_last_24h_usd = recent.reduce((sum, e) => sum + (e.price_usd || 0), 0);

    // Top endpoints
    const endpointStats = {};
    entries.forEach(e => {
      if (!endpointStats[e.endpoint]) {
        endpointStats[e.endpoint] = { calls: 0, revenue_usd: 0 };
      }
      endpointStats[e.endpoint].calls++;
      endpointStats[e.endpoint].revenue_usd += (e.price_usd || 0);
    });

    const top_endpoints = Object.entries(endpointStats)
      .map(([endpoint, stats]) => ({
        endpoint,
        calls: stats.calls,
        revenue_usd: parseFloat(stats.revenue_usd.toFixed(2))
      }))
      .sort((a, b) => b.revenue_usd - a.revenue_usd)
      .slice(0, 10);

    // Verified payment rate
    const verifiedCount = entries.filter(e => e.verified === true).length;
    const verified_payment_rate_pct = total_calls > 0 
      ? parseFloat(((verifiedCount / total_calls) * 100).toFixed(1))
      : 0;

    return {
      total_revenue_usd: parseFloat(total_revenue_usd.toFixed(2)),
      total_calls,
      unique_buyers,
      calls_last_24h,
      revenue_last_24h_usd: parseFloat(revenue_last_24h_usd.toFixed(2)),
      top_endpoints,
      verified_payment_rate_pct
    };
  } catch (e) {
    console.error('Failed to read metrics from log:', e.message);
    return {
      total_revenue_usd: 0,
      total_calls: 0,
      unique_buyers: 0,
      calls_last_24h: 0,
      revenue_last_24h_usd: 0,
      top_endpoints: [],
      verified_payment_rate_pct: 0,
      error: e.message
    };
  }
}

// GET /metrics — live revenue and usage statistics
app.get('/metrics', (req, res) => {
  const metrics = getMetricsFromLog();
  const cacheMetrics = getCacheMetrics();
  
  res.json({
    ...metrics,
    ...cacheMetrics
  });
});

app.get('/health', (req, res) => {
  const metrics = getMetricsFromLog();
  const cacheMetrics = getCacheMetrics();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    signing_address: signingWallet ? signingWallet.address : null,
    fred_configured: !!FRED_API_KEY,
    revenue_last_24h_usd: metrics.revenue_last_24h_usd,
    calls_last_24h: metrics.calls_last_24h,
    verified_payment_rate_pct: metrics.verified_payment_rate_pct,
    cache_size: cacheMetrics.cache_size,
    cache_hit_rate_pct: cacheMetrics.cache_hit_rate_pct,
    oldest_entry_age_seconds: cacheMetrics.oldest_entry_age_seconds
  });
});

const JSON_MANIFEST = {
  name: 'Mercury x402',
  tagline: 'Deterministic financial data with cryptographic provenance',
  version: '1.1.0',
  endpoints: {
    fred: {
      path: '/v1/fred/{series_id}',
      price: getPrice('/v1/fred/{series_id}'),
      description: 'Federal Reserve Economic Data (FRED) series'
    },
    treasury: {
      path: '/v1/treasury/yield-curve/daily-snapshot',
      price: getPrice('/v1/treasury/yield-curve/daily-snapshot'),
      description: 'U.S. Treasury yield curve (11 maturities)'
    },
    economicDashboard: {
      path: '/v1/composite/economic-dashboard',
      price: getPrice('/v1/composite/economic-dashboard'),
      description: 'Economic overview: GDP, CPI, Unemployment'
    },
    inflationTracker: {
      path: '/v1/composite/inflation-tracker',
      price: getPrice('/v1/composite/inflation-tracker'),
      description: 'Inflation metrics: CPI, PCE, Core CPI'
    },
    laborMarket: {
      path: '/v1/composite/labor-market',
      price: getPrice('/v1/composite/labor-market'),
      description: 'Labor market: Unemployment, Claims, Payrolls'
    },
    discovery: {
      path: '/.well-known/x402',
      price: 0,
      description: 'x402 discovery document'
    },
    health: {
      path: '/health',
      price: 0,
      description: 'Service health check'
    }
  },
  docs: {
    quickstart: 'https://mercury402.uk/docs',
    apiReference: 'https://mercury402.uk/docs/api',
    openapi: 'https://mercury402.uk/openapi.json'
  }
};

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mercury x402</title>
<meta name="description" content="Monetization infrastructure for autonomous agents. HTTP 402 micropayments with USDC settlement on Base and deterministic signed financial data.">
<meta name="keywords" content="AI agents, micropayments, HTTP 402, USDC, Base, financial API, payment-native data, x402">
<meta property="og:title" content="Mercury x402 — AI Agent Monetization Infrastructure">
<meta property="og:description" content="Payment-native financial data with HTTP 402 enforcement and on-chain USDC settlement. View demo of payment flow.">
<meta property="og:image" content="https://mercury402.uk/payment-flow-preview.png">
<meta property="og:url" content="https://mercury402.uk/">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Mercury x402 — AI Agent Monetization Infrastructure">
<meta name="twitter:description" content="Payment-native financial data via HTTP 402 micropayments with on-chain USDC settlement.">
<meta name="twitter:image" content="https://mercury402.uk/payment-flow-preview.png">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(circle at 20% 0%,rgba(31,111,235,0.15),transparent 40%),radial-gradient(circle at 80% 100%,rgba(56,139,253,0.12),transparent 40%),#0d1117;color:#e6edf3;min-height:100vh;padding:3rem 1rem}
  .container{max-width:960px;margin:0 auto}
  h1{font-size:2.8rem;font-weight:700;letter-spacing:-.6px;margin-bottom:.6rem}
  .tagline{font-size:1.15rem;color:#e6edf3;margin-bottom:.4rem}
  .subtext{font-size:.9rem;color:#8b949e;margin-bottom:2.5rem}
  .bullets{list-style:none;margin-bottom:2.5rem}
  .bullets li{padding:.45rem 0;display:flex;align-items:center;gap:.6rem;color:#c9d1d9}
  .bullets li::before{content:"→";color:#58a6ff;font-weight:700}
  .cards{display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:2.5rem;margin-top:1.5rem}
  .card{flex:1;min-width:200px;background:linear-gradient(145deg,#111827,#0f172a);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1.6rem;transition:all .2s ease}
  .card:hover{border-color:rgba(31,111,235,0.5);transform:translateY(-3px)}
  .card h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:.6rem}
  .card .price{font-size:2rem;font-weight:700;color:#58a6ff}
  .card .price span{font-size:1rem;color:#8b949e;font-weight:400}
  .card p{font-size:.85rem;color:#8b949e;margin-top:.4rem}
  .links{display:flex;gap:.8rem;flex-wrap:wrap}
  a.btn{display:inline-block;padding:.55rem 1.2rem;border-radius:6px;text-decoration:none;font-size:.9rem;font-weight:500;border:1px solid #30363d;color:#c9d1d9;background:#161b22;transition:all .2s ease}
  a.btn:hover{border-color:#58a6ff;color:#58a6ff}
  a.btn.primary{background:linear-gradient(90deg,#1f6feb,#388bfd);color:#fff;border:none;box-shadow:0 6px 20px rgba(31,111,235,0.35)}
  a.btn.primary:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(31,111,235,0.45)}
  footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #21262d;font-size:.8rem;color:#484f58}
  .cred-strip{display:flex;gap:.6rem;flex-wrap:wrap;font-size:.75rem;color:#8b949e;margin-bottom:2.2rem;letter-spacing:.4px;opacity:.85}
  .cred-strip span{background:rgba(255,255,255,0.05);padding:.35rem .6rem;border-radius:6px}
  .usecases{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1.5rem;margin-bottom:2.8rem}
  .usecases h4{font-size:.95rem;margin-bottom:.35rem;color:#e6edf3}
  .usecases p{font-size:.8rem;color:#8b949e;line-height:1.4}
  .trust-line{font-size:.8rem;color:#8b949e;margin-bottom:1rem;letter-spacing:.3px}
  .footer-line{font-size:.75rem;color:#6e7681;margin-top:3rem;opacity:.7}
  .positioning{margin-bottom:2.8rem}
  .positioning h3{font-size:1.05rem;margin-bottom:.6rem;color:#e6edf3}
  .positioning p{font-size:.85rem;color:#8b949e;line-height:1.5;max-width:700px}
  .preview{margin:2.5rem 0 1.8rem 0;text-align:center}
  .preview img{width:100%;max-width:880px;border-radius:12px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 10px 40px rgba(0,0,0,0.45);transition:all .2s ease}
  .preview img:hover{transform:translateY(-4px);box-shadow:0 20px 60px rgba(0,0,0,0.6)}
</style>
</head>
<body>
<div class="container">
  <h1>Mercury x402</h1>
  <p class="tagline">Monetization Infrastructure for Autonomous Agents</p>
  <p class="subtext">Enable agents to pay and get paid via HTTP 402 micropayments &mdash; with instant USDC settlement and cryptographically signed responses.</p>
  <div class="cred-strip">
    <span>HTTP 402</span>
    <span>•</span>
    <span>EIP-3009</span>
    <span>•</span>
    <span>Base Mainnet (8453)</span>
    <span>•</span>
    <span>USDC Settlement</span>
    <span>•</span>
    <span>Deterministic JSON</span>
  </div>
  <div class="positioning">
    <h3>Why This Matters</h3>
    <p>Most AI agents consume APIs. Very few can participate in payment-native systems. Mercury x402 turns financial data into a monetizable primitive &mdash; allowing agents to operate without subscriptions, API keys, or centralized billing systems.</p>
  </div>
  <ul class="bullets">
    <li>Pay-per-call via x402 — no API keys</li>
    <li>Instant USDC settlement on Base (8453)</li>
    <li>Every response cryptographically signed on-chain</li>
  </ul>
  <div class="usecases">
    <div>
      <h4>Trading Systems</h4>
      <p>Automated macro-driven execution without subscription-based data feeds.</p>
    </div>
    <div>
      <h4>AI Agents</h4>
      <p>Autonomous agents capable of paying per request and operating without API keys.</p>
    </div>
    <div>
      <h4>Research Infrastructure</h4>
      <p>Deterministic financial snapshots designed for verifiable, monetizable pipelines.</p>
    </div>
  </div>
  <div class="cards">
    <div class="card">
      <h3>FRED Series</h3>
      <div class="price">$0.15<span>/call</span></div>
      <p>Any FRED macroeconomic series (GDP, CPI, UNRATE, 800k+)</p>
    </div>
    <div class="card">
      <h3>Treasury Yield Curve</h3>
      <div class="price">$0.10<span>/call</span></div>
      <p>Daily U.S. Treasury par yield curve snapshot</p>
    </div>
    <div class="card">
      <h3>Economic Dashboard</h3>
      <div class="price">$0.50<span>/call</span></div>
      <p>GDP, CPI, and Unemployment in one composite call</p>
    </div>
    <div class="card">
      <h3>Inflation Tracker</h3>
      <div class="price">$0.40<span>/call</span></div>
      <p>CPI, PCE, and Core CPI inflation metrics</p>
    </div>
    <div class="card">
      <h3>Labor Market</h3>
      <div class="price">$0.40<span>/call</span></div>
      <p>Unemployment, Jobless Claims, and Nonfarm Payrolls</p>
    </div>
  </div>
  <p class="trust-line">Designed for builders who want agents that transact &mdash; not just query.</p>
  <div class="preview">
    <a href="/demo">
      <img src="/payment-flow-preview.png" alt="x402 Payment Flow Preview">
    </a>
  </div>
  <a class="btn primary" href="/demo" style="display:inline-block;margin-bottom:1.5rem">View Payment Flow &#8594;</a>
  <div class="links" style="opacity:.85">
    <a class="btn" href="/docs/api">API Reference</a>
    <a class="btn" href="/docs">Quickstart</a>
    <a class="btn" href="/.well-known/x402">x402 Discovery</a>
    <a class="btn" href="/health">Health</a>
  </div>
  <p class="footer-line">Mercury x402 &mdash; Financial data as a payment-native building block for autonomous systems.</p>
</div>
</body>
</html>`;

const DOCS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mercury x402 — Quickstart</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;padding:3rem 1rem}
  .container{max-width:760px;margin:0 auto}
  h1{font-size:2rem;font-weight:700;margin-bottom:.4rem}
  .sub{color:#8b949e;margin-bottom:2.5rem;font-size:1rem}
  h2{font-size:1.1rem;font-weight:600;color:#58a6ff;margin:2rem 0 .8rem}
  p{color:#c9d1d9;line-height:1.65;margin-bottom:.8rem}
  pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:1rem 1.2rem;overflow-x:auto;margin-bottom:1.2rem}
  code{font-family:"SF Mono",Menlo,monospace;font-size:.85rem;color:#79c0ff}
  a{color:#58a6ff;text-decoration:none}
  a:hover{text-decoration:underline}
  .addr{font-family:"SF Mono",Menlo,monospace;font-size:.8rem;color:#8b949e;word-break:break-all}
  footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #21262d;font-size:.8rem;color:#484f58}
</style>
</head>
<body>
<div class="container">
  <h1>Mercury x402 — Quickstart</h1>
  <p class="sub">Deterministic financial data API with pay-per-call via the <a href="https://x402.org">x402 protocol</a>.</p>

  <h2>What is Mercury?</h2>
  <p>Mercury exposes financial time-series data (FRED, U.S. Treasury) via HTTP endpoints protected by the x402 micropayment standard. Each call costs a small amount of USDC on Base (chain 8453). No API keys. No subscriptions. Every response carries a cryptographic provenance signature.</p>

  <h2>Step 1 — Make an unpaid request (see the 402)</h2>
  <pre><code>curl -i https://mercury402.uk/v1/fred/UNRATE</code></pre>
  <p>You will get back <code>HTTP 402 Payment Required</code> with a <code>Payment-Required</code> header containing a base64url-encoded payment descriptor:</p>
  <pre><code>HTTP/2 402
Payment-Required: eyJzY2hlbWUiOiJleGFjdCIsIm5...

{
  "error": "PAYMENT_REQUIRED",
  "price": "$0.15 USDC (Base)",
  "paymentUri": "https://x402.io/pay?..."
}</code></pre>

  <h2>Step 2 — Pay and get a token</h2>
  <p>Visit the <code>paymentUri</code> or any x402-compatible client. After paying, you receive a bearer token like <code>x402_abc123...</code>.</p>

  <h2>Step 3 — Make a paid request</h2>
  <pre><code>curl -H "Authorization: Bearer x402_&lt;token&gt;" \\
  https://mercury402.uk/v1/fred/UNRATE</code></pre>
  <pre><code>curl -H "Authorization: Bearer x402_&lt;token&gt;" \\
  https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot</code></pre>

  <h2>Payment details</h2>
  <p>USDC contract on Base:</p>
  <p class="addr">0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913</p>
  <p>Mercury payment recipient (<code>payTo</code>):</p>
  <p class="addr">0xF8d59270cBC746a7593D25b6569812eF1681C6D2</p>

  <h2>Pricing</h2>
  <p>FRED series (<code>/v1/fred/{series_id}</code>) — <strong>$0.15</strong> (amount: 150000 &mu;USDC)<br>
  Treasury yield curve (<code>/v1/treasury/yield-curve/daily-snapshot</code>) — <strong>$0.10</strong> (amount: 100000 &mu;USDC)</p>

  <h2>Discovery</h2>
  <pre><code>curl https://mercury402.uk/.well-known/x402 | jq .</code></pre>

  <h2>SDK Examples</h2>
  <p>Full copy-paste examples for Node.js and Python: <a href="/sdk-examples">SDK Examples</a></p>

  <footer><a href="/">&#8592; Back</a> &nbsp;&middot;&nbsp; Mercury x402</footer>
</div>
</body>
</html>`;

app.get('/', (req, res) => {
  const accept = req.headers['accept'] || '';
  const ua = req.headers['user-agent'] || '';
  if (accept.includes('text/html') || ua.includes('Mozilla')) {
    return res.set('Content-Type', 'text/html').send(LANDING_HTML);
  }
  res.json(JSON_MANIFEST);
});

app.get('/meta.json', (req, res) => {
  res.json(JSON_MANIFEST);
});

app.get('/docs', (req, res) => {
  res.set('Content-Type', 'text/html').send(DOCS_HTML);
});

app.get('/docs/quickstart', (req, res) => {
  const mdPath = path.join(__dirname, '..', 'docs', 'quickstart-x402-agents.md');
  let md;
  try {
    md = fs.readFileSync(mdPath, 'utf8');
  } catch (e) {
    return res.status(404).send('Quickstart guide not found');
  }
  res.set('Content-Type', 'text/markdown').send(md);
});

app.get('/sdk-examples', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const mdPath = path.join(__dirname, '..', 'docs', 'SDK_EXAMPLES.md');
  let md;
  try {
    md = fs.readFileSync(mdPath, 'utf8');
  } catch (e) {
    return res.status(404).send('SDK_EXAMPLES.md not found');
  }
  // Escape HTML then wrap in a minimal styled page — no markdown parser needed
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mercury x402 — SDK Examples</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:"SF Mono",Menlo,monospace;background:#0d1117;color:#c9d1d9;padding:3rem 1rem;line-height:1.7}
  .container{max-width:860px;margin:0 auto}
  pre{white-space:pre-wrap;word-break:break-word}
  a{color:#58a6ff}
  footer{margin-top:2rem;padding-top:1rem;border-top:1px solid #21262d;font-size:.8rem;color:#484f58}
</style>
</head>
<body>
<div class="container">
<pre>${escaped}</pre>
<footer><a href="/docs">&#8592; Quickstart</a> &nbsp;&middot;&nbsp; <a href="/">Home</a></footer>
</div>
</body>
</html>`;
  res.set('Content-Type', 'text/html').send(html);
});

app.get(['/demo', '/demo/'], (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const demoPath = path.join(__dirname, '..', 'public', 'demo.html');
  let html;
  try {
    html = fs.readFileSync(demoPath, 'utf8');
  } catch (e) {
    return res.status(404).send('demo.html not found');
  }
  res.set('Content-Type', 'text/html').send(html);
});

// OpenAPI spec as JSON
app.get('/openapi.json', (req, res) => {
  const yaml = require('js-yaml');
  const fs = require('fs');
  const path = require('path');
  const yamlPath = path.join(__dirname, '..', 'docs', 'openapi.yaml');
  
  try {
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    const jsonSpec = yaml.load(yamlContent);
    res.set('Content-Type', 'application/json');
    res.json(jsonSpec);
  } catch (e) {
    console.error('Failed to load OpenAPI spec:', e.message);
    res.status(500).json({
      error: {
        code: 'SPEC_LOAD_ERROR',
        message: 'Failed to load OpenAPI specification',
        detail: e.message
      }
    });
  }
});

// Swagger UI (CDN-based, no npm install required)
app.get('/docs/api', (req, res) => {
  const swaggerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mercury x402 API Documentation</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; }
    .topbar { display: none; }
    .swagger-ui .info .title { color: #58a6ff; }
    .swagger-ui { max-width: 1400px; margin: 0 auto; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      const ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 1,
        docExpansion: "list",
        filter: true,
        tryItOutEnabled: true
      });
      window.ui = ui;
    };
  </script>
</body>
</html>`;
  res.set('Content-Type', 'text/html').send(swaggerHTML);
});

// Start server
app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 Mercury x402 Service`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Discovery: http://localhost:${PORT}/.well-known/x402`);
  console.log(`   FRED API: ${FRED_API_KEY ? '✅' : '❌'} configured`);
  console.log(`   Signing: ${signingWallet ? '✅ ' + signingWallet.address : '❌ not configured'}`);
  console.log('');
});

module.exports = app;
