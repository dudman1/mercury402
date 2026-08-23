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

// Bazaar schema metadata for x402scan discovery
// Fixed BAZAAR_SCHEMAS structure for x402scan compatibility
// Replace lines 117-181 in ~/mercury-x402-service/src/server.js

const BAZAAR_SCHEMAS = {
  '/v1/fred/{series_id}': {
    info: {
      input: { type: 'http', method: 'GET', pathParams: { series_id: { type: 'string', description: 'FRED series ID (e.g., UNRATE, GDP, CPIAUCSL)', example: 'UNRATE' } }, queryParams: { date: { type: 'string', description: 'Single date observation (YYYY-MM-DD)', example: '2026-01-01' }, observation_start: { type: 'string', description: 'Start date for range query (YYYY-MM-DD)', example: '2020-01-01' }, observation_end: { type: 'string', description: 'End date for range query (YYYY-MM-DD)', example: '2023-12-31' }, limit: { type: 'integer', description: 'Max observations to return', example: 5 } } },
      output: { type: 'json', example: { series_id: 'UNRATE', realtime_start: '2026-03-11', realtime_end: '2026-03-11', observations: [{ date: '2024-01-01', value: '3.7' }] } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            pathParams: {
              type: 'object',
              properties: {
                series_id: { type: 'string', description: 'FRED series ID' }
              },
              required: ['series_id']
            },
            queryParams: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Single date observation (YYYY-MM-DD)' },
                observation_start: { type: 'string', description: 'Range start date (YYYY-MM-DD)' },
                observation_end: { type: 'string', description: 'Range end date (YYYY-MM-DD)' },
                limit: { type: 'integer', description: 'Max observations to return (default 1)' }
              }
            }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            series_id: { type: 'string' },
            realtime_start: { type: 'string' },
            realtime_end: { type: 'string' },
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
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/treasury/yield-curve/daily-snapshot': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: { date: { type: 'string', description: 'Specific date for yield curve (YYYY-MM-DD)', example: '2026-03-01' } } },
      output: { type: 'json', example: { date: '2026-03-11', rates: { '1_MONTH': 5.42, '3_MONTH': 5.38 } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: {
              type: 'object',
              properties: {
                date: { type: 'string', description: 'Specific date for yield curve (YYYY-MM-DD)' }
              }
            }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            rates: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/composite/economic-dashboard': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { timestamp: '2026-03-11T01:00:00Z', gdp: { value: 22000.5 } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            gdp: { type: 'object' },
            unemployment: { type: 'object' },
            inflation: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/composite/inflation-tracker': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { timestamp: '2026-03-11T01:00:00Z', cpi: { value: 315.2 } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            cpi: { type: 'object' },
            core_cpi: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/composite/labor-market': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { timestamp: '2026-03-11T01:00:00Z', unemployment_rate: { value: 3.7 } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            unemployment_rate: { type: 'object' },
            labor_force_participation: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/macro/snapshot/all': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { timestamp: '2026-03-11T01:00:00Z', indicators: { GDP: { value: 22000.5 } } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            indicators: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/treasury/yield-curve/historical': {
    info: {
      input: { type: 'http', method: 'POST', bodyType: 'json', body: { start_date: '2024-01-01', end_date: '2024-03-31' } },
      output: { type: 'json', example: { start_date: '2024-01-01', end_date: '2024-03-31', data: [] } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'POST' },
            bodyType: { type: 'string', const: 'json' },
            body: {
              type: 'object',
              properties: {
                start_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Start date (YYYY-MM-DD)' },
                end_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'End date (YYYY-MM-DD)' }
              },
              required: ['start_date', 'end_date'],
              additionalProperties: false
            }
          },
          required: ['type', 'method', 'bodyType', 'body']
        },
        output: {
          type: 'object',
          properties: {
            start_date: { type: 'string' },
            end_date: { type: 'string' },
            data: { type: 'array' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/treasury/auction-results/recent': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { timestamp: '2026-03-11T01:00:00Z', auctions: [] } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            timestamp: { type: 'string' },
            auctions: { type: 'array' }
          }
        }
      },
      required: ['input', 'output']
    }
  },
  '/v1/treasury/tips-rates/current': {
    info: {
      input: { type: 'http', method: 'GET', queryParams: {} },
      output: { type: 'json', example: { date: '2026-03-11', rates: { '5_YEAR': 2.15 } } }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: {
            type: { type: 'string', const: 'http' },
            method: { type: 'string', const: 'GET' },
            queryParams: { type: 'object', description: 'No query parameters required', properties: {} }
          },
          required: ['type', 'method']
        },
        output: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            rates: { type: 'object' }
          }
        }
      },
      required: ['input', 'output']
    }
  }
};

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
const MAX_LOG_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_ROTATED_FILES = 7;

