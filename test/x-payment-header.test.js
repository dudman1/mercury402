// x402 v1 clients follow the v1 402 body and send their payment in X-PAYMENT;
// v2 clients send PAYMENT-SIGNATURE. Both carry the same base64 JSON envelope
// around the same EIP-3009 authorization, so both must reach the same
// verify/settle code. Boots the real server in a sandboxed child process with
// on-chain settlement stubbed (fixtures/settle-stub.js): reaching settlement
// prints a SETTLE_STUB line, then the stub fails and the server answers 402.
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
const ENDPOINT = '/v1/treasury/yield-curve/daily-snapshot';
const AMOUNT = String(Math.floor(getPrice(ENDPOINT) * 1000000));
const PAYER = ethers.Wallet.createRandom();
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

async function signedAuthorization() {
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: PAYER.address,
    to: MERCHANT,
    value: AMOUNT,
    validAfter: String(now - 60),
    validBefore: String(now + 600),
    nonce: `0x${crypto.randomBytes(32).toString('hex')}`,
  };
  const signature = await PAYER.signTypedData(
    { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
    {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    authorization,
  );
  return { authorization, signature };
}

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

async function v1Envelope() {
  return encode({ x402Version: 1, scheme: 'exact', network: 'base', payload: await signedAuthorization() });
}

async function v2Envelope() {
  const payload = await signedAuthorization();
  return encode({
    x402Version: 2,
    accepted: { scheme: 'exact', network: 'eip155:8453', amount: AMOUNT, payTo: MERCHANT, asset: USDC },
    payload,
  });
}

const nonceOf = (header) => JSON.parse(Buffer.from(header, 'base64').toString('utf8')).payload.authorization.nonce;

async function call(headers) {
  const res = await fetch(base + ENDPOINT, { headers });
  return { status: res.status, paymentRequired: res.headers.get('payment-required'), body: await res.json() };
}

// Log lines arrive on the child's pipes asynchronously; wait for one.
async function waitForOutput(re, from) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const m = output.slice(from).match(re);
    if (m) return m;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${re}:\n${output.slice(from)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const settledNonces = (from) => [...output.slice(from).matchAll(/SETTLE_STUB (\{.*\})/g)].map((m) => JSON.parse(m[1]).nonce);

test('a v1 envelope in X-PAYMENT reaches the same settlement branch as a v2 envelope in PAYMENT-SIGNATURE', async () => {
  const unpaid = await call({});
  assert.strictEqual(unpaid.status, 402);

  for (const [name, envelope] of [['x-payment', await v1Envelope()], ['payment-signature', await v2Envelope()]]) {
    const mark = output.length;
    const res = await call({ [name]: envelope });
    const m = await waitForOutput(/SETTLE_STUB (\{.*\})/, mark);
    assert.deepStrictEqual(JSON.parse(m[1]), {
      from: PAYER.address,
      to: MERCHANT,
      value: AMOUNT,
      nonce: nonceOf(envelope),
    }, name);
    await waitForOutput(/x402 payment-signature error: SETTLE_STUB/, mark);
    // The failed settlement answers with the unchanged 402 (body and header).
    assert.strictEqual(res.status, 402, name);
    assert.deepStrictEqual(res.body, unpaid.body, name);
    assert.strictEqual(res.paymentRequired, unpaid.paymentRequired, name);
  }
});

test('a malformed X-PAYMENT gets the same error and 402 as a malformed PAYMENT-SIGNATURE', async () => {
  const unpaid = await call({});
  const results = {};
  for (const name of ['payment-signature', 'x-payment']) {
    const mark = output.length;
    const res = await call({ [name]: 'not-a-payment' });
    const m = await waitForOutput(/x402 payment-signature error: (.*)/, mark);
    results[name] = { res, error: m[1] };
    assert.strictEqual(res.status, 402, name);
    assert.deepStrictEqual(res.body, unpaid.body, name);
    assert.strictEqual(res.paymentRequired, unpaid.paymentRequired, name);
    assert.deepStrictEqual(settledNonces(mark), [], name);
  }
  assert.strictEqual(results['x-payment'].error, results['payment-signature'].error);
});

test('PAYMENT-SIGNATURE wins when both headers are sent', async () => {
  // Valid PAYMENT-SIGNATURE + malformed X-PAYMENT: settles the PAYMENT-SIGNATURE authorization.
  let mark = output.length;
  const v2 = await v2Envelope();
  await call({ 'payment-signature': v2, 'x-payment': 'not-a-payment' });
  await waitForOutput(/x402 payment-signature error: SETTLE_STUB/, mark);
  assert.deepStrictEqual(settledNonces(mark), [nonceOf(v2)]);

  // Malformed PAYMENT-SIGNATURE + valid X-PAYMENT: X-PAYMENT is never read.
  mark = output.length;
  const res = await call({ 'payment-signature': 'not-a-payment', 'x-payment': await v1Envelope() });
  await waitForOutput(/x402 payment-signature error: (?!SETTLE_STUB)/, mark);
  assert.strictEqual(res.status, 402);
  assert.deepStrictEqual(settledNonces(mark), []);
});
