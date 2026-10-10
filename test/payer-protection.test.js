// Payer protection for the x402 PAYMENT-SIGNATURE path: a payer is charged if
// and only if they receive a 2xx with data, and every payment attempt is
// attributable in the access log and revenue ledger.
//
//   - pre-checks (payTo, value, validity window, local signature recovery,
//     eth_call simulation) reject cheaply before the handler runs
//   - the handler's response is intercepted: non-2xx is sent unchanged and
//     nothing is charged; 2xx settles first and only a mined receipt releases
//     the body
//   - once a tx is broadcast the client never sees a fresh 402 challenge
//   - every rejection carries X-Payment-Error and logs wallet, nonce, reason
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
const FRED_ROUTE = '/v1/fred/unemployment-rate'; // named FRED route: no pre-payment guard, one upstream call
const FIXTURES = path.join(__dirname, 'fixtures');
const PAYER = ethers.Wallet.createRandom();

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

async function boot(extraEnv = {}) {
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
      // Facilitator key for the sandboxed server: random, never funded, never used on-chain.
      SERVER_PRIVATE_KEY: ethers.Wallet.createRandom().privateKey,
      USDC_CONTRACT_BASE: USDC,
      BASE_RPC_URL: 'http://127.0.0.1:1',
      FRED_API_KEY: 'test-fred-key',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      MERCURY_TEST_STUB_OK: '1',
      ...extraEnv,
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
  const readJsonl = (file) => (fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);
  return {
    base: `http://127.0.0.1:${port}`,
    output: () => output,
    mark: () => output.length,
    since: (m) => output.slice(m),
    count: (re, m = 0) => (output.slice(m).match(re) || []).length,
    accessRows: () => readJsonl(path.join(sandbox, 'LOGS', 'mercury402-access.jsonl')),
    revenueRows: () => readJsonl(path.join(sandbox, 'LEDGER', 'mercury402-revenue.jsonl')),
    redemptionRows: () => readJsonl(path.join(sandbox, 'LEDGER', 'mercury402-redemptions.jsonl')),
    stop() {
      child.kill('SIGKILL');
      fs.rmSync(sandbox, { recursive: true, force: true });
    },
  };
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

// Signed x402 v2 envelope for `endpoint`. `overrides` patch the authorization
// before signing; `signer` can differ from authorization.from.
async function payment(endpoint, { overrides = {}, signer = PAYER, from = PAYER.address } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from,
    to: MERCHANT,
    value: String(Math.floor(getPrice(endpoint) * 1000000)),
    validAfter: String(now - 60),
    validBefore: String(now + 600),
    nonce: `0x${crypto.randomBytes(32).toString('hex')}`,
    ...overrides,
  };
  const signature = await signer.signTypedData(DOMAIN, TYPES, authorization);
  const header = b64({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: authorization.value, payTo: MERCHANT, asset: USDC },
    payload: { authorization, signature },
  });
  return { header, authorization };
}

async function call(base, endpoint, { headers = {}, method = 'GET', body } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + endpoint, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON body */ }
  return { status: res.status, headers: res.headers, body: json, text };
}

// Child stdout arrives asynchronously; give log lines a moment to land.
const settle = () => new Promise((r) => setTimeout(r, 150));

function assertRejected(server, res, row, { reason, from, nonce }) {
  assert.strictEqual(res.status, 402);
  assert.strictEqual(res.headers.get('x-payment-error'), reason);
  assert.ok(res.headers.get('payment-required'), 'challenge header present');
  assert.strictEqual(res.body.x402Version, 1, 'body is the standard v1 challenge');
  assert.strictEqual(row.verified, false);
  assert.strictEqual(row.price_usd, 0);
  assert.strictEqual(row.rejection_reason, reason);
  assert.strictEqual(row.wallet_source, 'x402_eip3009');
  assert.strictEqual(row.wallet_address, from);
  assert.strictEqual(row.nonce, nonce.toLowerCase());
  const revenue = server.revenueRows().at(-1);
  assert.strictEqual(revenue.amount, 0);
  assert.strictEqual(revenue.verified, false);
  assert.strictEqual(revenue.rejection_reason, reason);
  assert.strictEqual(revenue.customer, from);
}