// Parse x402 token for payment metadata (wallet, tx_hash)
// Defensive decoder: tries multiple formats (JWT, base64 JSON, hex JSON)
function parsePaymentToken(token) {
  if (!token || !token.startsWith('x402_')) {
    return {
      wallet_address: null,
      tx_hash: null,
      token_id: token,
      wallet_source: 'invalid_format'
    };
  }

  const tokenBody = token.replace('x402_', '');
  
  // Strategy 1: Try base64-encoded JSON
  try {
    const decoded = Buffer.from(tokenBody, 'base64').toString('utf8');
    const json = JSON.parse(decoded);
    
    if (json && (json.wallet || json.wallet_address) && (json.tx || json.tx_hash)) {
      return {
        wallet_address: json.wallet || json.wallet_address || null,
        tx_hash: json.tx || json.tx_hash || null,
        token_id: token,
        wallet_source: 'base64_claim',
        merchant: json.merchant || null,
        amount: json.amount || null,
        network: json.network || null,
        timestamp: json.timestamp || json.iat || null
      };
    }
  } catch (e) {
    // Not base64 JSON, try next format
  }

  // Strategy 2: Try hex-encoded JSON
  try {
    const decoded = Buffer.from(tokenBody, 'hex').toString('utf8');
    const json = JSON.parse(decoded);
    
    if (json && (json.wallet || json.wallet_address) && (json.tx || json.tx_hash)) {
      return {
        wallet_address: json.wallet || json.wallet_address || null,
        tx_hash: json.tx || json.tx_hash || null,
        token_id: token,
        wallet_source: 'hex_claim',
        merchant: json.merchant || null,
        amount: json.amount || null,
        network: json.network || null,
        timestamp: json.timestamp || json.iat || null
      };
    }
  } catch (e) {
    // Not hex JSON, try next format
  }

  // Strategy 3: Try JWT decode (without verification)
  try {
    const parts = tokenBody.split('.');
    if (parts.length === 3) {
      // JWT format: header.payload.signature
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      
      if (payload && (payload.wallet || payload.wallet_address) && (payload.tx || payload.tx_hash)) {
        return {
          wallet_address: payload.wallet || payload.wallet_address || null,
          tx_hash: payload.tx || payload.tx_hash || null,
          token_id: token,
          wallet_source: 'jwt_claim',
          merchant: payload.merchant || null,
          amount: payload.amount || null,
          network: payload.network || null,
          timestamp: payload.timestamp || payload.iat || null,
          expires: payload.exp || null
        };
      }
    }
  } catch (e) {
    // Not JWT or parsing failed
  }

  // Fallback: token is unparseable, return nulls
  console.warn(`Unable to parse x402 token format: ${token.substring(0, 20)}...`);
  return {
    wallet_address: null,
    tx_hash: null,
    token_id: token,
    wallet_source: 'unparseable'
  };
}

async function verifyPaymentOnChain(tx_hash, expected_amount_usd, merchant_wallet) {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
    const USDC_CONTRACT = process.env.USDC_CONTRACT_BASE;
    
    // Fetch transaction receipt (includes logs)
    const receipt = await provider.getTransactionReceipt(tx_hash);
    
    if (!receipt || receipt.status !== 1) {
      return { verified: false, reason: 'rpc_tx_not_found_or_failed' };
    }
    
    // Parse USDC Transfer event logs
    // Transfer event signature: Transfer(address indexed from, address indexed to, uint256 value)
    const transferTopic = ethers.id('Transfer(address,address,uint256)');
    
    const transferLog = receipt.logs.find(log => 
      log.address.toLowerCase() === USDC_CONTRACT.toLowerCase() &&
      log.topics[0] === transferTopic
    );
    
    if (!transferLog) {
      return { verified: false, reason: 'rpc_no_usdc_transfer' };
    }
    
    // Decode log: topics[1] = from, topics[2] = to, data = amount
    const recipientAddress = '0x' + transferLog.topics[2].slice(26); // Remove padding
    const amountHex = transferLog.data;
    const amountWei = BigInt(amountHex);
    const amountUSDC = Number(amountWei) / 1e6; // USDC has 6 decimals
    
    // Verify recipient matches merchant wallet
    if (recipientAddress.toLowerCase() !== merchant_wallet.toLowerCase()) {
      return { 
        verified: false, 
        reason: `rpc_wrong_recipient_expected_${merchant_wallet}_got_${recipientAddress}` 
      };
    }
    
    // Verify amount >= expected (allow slight underpayment tolerance of 1 cent)
    const tolerance = 0.01;
    if (amountUSDC < (expected_amount_usd - tolerance)) {
      return { 
        verified: false, 
        reason: `rpc_insufficient_amount_expected_${expected_amount_usd}_got_${amountUSDC}` 
      };
    }
    
    return { 
      verified: true, 
      actual_amount_usd: amountUSDC, 
      block_number: receipt.blockNumber 
    };
    
  } catch (error) {
    console.error('RPC verification error:', error.message);
    return { verified: false, reason: `rpc_error_${error.message.substring(0, 50)}` };
  }
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

// Log rotation helper
function rotateAccessLog() {
  try {
    if (!fs.existsSync(ACCESS_LOG)) return;
    
    const stats = fs.statSync(ACCESS_LOG);
    if (stats.size < MAX_LOG_SIZE) return;
    
    // Rotate: rename to mercury402-access.YYYY-MM-DD.jsonl
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const rotatedPath = path.join(
      path.dirname(ACCESS_LOG),
      `mercury402-access.${dateStr}.jsonl`
    );
    
    // If file for today already exists, append timestamp to make unique
    let finalPath = rotatedPath;
    if (fs.existsSync(finalPath)) {
      const timestamp = now.toISOString().replace(/[:.]/g, '-');
      finalPath = path.join(
        path.dirname(ACCESS_LOG),
        `mercury402-access.${dateStr}.${timestamp}.jsonl`
      );
    }
    
    fs.renameSync(ACCESS_LOG, finalPath);
    console.log(`✅ Log rotated: ${finalPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
    
    // Cleanup old rotated files (keep last MAX_ROTATED_FILES)
    const logDir = path.dirname(ACCESS_LOG);
    const files = fs.readdirSync(logDir)
      .filter(f => f.startsWith('mercury402-access.') && f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        path: path.join(logDir, f),
        mtime: fs.statSync(path.join(logDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime); // Newest first
    
    // Delete files beyond MAX_ROTATED_FILES
    if (files.length > MAX_ROTATED_FILES) {
      files.slice(MAX_ROTATED_FILES).forEach(file => {
        fs.unlinkSync(file.path);
        console.log(`🗑️  Deleted old log: ${file.name}`);
      });
    }
  } catch (e) {
    console.error('Log rotation failed:', e.message);
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
    wallet_source: paymentMeta?.wallet_source || null,
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
    
    // Check for log rotation before writing
    rotateAccessLog();
    
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

// Helper: Encode x402 payment info as base64url for Payment-Required header (v2 format)
function encodePaymentRequired(price, endpointPath, resolvedPath, method) {
  const paymentRequiredV2 = {
    x402Version: 2,
    accepts: [{
      scheme: 'exact',
      network: 'eip155:8453',
      amount: String(Math.floor(price * 1000000)),
      payTo: MERCHANT_WALLET,
      maxTimeoutSeconds: 30,
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      extra: {
        name: 'USD Coin',
        version: '2'
      }
    }],
    resource: {
      url: `https://mercury402.uk${resolvedPath}`,
      method: method.toUpperCase(),
      description: 'Deterministic financial data from official sources',
      mimeType: 'application/json'
    }
  };

  // Add Bazaar extensions if schema exists for this endpoint
  const bazaarSchema = BAZAAR_SCHEMAS[endpointPath];
  if (bazaarSchema) {
    paymentRequiredV2.extensions = {
      bazaar: bazaarSchema
    };
  }
  
  const json = JSON.stringify(paymentRequiredV2);
  const base64 = Buffer.from(json).toString('base64');
  // Convert standard base64 to base64url
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return base64url;
}

