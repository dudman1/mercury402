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
//   - a settlement that hangs BEFORE anything is sent (populate/sign) is
//     bounded: 402 settle_timeout, and the next settlement goes through with
//     the same facilitator nonce.
//   - a settlement whose SUBMIT times out is an unknown outcome, because the
//     signed transaction may still be mined: 502 charged:"unknown" with the
//     already-known tx hash, no fresh challenge, and a
//     late_broadcast_after_timeout ledger row when the submit completes. (It
//     used to answer a fresh 402 challenge; a payer who signed a new
//     authorization was debited twice for one 200.)
//   - a retry of that authorization gets the same 502 and is never broadcast
//     again, before or after the first transaction lands: one debit at most.
//   - a tx repriced with the same call is 502 tx_repriced, charged:"unknown".
//   - a broadcast that was accepted and then dropped does not keep later
//     settlements on a gapped facilitator nonce: once the trust window since
//     the chain count last agreed has passed, the chain count is used again.
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

// Client-side cap so a server that never answers fails the test instead of
// hanging it.
async function paidCall(base, pay) {
  const res = await fetch(base + ENDPOINT, { headers: { 'payment-signature': pay.header }, signal: AbortSignal.timeout(20000) });
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

const NO_CHALLENGE = (res, what) => assert.strictEqual(res.headers.get('payment-required'), null, `${what}: must not carry a fresh Payment-Required challenge`);

async function waitFor(server, prefix, what, ms = 5000) {
  const deadline = Date.now() + ms;
  while (server.lines(prefix).length === 0) {
    if (Date.now() > deadline) throw new Error(`${what} never happened:\n${server.output()}`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return server.lines(prefix)[0];
}

test('settlement hangs before anything is sent: 402 settle_timeout, and the next settlement still proceeds', async (t) => {
  // The first gas estimate never answers within the test; timeout 400 ms.
  const server = await boot({ MERCURY_TEST_FIRST_PREPARE_DELAY_MS: '600000', SETTLE_BROADCAST_TIMEOUT_MS: '400' });
  t.after(() => server.stop());

  const stuck = await payment();
  const next = await payment();
  const started = Date.now();
  const stuckCall = paidCall(server.base, stuck);
  // Make sure the stuck one is first in the settlement queue.
  await waitFor(server, 'PREPARE_HUNG', 'first settlement');
  const nextCall = paidCall(server.base, next);
  const [stuckRes, nextRes] = await Promise.all([stuckCall, nextCall]);
  const elapsed = Date.now() - started;
  await settle();

  // Nothing was sent for the stuck settlement: a plain 402, no data.
  assert.strictEqual(stuckRes.status, 402, `${stuckRes.status} ${stuckRes.text}`);
  assert.strictEqual(stuckRes.headers.get('x-payment-error'), 'settle_timeout');
  assert.strictEqual(stuckRes.headers.get('payment-response'), null);
  assert.ok(!stuckRes.text.includes(PAID_BODY_MARKER), `paid body leaked: ${stuckRes.text}`);

  // The one queued behind it is served, with the facilitator nonce the stuck
  // settlement never used.
  assert.strictEqual(nextRes.status, 200, `the queue must move on: ${nextRes.status} ${nextRes.text}\n${server.output()}`);
  const settled = server.lines('SETTLED');
  assert.strictEqual(settled.length, 1);
  assert.strictEqual(settled[0].from, next.from);
  assert.strictEqual(settled[0].facilitator_nonce, 0);
  assert.ok(elapsed < 5000, `both answered within the timeout bound, took ${elapsed} ms`);

  const rows = server.revenueRows();
  assert.deepStrictEqual(rows.filter((r) => r.verified).map((r) => r.customer), [next.from]);
  const row = rows.find((r) => r.rejection_reason === 'settle_timeout');
  assert.ok(row, JSON.stringify(rows));
  assert.strictEqual(row.customer, stuck.from);
  assert.strictEqual(row.amount, 0);
  assert.deepStrictEqual(server.redemptionRows().map((r) => r.key).filter((k) => k.startsWith('sig:')), [`sig:${next.from.toLowerCase()}:${next.nonce}`]);
});

test('submit times out, then lands: 502 charged:"unknown" with the tx hash, no fresh challenge, late ledger row', async (t) => {
  // The first submit reaches the node after 900 ms; timeout 300 ms.
  const server = await boot({ MERCURY_TEST_FIRST_SUBMIT_DELAY_MS: '900', SETTLE_BROADCAST_TIMEOUT_MS: '300' });
  t.after(() => server.stop());

  const pay = await payment();
  const res = await paidCall(server.base, pay);
  const hung = server.lines('SUBMIT_HUNG')[0];
  assert.ok(hung, `the submit should have started:\n${server.output()}`);

  // Unknown outcome: the transaction may still be mined.
  assert.strictEqual(res.status, 502, `${res.status} ${res.text}`);
  assert.strictEqual(res.headers.get('x-payment-error'), 'submit_timeout');
  NO_CHALLENGE(res, 'submit timeout');
  assert.strictEqual(res.headers.get('payment-response'), null);
  assert.strictEqual(res.body.error.code, 'SETTLEMENT_UNCONFIRMED');
  assert.strictEqual(res.body.charged, 'unknown');
  assert.strictEqual(res.body.tx_hash, hung.hash, 'the response names the transaction that may be out');
  assert.ok(!res.text.includes(PAID_BODY_MARKER), `paid body leaked: ${res.text}`);

  // It lands afterwards, under exactly that hash.
  const late = await waitFor(server, 'SETTLED', 'late broadcast');
  await settle();
  assert.strictEqual(late.hash, hung.hash);
  const rows = server.revenueRows();
  assert.strictEqual(rows.filter((r) => r.verified || r.amount > 0).length, 0, JSON.stringify(rows));
  const timeoutRow = rows.find((r) => r.rejection_reason === 'submit_timeout');
  assert.ok(timeoutRow, JSON.stringify(rows));
  assert.strictEqual(timeoutRow.customer, pay.from);
  assert.strictEqual(timeoutRow.tx_hash, hung.hash);
  const lateRow = rows.find((r) => r.rejection_reason === 'late_broadcast_after_timeout');
  assert.ok(lateRow, JSON.stringify(rows));
  assert.strictEqual(lateRow.customer, pay.from);
  assert.strictEqual(lateRow.tx_hash, hung.hash);

  // The facilitator nonce it used is not handed out again.
  const after = await paidCall(server.base, await payment());
  await settle();
  assert.strictEqual(after.status, 200, `${after.status} ${after.text}\n${server.output()}`);
  assert.deepStrictEqual(server.lines('SETTLED').map((s) => s.facilitator_nonce), [0, 1]);
});

// The reviewer's probe as a client: after a failed paid call it retries, and
// like any x402 client it signs a NEW authorization whenever the response
// carries a Payment-Required challenge; otherwise it re-sends the same one.
async function retryLikeAClient(server, signer, firstPay, firstRes, attempts) {
  let pay = firstPay;
  let res = firstRes;
  const seen = [];
  for (let i = 0; i < attempts && res.status !== 200; i++) {
    if (res.headers.get('payment-required')) pay = await payment(signer);
    res = await paidCall(server.base, pay);
    seen.push(res);
  }
  return seen;
}

test('a retry after a submit timeout cannot produce a second debit', async (t) => {
  for (const [name, retryAfterLanding] of [['retry after the timed-out tx has landed', true], ['retry before it lands', false]]) {
    await t.test(name, async () => {
      // The first submit reaches the node after 900 ms; timeout 300 ms.
      const server = await boot({ MERCURY_TEST_FIRST_SUBMIT_DELAY_MS: '900', SETTLE_BROADCAST_TIMEOUT_MS: '300' });
      t.after(() => server.stop());

      const signer = ethers.Wallet.createRandom();
      const pay = await payment(signer);
      const first = await paidCall(server.base, pay);
      const hung = server.lines('SUBMIT_HUNG')[0];
      assert.ok(hung, `the submit should have started:\n${server.output()}`);

      if (retryAfterLanding) await new Promise((r) => setTimeout(r, 1200));
      const simulatedBefore = server.lines('SIMULATED').length;
      const retries = await retryLikeAClient(server, signer, pay, first, 3);
      await new Promise((r) => setTimeout(r, 1200)); // everything in flight has landed

      // One debit at most for this payer, and it is the timed-out transaction.
      const debits = server.lines('SETTLED').filter((s) => s.from === signer.address);
      assert.strictEqual(debits.length, 1, `payer debited ${debits.length} times for ${[first, ...retries].filter((r) => r.status === 200).length} paid response(s)`);
      assert.strictEqual(debits[0].hash, hung.hash);

      // The payer is never invited to sign again, every retry is told the same
      // thing, and nothing new is broadcast.
      NO_CHALLENGE(first, 'first answer');
      for (const res of retries) {
        assert.strictEqual(res.status, 502, `${res.status} ${res.text}`);
        assert.strictEqual(res.headers.get('x-payment-error'), 'settlement_in_doubt');
        NO_CHALLENGE(res, 'retry');
        assert.strictEqual(res.body.charged, 'unknown');
        assert.strictEqual(res.body.tx_hash, hung.hash);
        assert.ok(!res.text.includes(PAID_BODY_MARKER), `paid body leaked: ${res.text}`);
      }
      assert.strictEqual(server.lines('SIMULATED').length, simulatedBefore, 'a retry must not reach the chain');
    });
  }
});

test('tx repriced with the same call: 502 tx_repriced, charged:"unknown", no data, no fresh challenge', async (t) => {
  const server = await boot({ MERCURY_TEST_TX_REPRICED: '1' });
  t.after(() => server.stop());

  const pay = await payment();
  const res = await paidCall(server.base, pay);
  await settle();

  const [repriced] = server.lines('BROADCAST_REPRICED');
  assert.ok(repriced, `the server should have broadcast:\n${server.output()}`);

  assert.strictEqual(res.status, 502, `${res.status} ${res.text}`);
  assert.strictEqual(res.headers.get('x-payment-error'), 'tx_repriced');
  NO_CHALLENGE(res, 'repriced tx');
  assert.strictEqual(res.headers.get('payment-response'), null);
  assert.strictEqual(res.body.error.code, 'SETTLEMENT_UNCONFIRMED');
  assert.strictEqual(res.body.charged, 'unknown');
  assert.strictEqual(res.body.tx_hash, repriced.replacement, 'names the transaction that carried the call');
  assert.ok(!res.text.includes(PAID_BODY_MARKER), `paid body leaked: ${res.text}`);

  const rows = server.revenueRows();
  assert.strictEqual(rows.filter((r) => r.verified || r.amount > 0).length, 0, JSON.stringify(rows));
  assert.ok(rows.find((r) => r.rejection_reason === 'tx_repriced' && r.tx_hash === repriced.replacement), JSON.stringify(rows));
  assert.deepStrictEqual(server.redemptionRows(), []);
});

test('first broadcast accepted then dropped: later settlements stop using the gapped nonce once the trust window passes', async (t) => {
  // Trust window 2 s (default 60 s). The chain's pending count stays at 0
  // because the first transaction was dropped.
  const server = await boot({ MERCURY_TEST_DROP_FIRST_TX: '1', FACILITATOR_NONCE_TRUST_MS: '2000' });
  t.after(() => server.stop());

  const background = [paidCall(server.base, await payment())];
  await waitFor(server, 'DROPPED', 'first broadcast');
  const t0 = Date.now();
  const at = (ms) => new Promise((r) => setTimeout(r, Math.max(0, t0 + ms - Date.now())));

  // Settlements keep arriving inside the window: they go out on trust, one
  // nonce after the other, and are queued behind the gap.
  for (const ms of [400, 800, 1200]) {
    await at(ms);
    background.push(paidCall(server.base, await payment()));
  }

  // 2.4 s after the chain count last agreed (but only ~1 s after the previous
  // broadcast): the window has passed, so the chain count is used again and
  // the dropped nonce is refilled.
  await at(2400);
  const res = await paidCall(server.base, await payment());
  await settle();
  assert.strictEqual(res.status, 200, `still on a gapped nonce: ${res.status} ${res.text}\n${server.output()}`);
  const settled = server.lines('SETTLED');
  assert.strictEqual(settled.length, 1);
  assert.strictEqual(settled[0].facilitator_nonce, 0);
  assert.deepStrictEqual(server.lines('GAPPED').map((g) => g.facilitator_nonce), [1, 2, 3], 'the in-window settlements went out on trust');

  // The dropped and gapped ones end as unknown outcomes, never as data.
  const others = await Promise.all(background);
  for (const r of others) {
    assert.strictEqual(r.status, 502, `${r.status} ${r.text}`);
    assert.strictEqual(r.headers.get('x-payment-error'), 'receipt_unknown');
  }
});