// ---------------------------------------------------------------------------

test('default server: handler outcomes decide the charge; pre-checks reject with a reason', async (t) => {
  const server = await boot();
  t.after(() => server.stop());

  await t.test('invalid /v1/ai/ask body: 400, zero settlements, logged as handler_400_not_charged', async () => {
    const m = server.mark();
    const { header, authorization } = await payment('/v1/ai/ask');
    const res = await call(server.base, '/v1/ai/ask', { method: 'POST', headers: { 'payment-signature': header }, body: { question: 'hi' } });
    await settle();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error.code, 'BAD_REQUEST');
    assert.strictEqual(server.count(/^SIMULATED /gm, m), 1, 'authorization was simulated before the handler');
    assert.strictEqual(server.count(/^SETTLED /gm, m), 0, 'nothing may be settled for a 400');
    const row = server.accessRows().at(-1);
    assert.strictEqual(row.endpoint, '/v1/ai/ask');
    assert.strictEqual(row.status, 400);
    assert.strictEqual(row.verified, false);
    assert.strictEqual(row.price_usd, 0);
    assert.strictEqual(row.rejection_reason, 'handler_400_not_charged');
    assert.strictEqual(row.wallet_address, PAYER.address);
    assert.strictEqual(row.nonce, authorization.nonce);
    assert.deepStrictEqual(server.redemptionRows(), []);
  });

  await t.test('FRED handler 5xx (upstream down): sent as is, not charged', async () => {
    const m = server.mark();
    const { header } = await payment(FRED_ROUTE);
    const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
    await settle();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(server.count(/^SANDBOX_UPSTREAM_CALL /gm, m), 1, 'handler ran and hit upstream');
    assert.strictEqual(server.count(/^SETTLED /gm, m), 0);
    assert.strictEqual(res.headers.get('payment-response'), null);
    const row = server.accessRows().at(-1);
    assert.strictEqual(row.status, 500);
    assert.strictEqual(row.verified, false);
    assert.strictEqual(row.price_usd, 0);
    assert.strictEqual(row.rejection_reason, 'handler_500_not_charged');
    assert.strictEqual(row.wallet_address, PAYER.address);
    assert.deepStrictEqual(server.redemptionRows(), []);
  });

  await t.test('bad signature: 402 sig_invalid, nothing simulated', async () => {
    const m = server.mark();
    const { header, authorization } = await payment(FRED_ROUTE, { signer: ethers.Wallet.createRandom() });
    const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
    await settle();
    assertRejected(server, res, server.accessRows().at(-1), { reason: 'sig_invalid', from: PAYER.address, nonce: authorization.nonce });
    assert.strictEqual(server.count(/^(SIMULATED|SETTLED|SANDBOX_UPSTREAM_CALL) /gm, m), 0);
  });

  await t.test('expired authorization: 402 expired', async () => {
    const m = server.mark();
    const now = Math.floor(Date.now() / 1000);
    const { header, authorization } = await payment(FRED_ROUTE, { overrides: { validBefore: String(now + 10) } });
    const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
    await settle();
    assertRejected(server, res, server.accessRows().at(-1), { reason: 'expired', from: PAYER.address, nonce: authorization.nonce });
    assert.strictEqual(server.count(/^(SIMULATED|SETTLED|SANDBOX_UPSTREAM_CALL) /gm, m), 0);
  });

  await t.test('wrong payTo: 402 wrong_payto', async () => {
    const m = server.mark();
    const { header, authorization } = await payment(FRED_ROUTE, { overrides: { to: ethers.Wallet.createRandom().address } });
    const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
    await settle();
    assertRejected(server, res, server.accessRows().at(-1), { reason: 'wrong_payto', from: PAYER.address, nonce: authorization.nonce });
    assert.strictEqual(server.count(/^(SIMULATED|SETTLED|SANDBOX_UPSTREAM_CALL) /gm, m), 0);
  });

  await t.test('probe (no payment header): 402 with null wallet and no reason, unchanged', async () => {
    const res = await call(server.base, FRED_ROUTE);
    assert.strictEqual(res.status, 402);
    assert.strictEqual(res.headers.get('x-payment-error'), null);
    const row = server.accessRows().at(-1);
    assert.strictEqual(row.wallet_address, null);
    assert.strictEqual(row.wallet_source, null);
    assert.strictEqual(row.rejection_reason, null);
  });
});