function require402Payment(endpointPath, price) {
  return async (req, res, next) => {
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
      // Check for x402 v2 payment-signature header (standard x402 protocol)
      const paymentSig = req.headers['payment-signature'];
      if (paymentSig) {
        try {
          // Decode x402 v2 PaymentPayload: base64 → JSON
          const paymentPayload = JSON.parse(Buffer.from(paymentSig, 'base64').toString('utf8'));

          // x402 v2 wraps the scheme payload inside .payload
          const schemePayload = paymentPayload.payload || paymentPayload;
          const authorization = schemePayload.authorization;
          if (!authorization || !authorization.from) {
            throw new Error('Missing authorization in payment payload');
          }

          // Validate payment requirements match this endpoint
          const accepted = paymentPayload.accepted;
          if (accepted) {
            const requiredAmount = BigInt(Math.floor(price * 1000000));
            const paidAmount = BigInt(authorization.value);
            if (paidAmount < requiredAmount) {
              throw new Error(`Insufficient payment: required ${requiredAmount}, got ${paidAmount}`);
            }
            if (accepted.payTo && accepted.payTo.toLowerCase() !== MERCHANT_WALLET.toLowerCase()) {
              throw new Error(`Wrong payTo: expected ${MERCHANT_WALLET}, got ${accepted.payTo}`);
            }
          }

          // Parse EIP-3009 signature: single hex string → v, r, s
          const sig = schemePayload.signature || authorization.signature;
          let v, r, s;
          if (sig) {
            const parsed = ethers.Signature.from(sig);
            v = parsed.v;
            r = parsed.r;
            s = parsed.s;
          } else if (authorization.v !== undefined) {
            // Legacy format: v, r, s already split
            v = authorization.v;
            r = authorization.r;
            s = authorization.s;
          } else {
            throw new Error('No signature found in payment payload');
          }

          // Execute transferWithAuthorization on-chain
          const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL);
          const facilitatorWallet = new ethers.Wallet(
            process.env.SERVER_PRIVATE_KEY.startsWith('0x') ? process.env.SERVER_PRIVATE_KEY : '0x' + process.env.SERVER_PRIVATE_KEY,
            provider
          );
          const USDC = new ethers.Contract(
            process.env.USDC_CONTRACT_BASE,
            ['function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)'],
            facilitatorWallet
          );

          const tx = await USDC.transferWithAuthorization(
            authorization.from,
            authorization.to,
            authorization.value,
            authorization.validAfter,
            authorization.validBefore,
            authorization.nonce,
            v, r, s
          );
          const receipt = await tx.wait();
          const verification = await verifyPaymentOnChain(receipt.hash, price, MERCHANT_WALLET);
          if (verification.verified) {
            // Set PAYMENT-RESPONSE header for x402 clients
            const settleResponse = Buffer.from(JSON.stringify({
              success: true,
              transaction: receipt.hash,
              network: 'eip155:8453',
              payer: authorization.from
            })).toString('base64');
            res.set('PAYMENT-RESPONSE', settleResponse);

            res.locals.paymentMeta = {
              wallet_address: authorization.from,
              tx_hash: receipt.hash,
              wallet_source: 'x402_eip3009',
              verified: true,
              price_usd: price
            };
            logPayment(endpointPath, price, authorization.from, true, receipt.hash);
            return next();
          }
          // Settlement succeeded but on-chain verification failed
          console.error('x402 payment settled but on-chain verify failed:', verification.reason);
        } catch (err) {
          console.error('x402 payment-signature error:', err.message);
        }
      }
      // No valid payment found
      const paymentRequired = encodePaymentRequired(price, endpointPath, req.path, req.method);
      res.locals.paymentMeta = { verified: false, price_usd: 0 };
      return res
        .status(402)
        .set('Payment-Required', paymentRequired)
        .json({
          error: 'PAYMENT_REQUIRED',
          message: 'Payment required. See Payment-Required header for x402 payment details.',
          price: `$${price.toFixed(2)} USDC (Base)`,
          x402: {
            scheme: 'exact',
            network: 'eip155:8453',
            instructions: 'Parse the Payment-Required header (base64 JSON) for payment requirements. Use any x402-compatible client (https://github.com/coinbase/x402) to pay and retry automatically.'
          }
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
        wallet_source: tokenMeta.wallet_source,
        verified: false,
        price_usd: price
      };
      
      return next();
    }
    
    if (isTestToken && !allowTestTokens) {
      // Test token in production - reject
      const paymentRequired = encodePaymentRequired(price, endpointPath, req.path, req.method);
      res.locals.paymentMeta = { verified: false, price_usd: 0 };
      return res
        .status(402)
        .set('Payment-Required', paymentRequired)
        .json({
          error: 'INVALID_PAYMENT_TOKEN',
          message: 'Test tokens not allowed in production',
          price: `$${price.toFixed(2)} USDC (Base)`,
          paymentUri: `https://mercury402.uk/pay?endpoint=${endpointPath}&price=${price.toFixed(2)}`
        });
    }
    
    // PRODUCTION: Verify payment on-chain via Base RPC
    const paymentRequired = encodePaymentRequired(price, endpointPath, req.path, req.method);
    const customerId = req.headers['x-customer-id'] || req.ip || 'anon';
    
    if (!tokenMeta.tx_hash) {
      // Token parsed but no tx_hash found
      logPayment(endpointPath, 0, customerId, false, 'no_tx_hash_in_token');
      res.locals.paymentMeta = { verified: false, price_usd: 0 };
      return res.status(402).set('Payment-Required', paymentRequired).json({
        error: 'INVALID_PAYMENT_TOKEN',
        message: 'Token does not contain transaction hash',
        price: `$${price.toFixed(2)} USDC (Base)`
      });
    }
    
    // Verify transaction on-chain
    const verification = await verifyPaymentOnChain(
      tokenMeta.tx_hash, 
      price, 
      MERCHANT_WALLET
    );
    
    if (!verification.verified) {
      // Verification failed - log and reject
      logPayment(endpointPath, 0, customerId, false, verification.reason);
      res.locals.paymentMeta = { 
        wallet_address: tokenMeta.wallet_address,
        tx_hash: tokenMeta.tx_hash,
        verified: false, 
        price_usd: 0 
      };
      
      return res.status(402).set('Payment-Required', paymentRequired).json({
        error: 'PAYMENT_VERIFICATION_FAILED',
        message: `Transaction verification failed: ${verification.reason}`,
        price: `$${price.toFixed(2)} USDC (Base)`,
        tx_hash: tokenMeta.tx_hash
      });
    }
    
    // VERIFIED ✅ - Log successful payment and proceed
    logPayment(endpointPath, price, customerId, true, null);
    
    res.locals.paymentMeta = {
      wallet_address: tokenMeta.wallet_address,
      tx_hash: tokenMeta.tx_hash,
      wallet_source: tokenMeta.wallet_source,
      verified: true,
      price_usd: price,
      block_number: verification.block_number
    };
    
    return next();
  };
}

