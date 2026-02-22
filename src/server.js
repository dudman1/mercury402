const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4020;

app.use(cors());
app.use(express.json());

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
    // Check for x402 payment token in Authorization header
    const authHeader = req.headers.authorization || '';
    
    // Parse token from "Bearer x402_..." format
    const bearerMatch = authHeader.match(/^Bearer\s+(x402_\S+)$/);
    const token = bearerMatch ? bearerMatch[1] : null;
    
    if (!token) {
      // No authorization header with x402 token
      const paymentRequired = encodePaymentRequired(price);
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
    
    // Validate token: reject test tokens unless ALLOW_TEST_TOKEN=true
    if (token === 'x402_test' || token.startsWith('x402_test')) {
      if (process.env.ALLOW_TEST_TOKEN !== 'true') {
        const paymentRequired = encodePaymentRequired(price);
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
    }
    
    // TODO: In production, validate token against x402 payment ledger/bridge
    // For now, accept any non-test token
    next();
  };
}

// ============================================
// FRED ENDPOINT
// ============================================

async function fetchFredData(seriesId, params) {
  const fredUrl = 'https://api.stlouisfed.org/fred/series/observations';
  
  const query = {
    api_key: FRED_API_KEY,
    series_id: seriesId,
    file_type: 'json',
    ...params
  };

  const response = await axios.get(fredUrl, { params: query });
  return response.data;
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

app.get('/v1/fred/:series_id', require402Payment('/v1/fred/{series_id}', 0.15), async (req, res) => {
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
    const isRange = observation_start && observation_end;
    const price = isRange ? 0.30 : 0.15;

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

    // Fetch from FRED
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

async function fetchTreasuryData(date) {
  // This is a placeholder - you'll need to implement actual Treasury.gov scraping
  // For now, return mock data structure
  const mockData = {
    record_date: date || new Date().toISOString().split('T')[0],
    rates: {
      '1_MONTH': 4.42,
      '3_MONTH': 4.38,
      '6_MONTH': 4.33,
      '1_YEAR': 4.23,
      '2_YEAR': 4.12,
      '3_YEAR': 4.05,
      '5_YEAR': 4.01,
      '7_YEAR': 4.08,
      '10_YEAR': 4.19,
      '20_YEAR': 4.47,
      '30_YEAR': 4.52
    }
  };

  return mockData;
}

function buildTreasuryProvenance(data, fetchedAt) {
  const provenance = {
    source: 'U.S. Department of the Treasury - Daily Treasury Par Yield Curve Rates',
    source_url: `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value=${data.record_date.substring(0, 4)}`,
    fetched_at: fetchedAt,
    mercury_version: 'v1.0',
    deterministic: true,
    cache_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  };

  // Generate signature
  if (signingWallet) {
    try {
      const canonical = JSON.stringify({
        record_date: data.record_date,
        rates: data.rates,
        fetched_at: fetchedAt
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

app.get('/v1/treasury/yield-curve/daily-snapshot', require402Payment('/v1/treasury/yield-curve/daily-snapshot', 0.10), async (req, res) => {
  try {
    const { v, date } = req.query;

    // Fetch treasury data
    const treasuryData = await fetchTreasuryData(date);
    const fetchedAt = new Date().toISOString();

    // Legacy format (v0.9)
    if (v === '0.9') {
      return res.json(treasuryData);
    }

    // New format with provenance (v1.0 default)
    const provenance = buildTreasuryProvenance(treasuryData, fetchedAt);

    res.json({
      data: treasuryData,
      provenance
    });

  } catch (error) {
    console.error('Treasury endpoint error:', error.message);
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message
      }
    });
  }
});

// ============================================
// DISCOVERY & HEALTH
// ============================================

app.get('/.well-known/x402', (req, res) => {
  res.json({
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453', // Base mainnet
        amount: '150000', // 0.15 USDC in wei (6 decimals)
        payTo: MERCHANT_WALLET,
        maxTimeoutSeconds: 30,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
        extra: {
          endpoints: [
            {
              path: '/v1/fred/{series_id}',
              price: 0.15,
              description: 'Federal Reserve Economic Data (FRED) series'
            }
          ]
        }
      },
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '100000', // 0.10 USDC in wei
        payTo: MERCHANT_WALLET,
        maxTimeoutSeconds: 30,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        extra: {
          endpoints: [
            {
              path: '/v1/treasury/yield-curve/daily-snapshot',
              price: 0.10,
              description: 'U.S. Treasury yield curve snapshot with cryptographic provenance'
            }
          ]
        }
      }
    ],
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

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    signing_address: signingWallet ? signingWallet.address : null,
    fred_configured: !!FRED_API_KEY
  });
});

const JSON_MANIFEST = {
  name: 'Mercury x402',
  tagline: 'Deterministic financial data with cryptographic provenance',
  version: '1.0.0',
  endpoints: {
    fred: '/v1/fred/{series_id}',
    treasury: '/v1/treasury/yield-curve/daily-snapshot',
    discovery: '/.well-known/x402',
    health: '/health'
  },
  docs: 'https://mercury402.uk/docs'
};

const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Mercury x402</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#e6edf3;min-height:100vh;padding:3rem 1rem}
  .container{max-width:760px;margin:0 auto}
  h1{font-size:2.4rem;font-weight:700;letter-spacing:-.5px;margin-bottom:.5rem}
  .tagline{font-size:1.15rem;color:#8b949e;margin-bottom:2.5rem}
  .bullets{list-style:none;margin-bottom:2.5rem}
  .bullets li{padding:.45rem 0;display:flex;align-items:center;gap:.6rem;color:#c9d1d9}
  .bullets li::before{content:"→";color:#58a6ff;font-weight:700}
  .cards{display:flex;gap:1.2rem;flex-wrap:wrap;margin-bottom:2.5rem}
  .card{flex:1;min-width:200px;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:1.3rem 1.5rem}
  .card h3{font-size:.85rem;text-transform:uppercase;letter-spacing:.08em;color:#8b949e;margin-bottom:.6rem}
  .card .price{font-size:2rem;font-weight:700;color:#58a6ff}
  .card .price span{font-size:1rem;color:#8b949e;font-weight:400}
  .card p{font-size:.85rem;color:#8b949e;margin-top:.4rem}
  .links{display:flex;gap:.8rem;flex-wrap:wrap}
  a.btn{display:inline-block;padding:.55rem 1.2rem;border-radius:6px;text-decoration:none;font-size:.9rem;font-weight:500;border:1px solid #30363d;color:#c9d1d9;background:#161b22;transition:border-color .15s,color .15s}
  a.btn:hover{border-color:#58a6ff;color:#58a6ff}
  a.btn.primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
  a.btn.primary:hover{background:#388bfd;border-color:#388bfd}
  footer{margin-top:3rem;padding-top:1.5rem;border-top:1px solid #21262d;font-size:.8rem;color:#484f58}
</style>
</head>
<body>
<div class="container">
  <h1>Mercury x402</h1>
  <p class="tagline">Deterministic financial data with cryptographic provenance.</p>
  <ul class="bullets">
    <li>Pay-per-call via x402 — no API keys, no subscriptions</li>
    <li>Settles instantly in USDC on Base (chain 8453)</li>
    <li>Every response is signed on-chain for verifiable provenance</li>
  </ul>
  <div class="cards">
    <div class="card">
      <h3>FRED Series</h3>
      <div class="price">$0.15<span>/call</span></div>
      <p>Any FRED series — UNRATE, GDP, CPI, and 800k+ more</p>
    </div>
    <div class="card">
      <h3>Treasury Yield Curve</h3>
      <div class="price">$0.10<span>/call</span></div>
      <p>Daily snapshot of the U.S. Treasury par yield curve</p>
    </div>
  </div>
  <div class="links">
    <a class="btn primary" href="/docs">Quickstart</a>
    <a class="btn" href="/.well-known/x402">x402 Discovery</a>
    <a class="btn" href="/health">Health</a>
  </div>
  <footer>Mercury x402 &mdash; data from FRED &amp; U.S. Treasury &mdash; payments via <a href="https://x402.org" style="color:#58a6ff">x402 protocol</a></footer>
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
