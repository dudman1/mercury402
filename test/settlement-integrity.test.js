// Settlement integrity: what the server accepts as proof that an
// authorization was settled, and how it picks the facilitator's account nonce.
//
// Pins:
//   - tx.wait() throwing ethers' TRANSACTION_REPLACED attaches the receipt of
//     the REPLACEMENT transaction. That receipt is not this request's payment:
//     402 tx_replaced, nothing charged, no data. (It used to be taken as the
//     settlement receipt and the paid body was served for an authorization
//     that never reached the chain.)
//   - a mined status-1 receipt without the USDC Transfer(payer -> merchant)
//     log releases no data: 502 charged:"unknown". (It used to be logged and
//     served anyway.)
//   - concurrent settlements never share a facilitator nonce: every broadcast
//     goes through one in-process queue with an explicit nonce. (Each
//     settlement used to read the pending nonce on its own, so two at once
//     picked the same one and the second was refused.)
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
const ENDPOINT = '/v1/fred/UNRATE';
const UNITS = Math.floor(getPrice('/v1/fred/{series_id}') * 1000000);

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
      MERCURY_TEST_VALID_FRED_IDS: 'UNRATE',
      MERCURY_TEST_FRED_OBSERVATIONS: '1',
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
    lines: (prefix) => output.split('\n').filter((l) => l.startsWith(`${prefix} `)).map((l) => JSON.parse(l.slice(prefix.length + 1))),
    revenueRows: () => readJsonl(path.join(sandbox, 'LEDGER', 'mercury402-revenue.jsonl')),
    redemptionRows: () => readJsonl(path.join(sandbox, 'LEDGER', 'mercury402-redemptions.jsonl')),
    stop() {
      child.kill('SIGKILL');
      fs.rmSync(sandbox, { recursive: true, force: true });
    },
  };
}

// Signed x402 v2 envelope from a fresh payer (stub balance: plenty).
async function payment(signer = ethers.Wallet.createRandom()) {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: signer.address,
    to: MERCHANT,
    value: String(UNITS),
    validAfter: String(now - 60),
    validBefore: String(now + 120),
    nonce: `0x${crypto.randomBytes(32).toString('hex')}`,
  };
  const signature = await signer.signTypedData(DOMAIN, TYPES, authorization);
  const header = Buffer.from(JSON.stringify({ x402Version: 2, accepted: { payTo: MERCHANT }, payload: { authorization, signature } })).toString('base64');
  return { header, from: signer.address, nonce: authorization.nonce };
}