function preValidateTreasuryHistorical(req, res, next) {
  const { start_date, end_date } = req.body || {};

  if (!start_date || !end_date) {
    return res.status(400).json({
      error: { code: 'MISSING_PARAMS', message: 'start_date and end_date required (ISO format YYYY-MM-DD)' }
    });
  }

  const start = new Date(start_date);
  const end = new Date(end_date);
  const daysDiff = Math.floor((end - start) / (1000 * 60 * 60 * 24));

  if (daysDiff > 90) {
    return res.status(400).json({
      error: { code: 'RANGE_TOO_LARGE', message: 'Date range cannot exceed 90 days' }
    });
  }

  if (daysDiff < 0) {
    return res.status(400).json({
      error: { code: 'INVALID_RANGE', message: 'start_date must be before end_date' }
    });
  }

  next();
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
// ============================================
// MACRO SNAPSHOT — ALL MAJOR INDICATORS
// ============================================

app.get('/v1/macro/snapshot/all', require402Payment('/v1/macro/snapshot/all', getPrice('/v1/macro/snapshot/all')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' }
      });
    }

    const seriesConfig = [
      { id: 'GDP', key: 'gdp', label: 'GDP', unit: 'Billions of Dollars' },
      { id: 'UNRATE', key: 'unemployment_rate', label: 'Unemployment Rate', unit: 'Percent' },
      { id: 'CPIAUCSL', key: 'cpi', label: 'Consumer Price Index', unit: 'Index 1982-1984=100' },
      { id: 'FEDFUNDS', key: 'fed_funds_rate', label: 'Federal Funds Rate', unit: 'Percent' },
      { id: 'DGS10', key: 'yield_10y', label: '10-Year Treasury Yield', unit: 'Percent' },
      { id: 'DGS2', key: 'yield_2y', label: '2-Year Treasury Yield', unit: 'Percent' },
      { id: 'T10Y2Y', key: 'yield_spread_10y2y', label: '10Y-2Y Spread', unit: 'Percent' },
      { id: 'VIXCLS', key: 'vix', label: 'VIX', unit: 'Index' },
      { id: 'DTWEXBGS', key: 'dollar_index', label: 'Dollar Index', unit: 'Index' },
      { id: 'UMCSENT', key: 'consumer_sentiment', label: 'Consumer Sentiment', unit: 'Index 1966:Q1=100' }
    ];

    // Generate cache key
    const cacheKey = getCacheKey('macro:snapshot:all', {});
    const cached = getCached(cacheKey);
    
    if (cached && !cached.stale) {
      res.setHeader('X-Data-Age', cached.age.toString());
      res.locals.cacheHit = true;
      return res.json(cached.data);
    }

    // Fetch all series in parallel (with caching)
    cacheStats.misses++;
    const results = await Promise.all(
      seriesConfig.map(s => 
        fetchFredData(s.id, { sort_order: 'desc', limit: 1 })
          .catch(err => {
            console.error(`Failed to fetch ${s.id}:`, err.message);
            return { observations: [] };
          })
      )
    );

    const indicators = {};
    let snapshotDate = null;

    seriesConfig.forEach((series, idx) => {
      const result = results[idx];
      if (result.observations && result.observations.length > 0) {
        const obs = result.observations[0];
        if (obs.value && obs.value !== '.') {
          indicators[series.key] = {
            value: parseFloat(obs.value),
            date: obs.date,
            unit: series.unit
          };
          // Use most recent date as snapshot_date
          if (!snapshotDate || obs.date > snapshotDate) {
            snapshotDate = obs.date;
          }
        }
      }
    });

    if (Object.keys(indicators).length === 0) {
      return res.status(404).json({
        error: { code: 'NO_DATA', message: 'No indicators available' }
      });
    }

    const responseData = {
      snapshot_date: snapshotDate || new Date().toISOString().split('T')[0],
      source: 'FRED',
      indicators,
      deterministic: true
    };

    const provenance = generateProvenance(responseData, 'macro-snapshot', {});
    
    const response = {
      data: responseData,
      provenance
    };

    // Cache for 6 hours
    setCache(cacheKey, response, CACHE_TTL.FRED);

    res.setHeader('X-Mercury-Price', `$${getPrice('/v1/macro/snapshot/all').toFixed(2)}`);
    res.json(response);

  } catch (error) {
    console.error('Macro snapshot error:', error.message);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch macro snapshot' }
    });
  }
});

// ============================================
// TREASURY YIELD CURVE — HISTORICAL
// ============================================

