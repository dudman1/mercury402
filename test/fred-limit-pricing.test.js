// /v1/fred/:series_id has two documented price tiers: a single observation at
// the base price, and a multi-observation response (observation_start +
// observation_end) at 2x. `limit` used to be forwarded to FRED unbounded at the
// single-point price, so ?limit=100000 returned a whole series for $0.05.
//
// Pins: limit > 1 is priced as a multi-observation response; limit is bounded
// to the openapi maximum (1000) and anything else is a free 400 before the
// 402; the range and single-point prices are unchanged.
//
// Boots the real server in a sandboxed child process (fixtures/server-sandbox.js)
// with on-chain state faked by fixtures/settle-ok-stub.js. Never a real RPC.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ethers } = require('ethers');

const { getPrice } = require('../src/pricing');

const MERCHANT = '0x1111111111111111111111111111111111111111';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DOMAIN = { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC };
const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};
const FIXTURES = path.join(__dirname, 'fixtures');
const PAYER = ethers.Wallet.createRandom();
const BASE_UNITS = Math.floor(getPrice('/v1/fred/{series_id}') * 1000000); // single observation
const MULTI_UNITS = BASE_UNITS * 2;                                          // range / limit > 1

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function boot() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury402-test-'));
  const port = await freePort();
  let output = '';
  let exitCode = null;
  const child = spawn(process.execPath, [
    '--require', path.join(FIXTURES, 'server-sandbox.js'),
    '--require', path.join(FIXTURES, 'settle-ok-stub.js'),
    path.join(__dirname, '..', 'src', 'server.js'),
  ], {
    cwd: sandbox, // dotenv never loads a real .env
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      MERCHANT_WALLET: MERCHANT,
      SERVER_PRIVATE_KEY: ethers.Wallet.createRandom().privateKey, // random, never funded
      USDC_CONTRACT_BASE: USDC,
      BASE_RPC_URL: 'http://127.0.0.1:1',
      FRED_API_KEY: 'test-fred-key',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      MERCURY_TEST_STUB_OK: '1',
      MERCURY_TEST_VALID_FRED_IDS: 'UNRATE',
      MERCURY_TEST_FRED_OBSERVATIONS: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => { output += buf; });
  child.stderr.on('data', (buf) => { output += buf; });
  child.once('exit', (code) => { exitCode = code; });
  const deadline = Date.now() + 15000;
  while (!output.includes('Mercury x402 Service') && exitCode === null) {
    if (Date.now() > deadline) throw new Error(`server neither started nor exited:\n${output}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.strictEqual(exitCode, null, output);
  return {
    base: `http://127.0.0.1:${port}`,
    mark: () => output.length,
    count: (re, m = 0) => (output.slice(m).match(re) || []).length,
    stop() {
      child.kill('SIGKILL');
      fs.rmSync(sandbox, { recursive: true, force: true });
    },
  };
}

async function payment(units) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: PAYER.address,
    to: MERCHANT,
    value: String(units),
    validAfter: String(now - 60),
    validBefore: String(now + 120),
    nonce: `0x${crypto.randomBytes(32).toString('hex')}`,
  };
  const signature = await PAYER.signTypedData(DOMAIN, TYPES, authorization);
  return Buffer.from(JSON.stringify({ x402Version: 2, accepted: { payTo: MERCHANT }, payload: { authorization, signature } })).toString('base64');
}

async function call(base, pathWithQuery, headers = {}) {
  const res = await fetch(base + pathWithQuery, { headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body, text };
}

// Price the 402 asks for, from the v1 body and the v2 header (must agree).
function askedUnits(res) {
  assert.strictEqual(res.status, 402, res.text);
  const v1 = Number(res.body.accepts[0].maxAmountRequired);
  const v2Header = res.headers.get('payment-required').replace(/-/g, '+').replace(/_/g, '/');
  const v2 = Number(JSON.parse(Buffer.from(v2Header, 'base64').toString('utf8')).accepts[0].amount);
  assert.strictEqual(v2, v1, 'v1 body and v2 header disagree on the price');
  return v1;
}

const settle = () => new Promise((r) => setTimeout(r, 150));

test('FRED limit pricing', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  await t.test('single-point request is unchanged: base price', async () => {
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE')), BASE_UNITS);
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?limit=1')), BASE_UNITS);
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?date=2026-01-01')), BASE_UNITS);
    // limit is ignored when a single date is given, so it does not change the price
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?date=2026-01-01&limit=500')), BASE_UNITS);
  });

  await t.test('range request is unchanged: 2x', async () => {
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?observation_start=2020-01-01&observation_end=2023-12-31')), MULTI_UNITS);
  });

  await t.test('limit > 1 without a range is priced as a multi-observation response (2x)', async () => {
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?limit=2')), MULTI_UNITS);
    assert.strictEqual(askedUnits(await call(server.base, '/v1/fred/UNRATE?limit=1000')), MULTI_UNITS);

    // paying the single-point price for limit=1000 is refused before any work
    const m = server.mark();
    const under = await call(server.base, '/v1/fred/UNRATE?limit=1000', { 'payment-signature': await payment(BASE_UNITS) });
    await settle();
    assert.strictEqual(under.status, 402);
    assert.strictEqual(under.headers.get('x-payment-error'), 'insufficient_value');
    assert.strictEqual(server.count(/^(SIMULATED|SETTLED|SANDBOX_UPSTREAM_CALL) /gm, m), 0);

    // paying the multi-observation price serves it and reports that price
    const m2 = server.mark();
    const paid = await call(server.base, '/v1/fred/UNRATE?limit=1000', { 'payment-signature': await payment(MULTI_UNITS) });
    await settle();
    assert.strictEqual(paid.status, 200, paid.text);
    assert.strictEqual(paid.headers.get('x-mercury-price'), `$${(getPrice('/v1/fred/{series_id}') * 2).toFixed(2)}`);
    assert.strictEqual(server.count(/^SETTLED /gm, m2), 1);
  });

  await t.test('out-of-range or malformed limit: free 400, no 402, no payment', async () => {
    for (const bad of ['100000', '1001', '0', '-1', 'abc', '1.5', '', '1&limit=2']) {
      const m = server.mark();
      const res = await call(server.base, `/v1/fred/UNRATE?limit=${bad}`, { 'payment-signature': await payment(MULTI_UNITS) });
      await settle();
      assert.strictEqual(res.status, 400, `limit=${bad}: ${res.status} ${res.text}`);
      assert.strictEqual(res.body.error.code, 'INVALID_LIMIT', `limit=${bad}`);
      assert.strictEqual(res.body.error.charged, false, `limit=${bad}`);
      assert.strictEqual(res.headers.get('payment-required'), null, `limit=${bad}: no challenge`);
      assert.strictEqual(server.count(/^(SIMULATED|SETTLED|SANDBOX_UPSTREAM_CALL) /gm, m), 0, `limit=${bad}: no payment work`);
    }
  });
});
