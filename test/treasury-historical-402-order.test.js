// POST /v1/treasury/yield-curve/historical: preValidateTreasuryHistorical runs
// before require402Payment, but only for requests that carry a payment. An
// unpaid probe must get the 402 challenge (x402 validators never saw one here:
// they got 400 MISSING_PARAMS); a paid request with bad dates must get a free
// 400 before any verify/settle. Boots the real server sandboxed with on-chain
// settlement stubbed (fixtures/settle-stub.js), so no network call is possible.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ethers } = require('ethers');

const MERCHANT = '0x1111111111111111111111111111111111111111';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ENDPOINT = '/v1/treasury/yield-curve/historical';
// Facilitator key for the sandboxed server: random, never funded, never used on-chain.
const FACILITATOR_KEY = ethers.Wallet.createRandom().privateKey;

let child;
let base;
let sandbox;
let output = '';

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

test.before(async () => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury402-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [
    '--require', path.join(__dirname, 'fixtures', 'server-sandbox.js'),
    '--require', path.join(__dirname, 'fixtures', 'settle-stub.js'),
    path.join(__dirname, '..', 'src', 'server.js'),
  ], {
    // cwd = sandbox so dotenv never loads a real .env
    cwd: sandbox,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      MERCHANT_WALLET: MERCHANT,
      SERVER_PRIVATE_KEY: FACILITATOR_KEY,
      USDC_CONTRACT_BASE: USDC,
      BASE_RPC_URL: 'http://127.0.0.1:1',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      MERCURY_TEST_STUB_SETTLE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000);
    child.stdout.on('data', (buf) => {
      output += buf;
      if (output.includes('Mercury x402 Service')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on('data', (buf) => { output += buf; });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited (${code}):\n${output}`));
    });
  });
});

test.after(() => {
  if (child) child.kill('SIGKILL');
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

async function post(body, headers = {}) {
  const res = await fetch(base + ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, paymentRequired: res.headers.get('payment-required'), body: await res.json() };
}

// Any non-empty value is a payment artifact to the gate; it never gets as far
// as decoding because validation answers first.
const ARTIFACT = Buffer.from(JSON.stringify({ x402Version: 2, payload: {} })).toString('base64');

test('unpaid POST with an empty body gets the 402 challenge, not 400', async () => {
  const r = await post({});
  assert.strictEqual(r.status, 402, JSON.stringify(r.body));
  assert.ok(r.paymentRequired, 'PAYMENT-REQUIRED header present');
});

test('unpaid POST with invalid dates still gets 402', async () => {
  const r = await post({ start_date: '2024-13-01', end_date: 'nope' });
  assert.strictEqual(r.status, 402, JSON.stringify(r.body));
});

for (const name of ['PAYMENT-SIGNATURE', 'X-PAYMENT']) {
  test(`${name} with no dates gets a free 400 MISSING_PARAMS before verify/settle`, async () => {
    const before = output.length;
    const r = await post({}, { [name]: ARTIFACT });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'MISSING_PARAMS');
    assert.strictEqual(r.paymentRequired, null);
    assert.doesNotMatch(output.slice(before), /SETTLE_STUB|SANDBOX_UPSTREAM_CALL/);
  });

  test(`${name} with a >90-day range gets 400 RANGE_TOO_LARGE`, async () => {
    const r = await post({ start_date: '2024-01-01', end_date: '2024-06-30' }, { [name]: ARTIFACT });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'RANGE_TOO_LARGE');
  });
}