app.post('/v1/treasury/yield-curve/historical', preValidateTreasuryHistorical, require402Payment('/v1/treasury/yield-curve/historical', getPrice('/v1/treasury/yield-curve/historical')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' }
      });
    }

    const { start_date, end_date } = req.body || {};

    // Generate cache key
    const cacheKey = getCacheKey('treasury:historical', { start_date, end_date });
    const cached = getCached(cacheKey);
    
    if (cached && !cached.stale) {
      res.setHeader('X-Data-Age', cached.age.toString());
      res.locals.cacheHit = true;
      return res.json(cached.data);
    }

    cacheStats.misses++;

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

    // Fetch all series for date range
    const seriesIds = Object.values(seriesMap);
    const results = await Promise.all(
      seriesIds.map(id => 
        fetchFredData(id, { observation_start: start_date, observation_end: end_date })
          .catch(err => {
            console.error(`Failed to fetch ${id}:`, err.message);
            return { observations: [] };
          })
      )
    );

    // Build daily snapshots
    const snapshotsByDate = {};

    Object.entries(seriesMap).forEach(([label, seriesId], index) => {
      const result = results[index];
      if (result.observations) {
        result.observations.forEach(obs => {
          if (obs.value && obs.value !== '.') {
            if (!snapshotsByDate[obs.date]) {
              snapshotsByDate[obs.date] = { record_date: obs.date, rates: {} };
            }
            snapshotsByDate[obs.date].rates[label] = parseFloat(obs.value);
          }
        });
      }
    });

    const snapshots = Object.values(snapshotsByDate).sort((a, b) => 
      a.record_date.localeCompare(b.record_date)
    );

    if (snapshots.length === 0) {
      return res.status(404).json({
        error: { code: 'NO_DATA', message: 'No yield curve data available for date range' }
      });
    }

    const responseData = {
      start_date,
      end_date,
      source: 'FRED (Federal Reserve Economic Data)',
      snapshots
    };

    const provenance = generateProvenance(responseData, 'treasury-historical', { start_date, end_date });

    const response = {
      data: responseData,
      provenance
    };

    // Cache for 6 hours
    setCache(cacheKey, response, CACHE_TTL.TREASURY);

    res.setHeader('X-Mercury-Price', `$${getPrice('/v1/treasury/yield-curve/historical').toFixed(2)}`);
    res.json(response);

  } catch (error) {
    console.error('Treasury historical error:', error.message);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch treasury historical data' }
    });
  }
});

// ============================================
// TREASURY AUCTION RESULTS — RECENT
// ============================================

app.get('/v1/treasury/auction-results/recent', require402Payment('/v1/treasury/auction-results/recent', getPrice('/v1/treasury/auction-results/recent')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' }
      });
    }

    // Generate cache key
    const cacheKey = getCacheKey('treasury:auction:recent', {});
    const cached = getCached(cacheKey);
    
    if (cached && !cached.stale) {
      res.setHeader('X-Data-Age', cached.age.toString());
      res.locals.cacheHit = true;
      return res.json(cached.data);
    }

    cacheStats.misses++;

    // Use HQM (High Quality Market Corporate Bond) yields as proxy
    const seriesConfig = [
      { id: 'HQMCB1YR', label: '1-Year', maturity: '1Y' },
      { id: 'HQMCB5YR', label: '5-Year', maturity: '5Y' },
      { id: 'HQMCB10YR', label: '10-Year', maturity: '10Y' },
      { id: 'HQMCB20YR', label: '20-Year', maturity: '20Y' },
      { id: 'HQMCB30YR', label: '30-Year', maturity: '30Y' }
    ];

    // Fetch last 10 observations for each series
    const results = await Promise.all(
      seriesConfig.map(s => 
        fetchFredData(s.id, { sort_order: 'desc', limit: 10 })
          .catch(err => {
            console.error(`Failed to fetch ${s.id}:`, err.message);
            return { observations: [] };
          })
      )
    );

    const auctions = [];

    seriesConfig.forEach((series, idx) => {
      const result = results[idx];
      if (result.observations && result.observations.length > 0) {
        const observations = result.observations
          .filter(obs => obs.value && obs.value !== '.')
          .map(obs => ({
            date: obs.date,
            yield: parseFloat(obs.value),
            maturity: series.maturity
          }));
        
        auctions.push({
          maturity: series.maturity,
          label: series.label,
          recent_yields: observations
        });
      }
    });

    if (auctions.length === 0) {
      return res.status(404).json({
        error: { code: 'NO_DATA', message: 'No auction data available' }
      });
    }

    const responseData = {
      source: 'FRED/HQM',
      note: 'Corporate bond yield proxy (High Quality Market rates)',
      auctions
    };

    const provenance = generateProvenance(responseData, 'treasury-auctions', {});

    const response = {
      data: responseData,
      provenance
    };

    // Cache for 6 hours
    setCache(cacheKey, response, CACHE_TTL.TREASURY);

    res.setHeader('X-Mercury-Price', `$${getPrice('/v1/treasury/auction-results/recent').toFixed(2)}`);
    res.json(response);

  } catch (error) {
    console.error('Treasury auction error:', error.message);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch auction data' }
    });
  }
});

// ============================================
// TREASURY TIPS RATES — CURRENT
// ============================================