test('empty wallet: rejected by simulation before the handler runs', async (t) => {
  const server = await boot({ MERCURY_TEST_EMPTY_WALLETS: PAYER.address });
  t.after(() => server.stop());

  const m = server.mark();
  const { header, authorization } = await payment(FRED_ROUTE);
  const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assertRejected(server, res, server.accessRows().at(-1), { reason: 'insufficient_balance', from: PAYER.address, nonce: authorization.nonce });
  assert.strictEqual(server.count(/^SANDBOX_UPSTREAM_CALL /gm, m), 0, 'handler must not reach upstream for an unfunded authorization');
  assert.strictEqual(server.count(/^SETTLED /gm, m), 0);
});

test('happy path: 200, exactly one settlement, payment + price headers, verified row', async (t) => {
  const server = await boot({ MERCURY_TEST_FRED_OBSERVATIONS: '1' });
  t.after(() => server.stop());

  const m = server.mark();
  const { header, authorization } = await payment(FRED_ROUTE);
  const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assert.strictEqual(res.status, 200, res.text);
  assert.strictEqual(res.body.data.series_id, 'UNRATE');
  assert.strictEqual(res.headers.get('x-mercury-price'), `$${getPrice(FRED_ROUTE).toFixed(2)}`);
  assert.strictEqual(server.count(/^SIMULATED /gm, m), 1);
  assert.strictEqual(server.count(/^SETTLED /gm, m), 1);
  const settled = JSON.parse(server.since(m).match(/^SETTLED (\{.*\})/m)[1]);
  const paymentResponse = JSON.parse(Buffer.from(res.headers.get('payment-response'), 'base64').toString('utf8'));
  assert.deepStrictEqual(paymentResponse, { success: true, transaction: settled.hash, network: 'eip155:8453', payer: PAYER.address });
  // settlement happened after the handler reached upstream
  assert.ok(server.since(m).indexOf('SANDBOX_UPSTREAM_CALL') < server.since(m).indexOf('SETTLED '));

  const row = server.accessRows().at(-1);
  assert.strictEqual(row.status, 200);
  assert.strictEqual(row.verified, true);
  assert.strictEqual(row.price_usd, getPrice(FRED_ROUTE));
  assert.strictEqual(row.wallet_address, PAYER.address);
  assert.strictEqual(row.tx_hash, settled.hash);
  assert.strictEqual(row.nonce, authorization.nonce);
  assert.strictEqual(row.wallet_source, 'x402_eip3009');
  assert.strictEqual(row.rejection_reason, null);
  const keys = server.redemptionRows().map((r) => r.key).sort();
  assert.deepStrictEqual(keys, [`sig:${PAYER.address.toLowerCase()}:${authorization.nonce}`, `tx:${settled.hash}`].sort());
  const revenue = server.revenueRows().at(-1);
  assert.strictEqual(revenue.verified, true);
  assert.strictEqual(revenue.amount, getPrice(FRED_ROUTE));

  // replaying the same authorization is refused before anything touches the chain
  const m2 = server.mark();
  const replay = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assertRejected(server, replay, server.accessRows().at(-1), { reason: 'already_redeemed', from: PAYER.address, nonce: authorization.nonce });
  assert.strictEqual(server.count(/^(SIMULATED|SETTLED) /gm, m2), 0);
});

