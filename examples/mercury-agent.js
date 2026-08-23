#!/usr/bin/env node

/**
 * Mercury x402 Demo Agent
 * 
 * Fetches economic data via x402 micropayments
 * Demonstrates full payment flow: 402 → pay → retry
 */

const https = require('https');
const http = require('http');

const MERCURY_API = process.env.MERCURY_API || 'https://api.mercury402.com';
const PAYMENT_SIGNATURE = process.env.PAYMENT_SIGNATURE || null;

// Track spending
let totalSpent = 0;

function decodePaymentRequired(headerValue) {
  const normalized = headerValue + '='.repeat((4 - (headerValue.length % 4)) % 4);
  return JSON.parse(Buffer.from(normalized, 'base64url').toString('utf8'));
}

/**
 * Make HTTP request with optional x402 payment-signature
 */
function request(url, paymentSignature = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: {}
    };

    if (paymentSignature) {
      options.headers['payment-signature'] = paymentSignature;
    }

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: parsed
          });
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

/**
 * Handle x402 payment flow
 * 
 * Flow:
 * 1. GET endpoint → 402 Payment Required
 * 2. Parse Payment-Required header (base64url payment descriptor)
 * 3. Make USDC payment on Base to merchant wallet
 * 4. Receive a signed x402 payment payload
 * 5. Retry GET with payment-signature
 */
async function fetchWithPayment(endpoint) {
  const url = `${MERCURY_API}${endpoint}`;
  
  console.log(`\n→ Fetching ${endpoint}...`);

  // Step 1: Initial request (expect 402)
  let response = await request(url);

  if (response.status === 402) {
    console.log('  ← 402 Payment Required');

    // Step 2: Parse payment requirements
    const paymentHeader = response.headers['payment-required'];
    let paymentInfo = null;
    if (paymentHeader) {
      paymentInfo = decodePaymentRequired(paymentHeader);
      const accepted = paymentInfo.accepts?.[0] || {};
      console.log(`  💰 Price (μUSDC): ${accepted.maxAmountRequired || accepted.amount || 'unknown'}`);
      console.log(`  📍 Network: ${accepted.network || 'eip155:8453'}`);
      console.log(`  💵 Asset: ${accepted.asset || 'USDC'}`);
    }

    // Step 3: Get a signed x402 payment payload.
    let paymentSignature = PAYMENT_SIGNATURE;
    if (!paymentSignature) {
      console.log('  ⚠️  No PAYMENT_SIGNATURE provided');
      console.log('  ℹ️  Wire this demo to a real x402 wallet / processor that converts the Payment-Required descriptor into a signed payment payload');
      throw new Error('Missing PAYMENT_SIGNATURE for payment-signature flow');
    }

    // Step 4: Retry with payment-signature
    console.log('  ↻ Retrying with payment-signature...');
    response = await request(url, paymentSignature);

    if (response.status !== 200) {
      throw new Error(`Payment failed: ${response.status} ${JSON.stringify(response.data)}`);
    }

    // Track spending (extract from response metadata)
    const priceHeader = response.headers['x-mercury-price'];
    if (priceHeader) {
      const price = parseFloat(priceHeader.replace(/[^0-9.]/g, ''));
      totalSpent += price;
    }

    console.log('  ✓ Success');
  } else if (response.status === 200) {
    // Free endpoint or already paid
    console.log('  ✓ Success (no payment required)');
  } else if (response.status === 503) {
    console.log(`  ⚠️  Endpoint unavailable: ${response.data.message || 'coming soon'}`);
  } else {
    throw new Error(`Unexpected status: ${response.status}`);
  }

  return response.data;
}

/**
 * Format yield curve for display
 */
function formatYieldCurve(data) {
  const rates = data.data?.rates || {};
  const short = rates['3_MONTH'] || 'N/A';
  const mid = rates['2_YEAR'] || 'N/A';
  const long = rates['10_YEAR'] || 'N/A';
  const veryLong = rates['30_YEAR'] || 'N/A';

  return `
  📊 U.S. Treasury Yield Curve
  ────────────────────────────
  3-Month:   ${short}%
  2-Year:    ${mid}%
  10-Year:   ${long}%
  30-Year:   ${veryLong}%
  `;
}

/**
 * Format FRED data for display
 */
function formatFRED(data) {
  const seriesId = data.data?.series_id || 'UNKNOWN';
  const title = data.data?.title || seriesId;
  const obs = data.data?.observations?.[0];
  const value = obs?.value || 'N/A';
  const date = obs?.date || 'N/A';

  return `
  📈 ${title}
  ────────────────────────────
  Value:  ${value}
  Date:   ${date}
  Series: ${seriesId}
  `;
}

/**
 * Format macro snapshot for display
 */
function formatMacroSnapshot(data) {
  if (data.error === 'coming_soon') {
    return `
  🚧 Macro Snapshot
  ────────────────────────────
  Status: Coming Soon
  ${data.message || ''}
  `;
  }

  // Future implementation when endpoint is live
  return `
  📊 Macro Snapshot
  ────────────────────────────
  (Data would appear here)
  `;
}

/**
 * Main execution
 */
async function main() {
  console.log('╔═══════════════════════════════════════╗');
  console.log('║   Mercury x402 Daily Economic Brief  ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`API: ${MERCURY_API}`);
  console.log(`Mode: ${PAYMENT_SIGNATURE ? 'Injected payment-signature' : 'Awaiting payment-signature'}`);

  try {
    // Fetch Treasury yield curve
    const treasury = await fetchWithPayment('/v1/treasury/yield-curve/daily-snapshot');
    console.log(formatYieldCurve(treasury));

    // Fetch unemployment rate
    const unemployment = await fetchWithPayment('/v1/fred/UNRATE');
    console.log(formatFRED(unemployment));

    // Fetch macro snapshot (currently 503)
    const macro = await fetchWithPayment('/v1/macro/snapshot/all');
    console.log(formatMacroSnapshot(macro));

    // Summary
    console.log('\n╔═══════════════════════════════════════╗');
    console.log(`║   Total Spent: $${totalSpent.toFixed(2)}`.padEnd(40) + '║');
    console.log('╚═══════════════════════════════════════╝\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.log('\n💡 Tips:');
    console.log('  - Export PAYMENT_SIGNATURE with a real x402 payment payload');
    console.log('  - Check server is running: curl https://api.mercury402.com/health');
    console.log('  - View docs: https://api.mercury402.com/docs/api\n');
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { request, fetchWithPayment, decodePaymentRequired };

// ---
// *Last updated: 2026-04-20 22:53 ET | Updated by: Forge*