app.get('/v1/treasury/tips-rates/current', require402Payment('/v1/treasury/tips-rates/current', getPrice('/v1/treasury/tips-rates/current')), async (req, res) => {
  try {
    if (!FRED_API_KEY) {
      return res.status(503).json({
        error: { code: 'SERVICE_UNAVAILABLE', message: 'FRED API key not configured' }
      });
    }

    // Generate cache key
    const cacheKey = getCacheKey('treasury:tips:current', {});
    const cached = getCached(cacheKey);
    
    if (cached && !cached.stale) {
      res.setHeader('X-Data-Age', cached.age.toString());
      res.locals.cacheHit = true;
      return res.json(cached.data);
    }

    cacheStats.misses++;

    // TIPS series from FRED
    const seriesMap = {
      '5_YEAR': 'DFII5',
      '7_YEAR': 'DFII7',
      '10_YEAR': 'DFII10',
      '20_YEAR': 'DFII20',
      '30_YEAR': 'DFII30'
    };

    // Fetch current rates (latest observation)
    const seriesIds = Object.values(seriesMap);
    const results = await Promise.all(
      seriesIds.map(id => 
        fetchFredData(id, { sort_order: 'desc', limit: 1 })
          .catch(err => {
            console.error(`Failed to fetch ${id}:`, err.message);
            return { observations: [] };
          })
      )
    );

    const rates = {};
    let recordDate = null;

    Object.entries(seriesMap).forEach(([label, seriesId], index) => {
      const result = results[index];
      if (result.observations && result.observations.length > 0) {
        const obs = result.observations[0];
        if (obs.value && obs.value !== '.') {
          rates[label] = parseFloat(obs.value);
          if (!recordDate || obs.date > recordDate) {
            recordDate = obs.date;
          }
        }
      }
    });

    if (Object.keys(rates).length === 0) {
      return res.status(404).json({
        error: { code: 'NO_DATA', message: 'No TIPS rates available' }
      });
    }

    const responseData = {
      record_date: recordDate || new Date().toISOString().split('T')[0],
      rates,
      source: 'FRED (Federal Reserve Economic Data)',
      note: 'Treasury Inflation-Protected Securities (TIPS) yields'
    };

    const provenance = generateProvenance(responseData, 'treasury-tips', {});

    const response = {
      data: responseData,
      provenance
    };

    // Cache for 6 hours
    setCache(cacheKey, response, CACHE_TTL.TREASURY);

    res.setHeader('X-Mercury-Price', `$${getPrice('/v1/treasury/tips-rates/current').toFixed(2)}`);
    res.json(response);

  } catch (error) {
    console.error('Treasury TIPS error:', error.message);
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch TIPS rates' }
    });
  }
});

// ============================================
// DISCOVERY & HEALTH
// ============================================

app.get('/.well-known/x402', (req, res) => {
  const { PRICING } = require('./pricing');
  
  // Build accepts array — one entry per endpoint for correct per-resource price display
  const ENDPOINT_DESCRIPTIONS = {
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

  const accepts = Object.entries(PRICING)
    .filter(([endpoint]) => endpoint !== 'default')
    .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]))
    .map(([endpoint, price]) => {
      const method = endpoint === '/v1/treasury/yield-curve/historical' ? 'POST' : 'GET';
      return {
        scheme: 'exact',
        method: method, // x402scan reads this for HTTP method
        network: 'eip155:8453', // Base mainnet
        amount: String(Math.floor(parseFloat(price) * 1000000)), // Convert to USDC units (6 decimals)
        payTo: MERCHANT_WALLET,
        maxTimeoutSeconds: 30,
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC on Base
        extra: {
          name: ENDPOINT_DESCRIPTIONS[endpoint] || endpoint,
          path: endpoint,
          method: method,
          price_usd: price
        }
      };
    });
  
  // Build resources array for x402scan v1 compatibility
  const BASE_URL = 'https://mercury402.uk';
  const resources = Object.keys(PRICING)
    .filter(endpoint => endpoint !== 'default')
    .sort((a, b) => parseFloat(PRICING[a]) - parseFloat(PRICING[b]))
    .map(endpoint => {
      // Use concrete URL for FRED endpoint (x402scan may skip path params)
      if (endpoint === '/v1/fred/{series_id}') {
        return `${BASE_URL}/v1/fred/UNRATE`;
      }
      return `${BASE_URL}${endpoint}`;
    });
  
  res.json({
    x402Version: 2,
    accepts: accepts,
    resources: resources, // v1 compatibility for x402scan
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
      },
      repository: {
        url: "https://github.com/dudman1/mercury402",
        type: "git"
      }
    }
  });
});

// ============================================
// AgentCash v1-compatible manifest
// ============================================