test('mined receipt from tx.wait() is final: a failing receipt re-fetch cannot turn a charged payment into a 402', async (t) => {
  const server = await boot({ MERCURY_TEST_FRED_OBSERVATIONS: '1', MERCURY_TEST_RECEIPT_MISSING: '1' });
  t.after(() => server.stop());

  const m = server.mark();
  const { header, authorization } = await payment(FRED_ROUTE);
  const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assert.strictEqual(server.count(/^SETTLED /gm, m), 1, 'the payer was charged');
  assert.strictEqual(res.status, 200, `charged payer must get data, got ${res.status}: ${res.text}`);
  const settled = JSON.parse(server.since(m).match(/^SETTLED (\{.*\})/m)[1]);
  assert.ok(res.headers.get('payment-response'));
  const row = server.accessRows().at(-1);
  assert.strictEqual(row.verified, true);
  assert.strictEqual(row.tx_hash, settled.hash);
  assert.strictEqual(server.redemptionRows().length, 2);
  assert.strictEqual(server.revenueRows().filter((r) => r.verified === true).length, 1);
  assert.strictEqual(server.revenueRows().at(-1).customer, PAYER.address);
  assert.strictEqual(server.revenueRows().at(-1).rejection_reason, settled.hash);
  assert.ok(authorization.nonce);
});

test('broadcast but receipt unreadable: 502 charged:"unknown" with tx_hash, never a fresh 402', async (t) => {
  const server = await boot({ MERCURY_TEST_FRED_OBSERVATIONS: '1', MERCURY_TEST_RECEIPT_MISSING: '1', MERCURY_TEST_WAIT_FAILS: '1' });
  t.after(() => server.stop());

  const m = server.mark();
  const { header, authorization } = await payment(FRED_ROUTE);
  const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assert.strictEqual(server.count(/^SETTLED /gm, m), 1, 'a transaction was broadcast');
  const settled = JSON.parse(server.since(m).match(/^SETTLED (\{.*\})/m)[1]);
  assert.notStrictEqual(res.status, 402, 'no fresh challenge after a broadcast');
  assert.strictEqual(res.status, 502);
  assert.strictEqual(res.headers.get('payment-required'), null);
  assert.strictEqual(res.body.charged, 'unknown');
  assert.strictEqual(res.body.tx_hash, settled.hash);
  assert.strictEqual(res.body.error.code, 'SETTLEMENT_UNCONFIRMED');
  assert.strictEqual(res.headers.get('x-payment-error'), 'receipt_unknown');
  assert.strictEqual(res.body.data, undefined, 'no data without a confirmed settlement');
  const row = server.accessRows().at(-1);
  assert.strictEqual(row.status, 502);
  assert.strictEqual(row.verified, false);
  assert.strictEqual(row.rejection_reason, 'receipt_unknown');
  assert.strictEqual(row.tx_hash, settled.hash);
  assert.strictEqual(row.wallet_address, PAYER.address);
  assert.strictEqual(row.nonce, authorization.nonce);
  const revenue = server.revenueRows().at(-1);
  assert.strictEqual(revenue.amount, 0);
  assert.strictEqual(revenue.customer, PAYER.address);
  assert.match(revenue.rejection_reason, /^receipt_unknown:0x/);
});

test('settlement reverts after the handler succeeded: body discarded, 402 settle_reverted attributed to the payer', async (t) => {
  const server = await boot({ MERCURY_TEST_FRED_OBSERVATIONS: '1', MERCURY_TEST_SETTLE_REVERT: '1' });
  t.after(() => server.stop());

  const m = server.mark();
  const { header, authorization } = await payment(FRED_ROUTE);
  const res = await call(server.base, FRED_ROUTE, { headers: { 'payment-signature': header } });
  await settle();
  assert.strictEqual(server.count(/^SANDBOX_UPSTREAM_CALL /gm, m), 1, 'handler produced a 2xx first');
  assert.strictEqual(server.count(/^SETTLED /gm, m), 0, 'the revert means nothing was mined');
  assertRejected(server, res, server.accessRows().at(-1), { reason: 'settle_reverted', from: PAYER.address, nonce: authorization.nonce });
  assert.strictEqual(res.body.data, undefined, 'no data without a settled payment');
  assert.strictEqual(res.headers.get('payment-response'), null);
  assert.deepStrictEqual(server.redemptionRows(), []);
});