async function paidCall(base, pay) {
  const res = await fetch(base + ENDPOINT, { headers: { 'payment-signature': pay.header } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { status: res.status, headers: res.headers, body, text };
}

const settle = () => new Promise((r) => setTimeout(r, 150));
const PAID_BODY_MARKER = 'Sandbox UNRATE'; // title of the stubbed FRED series: only in the paid body

test('replaced settlement tx: the replacement\'s receipt is not this payment — 402 tx_replaced, no data, nothing charged', async (t) => {
  const server = await boot({ MERCURY_TEST_TX_REPLACED: '1' });
  t.after(() => server.stop());

  const pay = await payment();
  const res = await paidCall(server.base, pay);
  await settle();

  const [broadcast] = server.lines('BROADCAST_REPLACED');
  assert.ok(broadcast, `the server should have broadcast:\n${server.output()}`);

  assert.strictEqual(res.status, 402, `replaced tx must not be served: ${res.status} ${res.text}`);
  assert.strictEqual(res.headers.get('x-payment-error'), 'tx_replaced');
  assert.strictEqual(res.headers.get('payment-response'), null, 'no settlement receipt header');
  assert.ok(!res.text.includes(PAID_BODY_MARKER), `paid body leaked: ${res.text}`);
  assert.strictEqual(res.body.data, undefined);

  // Nothing charged, nothing redeemed: the authorization is still unspent.
  const rows = server.revenueRows();
  assert.strictEqual(rows.filter((r) => r.verified || r.amount > 0).length, 0, JSON.stringify(rows));
  const row = rows.find((r) => r.rejection_reason === 'tx_replaced');
  assert.ok(row, JSON.stringify(rows));
  assert.strictEqual(row.customer, pay.from);
  assert.strictEqual(row.tx_hash, broadcast.hash);
  assert.deepStrictEqual(server.redemptionRows(), []);
});

test('mined status-1 receipt without the USDC transfer to the merchant: 502 charged:"unknown", no data', async (t) => {
  const server = await boot({ MERCURY_TEST_RECEIPT_WRONG_PAYTO: '1' });
  t.after(() => server.stop());

  const pay = await payment();
  const res = await paidCall(server.base, pay);
  await settle();

  const [settled] = server.lines('SETTLED');
  assert.ok(settled, `the server should have broadcast:\n${server.output()}`);

  assert.strictEqual(res.status, 502, `unverified transfer must not be served: ${res.status} ${res.text}`);
  assert.strictEqual(res.headers.get('x-payment-error'), 'transfer_log_mismatch');
  assert.strictEqual(res.headers.get('payment-required'), null, 'no fresh challenge after a mined tx');
  assert.strictEqual(res.headers.get('payment-response'), null);
  assert.strictEqual(res.body.error.code, 'SETTLEMENT_UNVERIFIED');
  assert.strictEqual(res.body.charged, 'unknown');
  assert.strictEqual(res.body.tx_hash, settled.hash);
  assert.ok(!res.text.includes(PAID_BODY_MARKER), `paid body leaked: ${res.text}`);

  const rows = server.revenueRows();
  assert.strictEqual(rows.filter((r) => r.verified || r.amount > 0).length, 0, JSON.stringify(rows));
  assert.ok(rows.find((r) => r.rejection_reason === 'transfer_log_mismatch' && r.tx_hash === settled.hash), JSON.stringify(rows));
});

test('concurrent settlements never share a facilitator nonce', async (t) => {
  await t.test('5 payers at once, then 3 more: all served, facilitator nonces 0..7 used once each', async () => {
    const server = await boot();
    t.after(() => server.stop());

    for (const [wave, expected] of [[5, [0, 1, 2, 3, 4]], [3, [0, 1, 2, 3, 4, 5, 6, 7]]]) {
      const pays = await Promise.all(Array.from({ length: wave }, () => payment()));
      const results = await Promise.all(pays.map((p) => paidCall(server.base, p)));
      await settle();
      assert.deepStrictEqual(results.map((r) => `${r.status} ${r.headers.get('x-payment-error') || ''}`.trim()), Array(wave).fill('200'),
        `every concurrent payment must settle:\n${server.output()}`);
      const nonces = server.lines('SETTLED').map((s) => s.facilitator_nonce).sort((a, b) => a - b);
      assert.deepStrictEqual(nonces, expected);
    }
    assert.strictEqual(server.revenueRows().filter((r) => r.verified).length, 8);
  });

  await t.test('RPC pending count lagging behind the last broadcast: still no reuse', async () => {
    const server = await boot({ MERCURY_TEST_PENDING_NONCE_LAG_MS: '2000' });
    t.after(() => server.stop());

    const pays = await Promise.all(Array.from({ length: 3 }, () => payment()));
    const results = await Promise.all(pays.map((p) => paidCall(server.base, p)));
    await settle();
    assert.deepStrictEqual(results.map((r) => `${r.status} ${r.headers.get('x-payment-error') || ''}`.trim()), Array(3).fill('200'),
      `every concurrent payment must settle:\n${server.output()}`);
    assert.deepStrictEqual(server.lines('SETTLED').map((s) => s.facilitator_nonce).sort((a, b) => a - b), [0, 1, 2]);
  });
});