app.get('/.well-known/x402-agentcash', (req, res) => {
  const { PRICING } = require('./pricing');
  
  // Build resources array (v1 format) — flat list of full URLs
  const BASE_URL = 'https://mercury402.uk';
  const resources = Object.keys(PRICING)
    .filter(endpoint => endpoint !== 'default')
    .sort((a, b) => parseFloat(PRICING[a]) - parseFloat(PRICING[b]))
    .map(endpoint => {
      // Replace template path with literal example for FRED endpoint
      if (endpoint === '/v1/fred/{series_id}') {
        return `${BASE_URL}/v1/fred/UNRATE`;
      }
      return `${BASE_URL}${endpoint}`;
    });
  
  res.json({
    version: 1,
    resources: resources,
    mppResources: resources, // All endpoints require payment
    description: "Deterministic financial data (FRED, Treasury rates, macro indicators) with cryptographic provenance via x402 micropayments on Base.",
    instructions: `# Mercury402 API - Agent Usage Guide

## Overview

Mercury402 provides deterministic financial data via x402 micropayments (USDC on Base). All endpoints require payment via HTTP 402 + x402 protocol.

## Authentication

No API keys required. Payment flow:
1. Call endpoint without auth → receive 402 with Payment-Required header
2. Pay via x402 protocol (USDC on Base mainnet)
3. Retry with Bearer token → receive 200 + data

## Base URL

https://mercury402.uk

All endpoints are relative to this base URL.

## Agent Workflow

1. Use \`mcp__agentcash__discover_api_endpoints("https://mercury402.uk")\` to see available endpoints and pricing.
2. For POST/PUT/PATCH endpoints, call \`mcp__agentcash__check_endpoint_schema\` to confirm request schema before first fetch.
3. Execute with \`mcp__agentcash__fetch(url, method="GET")\`.

AgentCash handles x402 payment automatically. Payments settle on success only (non-2xx responses don't cost anything).

## Available Endpoints

### GET /v1/fred/{series_id}
**Price:** $0.01
**Description:** Fetch any FRED economic series by ID — accepts any valid FRED series_id as path parameter (800k+ series available)
**Common series_id examples:**
- UNRATE — Unemployment Rate
- DGS10 — 10-Year Treasury Constant Maturity Rate
- CPIAUCSL — Consumer Price Index for All Urban Consumers
- GDP — Gross Domestic Product
- FEDFUNDS — Federal Funds Effective Rate
- DGS2 — 2-Year Treasury Constant Maturity Rate

**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/fred/UNRATE", method="GET")\`
**Response:** JSON with series data, observations, and cryptographic signature

### GET /v1/treasury/auction-results/recent
**Price:** $0.02
**Description:** Recent U.S. Treasury auction results
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/treasury/auction-results/recent", method="GET")\`

### GET /v1/treasury/tips-rates/current
**Price:** $0.02
**Description:** Current TIPS rates (5, 7, 10, 20, 30-year)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/treasury/tips-rates/current", method="GET")\`

### GET /v1/treasury/yield-curve/daily-snapshot
**Price:** $0.02
**Description:** U.S. Treasury yield curve snapshot (11 maturities, FRED-sourced)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot", method="GET")\`
**Response:** Yields for 1M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, 7Y, 10Y, 20Y, 30Y

### POST /v1/treasury/yield-curve/historical
**Price:** $0.05
**Description:** Historical yield curve data (max 90-day range)
**JSON body:** \`start_date\` (YYYY-MM-DD), \`end_date\` (YYYY-MM-DD)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/treasury/yield-curve/historical", method="POST", body={"start_date":"2026-01-01","end_date":"2026-03-01"})\`

### GET /v1/macro/snapshot/all
**Price:** $0.05
**Description:** Complete macro snapshot (GDP, CPI, UNRATE, yields, VIX)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/macro/snapshot/all", method="GET")\`
**Response:** Multi-series bundle with provenance

### GET /v1/composite/inflation-tracker
**Price:** $0.40
**Description:** Inflation metrics bundle (CPI, PCE, Core CPI)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/composite/inflation-tracker", method="GET")\`

### GET /v1/composite/labor-market
**Price:** $0.40
**Description:** Labor market health (Unemployment, Jobless Claims, Nonfarm Payrolls)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/composite/labor-market", method="GET")\`

### GET /v1/composite/economic-dashboard
**Price:** $0.50
**Description:** Economic overview (GDP, CPI, Unemployment in one call)
**Example:** \`mcp__agentcash__fetch("https://mercury402.uk/v1/composite/economic-dashboard", method="GET")\`

## Data Provenance

All responses include cryptographic signatures for data verification:
- \`provenance.source\` — Data source (e.g., "Federal Reserve Economic Data (FRED)")
- \`provenance.source_url\` — Original data URL
- \`provenance.fetched_at\` — ISO 8601 timestamp
- \`provenance.signature\` — ECDSA signature over response data

## Response Format

All endpoints return JSON:
\`\`\`json
{
  "data": { /* endpoint-specific data */ },
  "provenance": {
    "source": "Federal Reserve Economic Data (FRED)",
    "source_url": "https://fred.stlouisfed.org/series/UNRATE",
    "fetched_at": "2026-03-11T18:53:00.000Z",
    "signature": "0x..."
  }
}
\`\`\`

## Error Handling

- **400 Bad Request** — Invalid parameters (e.g., missing series_id, invalid date range)
- **402 Payment Required** — Initial request; includes x402 payment challenge
- **404 Not Found** — Endpoint or series doesn't exist
- **500 Internal Server Error** — Server error (payment not settled)

Payments settle on success (2xx) only. Failed requests don't cost anything.

## Pricing Summary

| Endpoint | Price |
|----------|-------|
| /v1/fred/{series_id} | $0.01 |
| /v1/treasury/auction-results/recent | $0.02 |
| /v1/treasury/tips-rates/current | $0.02 |
| /v1/treasury/yield-curve/daily-snapshot | $0.02 |
| /v1/treasury/yield-curve/historical | $0.03 |
| /v1/macro/snapshot/all | $0.05 |
| /v1/composite/inflation-tracker | $0.40 |
| /v1/composite/labor-market | $0.40 |
| /v1/composite/economic-dashboard | $0.50 |

## Use Cases

- **Economic research:** Access 800k+ FRED series (GDP, inflation, employment, etc.)
- **Fixed income analysis:** Real-time Treasury yield curves and TIPS rates
- **Macro dashboards:** Bundle multiple indicators in single calls
- **Automated trading:** Deterministic data with cryptographic proof
- **Agent-to-agent payments:** No API keys, pay-per-call via USDC

## Network

- **Blockchain:** Base (eip155:8453)
- **Currency:** USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
- **Merchant wallet:** 0xF8d59270cBC746a7593D25b6569812eF1681C6D2

## Documentation

- Swagger UI: https://mercury402.uk/docs
- GitHub: https://github.com/dudman1/mercury402
- x402scan: https://x402scan.com/server/mercury402
`
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

    // Wallet tracking
    const unique_wallets = uniqueWallets.size; // Same as unique_buyers, renamed for clarity
    
    // Bridge verification rate (payments with wallet_source indicating verification)
    const bridgeVerifiedSources = ['bridge_verified', 'rpc_verified'];
    const bridgeVerifiedCount = entries.filter(e => 
      e.wallet_source && bridgeVerifiedSources.includes(e.wallet_source)
    ).length;
    const bridge_verified_pct = total_calls > 0
      ? parseFloat(((bridgeVerifiedCount / total_calls) * 100).toFixed(1))
      : 0;
    
    // Wallet source breakdown
    const walletSourceCounts = {};
    entries.forEach(e => {
      const source = e.wallet_source || 'none';
      walletSourceCounts[source] = (walletSourceCounts[source] || 0) + 1;
    });

    return {
      total_revenue_usd: parseFloat(total_revenue_usd.toFixed(2)),
      total_calls,
      unique_buyers, // Legacy field (IP-based from old implementation)
      unique_wallets, // New field (wallet_address-based)
      calls_last_24h,
      revenue_last_24h_usd: parseFloat(revenue_last_24h_usd.toFixed(2)),
      top_endpoints,
      verified_payment_rate_pct,
      bridge_verified_pct,
      wallet_source_breakdown: walletSourceCounts
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
// /metrics rate limiting + caching
const metricsRateLimit = new Map(); // IP -> [timestamps]
const METRICS_RATE_LIMIT = 60; // Max 60 requests per minute
const METRICS_RATE_WINDOW = 60 * 1000; // 1 minute in ms
const METRICS_CACHE_TTL = 60 * 1000; // 1 minute cache
let metricsCached = null;
let metricsCachedAt = 0;

app.get('/metrics', (req, res) => {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Rate limiting (60 req/min per IP)
  if (!metricsRateLimit.has(clientIP)) {
    metricsRateLimit.set(clientIP, []);
  }
  
  const timestamps = metricsRateLimit.get(clientIP);
  // Remove timestamps older than 1 minute
  const recentTimestamps = timestamps.filter(ts => now - ts < METRICS_RATE_WINDOW);
  
  if (recentTimestamps.length >= METRICS_RATE_LIMIT) {
    return res.status(429).json({
      error: 'rate_limited',
      retry_after_seconds: 60
    });
  }
  
  // Record this request
  recentTimestamps.push(now);
  metricsRateLimit.set(clientIP, recentTimestamps);
  
  // Check cache (refresh every 60 seconds)
  if (metricsCached && (now - metricsCachedAt) < METRICS_CACHE_TTL) {
    return res.json(metricsCached);
  }
  
  // Recompute metrics
  const metrics = getMetricsFromLog();
  const cacheMetrics = getCacheMetrics();
  
  const result = {
    ...metrics,
    ...cacheMetrics
  };
  
  // Update cache
  metricsCached = result;
  metricsCachedAt = now;
  
  res.json(result);
});

// Serve payment instructions page
app.get('/pay', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/pay.html'));
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
  version: '1.2.0',
  endpoints: {
    fred: {
      path: '/v1/fred/{series_id}',
      price: getPrice('/v1/fred/{series_id}'),
      description: 'Federal Reserve Economic Data (FRED) series',
      available: true
    },
    treasury: {
      path: '/v1/treasury/yield-curve/daily-snapshot',
      price: getPrice('/v1/treasury/yield-curve/daily-snapshot'),
      description: 'U.S. Treasury yield curve (11 maturities)',
      available: true
    },
    macroSnapshot: {
      path: '/v1/macro/snapshot/all',
      method: 'POST',
      price: getPrice('/v1/macro/snapshot/all'),
      description: 'Complete macro snapshot: GDP, UNRATE, CPI, FEDFUNDS, yields, VIX, dollar index, sentiment',
      available: true
    },
    treasuryHistorical: {
      path: '/v1/treasury/yield-curve/historical',
      method: 'POST',
      price: getPrice('/v1/treasury/yield-curve/historical'),
      description: 'Historical yield curve data (max 90-day range)',
      available: true
    },
    treasuryAuctions: {
      path: '/v1/treasury/auction-results/recent',
      method: 'POST',
      price: getPrice('/v1/treasury/auction-results/recent'),
      description: 'Recent auction results (HQM corporate bond yield proxy)',
      available: true
    },
    treasuryTIPS: {
      path: '/v1/treasury/tips-rates/current',
      method: 'POST',
      price: getPrice('/v1/treasury/tips-rates/current'),
      description: 'Current TIPS rates (5, 7, 10, 20, 30-year)',
      available: true
    },
    economicDashboard: {
      path: '/v1/composite/economic-dashboard',
      price: getPrice('/v1/composite/economic-dashboard'),
      description: 'Economic overview: GDP, CPI, Unemployment',
      available: true
    },
    inflationTracker: {
      path: '/v1/composite/inflation-tracker',
      price: getPrice('/v1/composite/inflation-tracker'),
      description: 'Inflation metrics: CPI, PCE, Core CPI',
      available: true
    },
    laborMarket: {
      path: '/v1/composite/labor-market',
      price: getPrice('/v1/composite/labor-market'),
      description: 'Labor market: Unemployment, Claims, Payrolls',
      available: true
    },
    discovery: {
      path: '/.well-known/x402',
      price: 0,
      description: 'x402 discovery document',
      available: true
    },
    health: {
      path: '/health',
      price: 0,
      description: 'Service health check',
      available: true
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
      <div class="price">$0.01<span>/call</span></div>
      <p>Any FRED macroeconomic series (GDP, CPI, UNRATE, 800k+)</p>
    </div>
    <div class="card">
      <h3>Treasury Yield Curve</h3>
      <div class="price">$0.02<span>/call</span></div>
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
  "price": "$0.01 USDC (Base)",
  "paymentUri": "https://mercury402.uk/pay?..."
}</code></pre>

  <h2>Step 2 — Pay and get a token</h2>
  <p>Visit the <code>paymentUri</code> for payment instructions. After paying, create your x402 token and retry the request.</p>

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
  <p>FRED series (<code>/v1/fred/{series_id}</code>) — <strong>$0.05</strong> (amount: 50000 &mu;USDC)<br>
  Treasury yield curve (<code>/v1/treasury/yield-curve/daily-snapshot</code>) — <strong>$0.05</strong> (amount: 50000 &mu;USDC)<br>
  Treasury yield curve historical (<code>/v1/treasury/yield-curve/historical</code>) — <strong>$0.05</strong> (amount: 50000 &mu;USDC)<br>
  Treasury auction results, TIPS rates (<code>/v1/treasury/auction-results/recent</code>, <code>/v1/treasury/tips-rates/current</code>) — <strong>$0.05</strong> each<br>
  Macro snapshot (<code>/v1/macro/snapshot/all</code>) — <strong>$0.05</strong> (amount: 50000 &mu;USDC)<br>
  Composite dashboards (economic, inflation, labor) — <strong>$0.40–$0.50</strong></p>

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

// Startup: ensure log directory exists
const logDir = path.dirname(ACCESS_LOG);
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  console.log(`✅ Log directory ready: ${logDir}`);
} catch (e) {
  console.error(`❌ Failed to create log directory: ${e.message}`);
  process.exit(1);
}

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
