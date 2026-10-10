// The unsigned "claim" bearer token (`Authorization: Bearer x402_<base64 {wallet,tx}>`)
// bound no payer to the request: any USDC transfer to the merchant could be
// redeemed by whoever learned its tx hash, the access log credited whichever
// wallet the client named, and the redeem-check / redeem-mark pair raced.
// This file pins its removal: the only Bearer token the server recognises is
// the dev-only `x402_test`, and that one can never be enabled in production.
//
// Boots the real server in a sandboxed child process (fixtures/server-sandbox.js)
// with on-chain state faked by fixtures/settle-ok-stub.js.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { ethers } = require('ethers');

const { getPrice } = require('../src/pricing');

const MERCHANT = '0x1111111111111111111111111111111111111111';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ENDPOINT = '/v1/treasury/tips-rates/current';
const PRICE_UNITS = String(Math.floor(getPrice(ENDPOINT) * 1000000));
const FIXTURES = path.join(__dirname, 'fixtures');

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

// Spawns src/server.js with the given extra env. Resolves once the server is
// listening, or once it exits (exitCode set), whichever comes first.
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
  const readJsonl = (file) => (fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []);
  return {
    base: `http://127.0.0.1:${port}`,
    output: () => output,
    exitCode: () => exitCode,
    accessRows: () => readJsonl(path.join(sandbox, 'LOGS', 'mercury402-access.jsonl')),
    redemptionRows: () => readJsonl(path.join(sandbox, 'LEDGER', 'mercury402-redemptions.jsonl')),
    stop() {
      child.kill('SIGKILL');
      fs.rmSync(sandbox, { recursive: true, force: true });
    },
  };
}

const claimToken = (wallet, tx) => `Bearer x402_${Buffer.from(JSON.stringify({ wallet, tx })).toString('base64')}`;

async function call(base, headers) {
  const res = await fetch(base + ENDPOINT, { headers });
  return { status: res.status, paymentRequired: res.headers.get('payment-required'), body: await res.json() };
}

test('claim tokens: a stranger\'s on-chain payment cannot be redeemed, even with ALLOW_LEGACY_BEARER=true in production', async (t) => {
  const stranger = ethers.Wallet.createRandom().address; // paid the merchant on-chain
  const claimant = ethers.Wallet.createRandom().address; // did not
  const seed = { hash: `0x${'ab'.repeat(32)}`, from: stranger, to: MERCHANT, value: PRICE_UNITS };
  const server = await boot({
    NODE_ENV: 'production',
    ALLOW_LEGACY_BEARER: 'true',
    MERCURY_TEST_SEED_TX: JSON.stringify(seed),
  });
  t.after(() => server.stop());
  assert.strictEqual(server.exitCode(), null, server.output());

  const unpaid = await call(server.base, {});
  assert.strictEqual(unpaid.status, 402);

  const res = await call(server.base, { authorization: claimToken(claimant, seed.hash) });
  assert.strictEqual(res.status, 402, 'claim token must get the unchanged 402 challenge');
  assert.deepStrictEqual(res.body, unpaid.body);
  assert.strictEqual(res.paymentRequired, unpaid.paymentRequired);

  const row = server.accessRows().at(-1);
  assert.strictEqual(row.endpoint, ENDPOINT);
  assert.strictEqual(row.verified, false, `claim must never verify: ${JSON.stringify(row)}`);
  assert.strictEqual(row.wallet_address, null, 'client-named wallet must not be credited');
  assert.strictEqual(row.price_usd, 0);
  assert.deepStrictEqual(server.redemptionRows(), [], 'no redemption may be recorded for a claim');
});

test('claim tokens: concurrent redemptions of one tx hash all get 402 (no check-then-act window)', async (t) => {
  const stranger = ethers.Wallet.createRandom().address;
  const claimant = ethers.Wallet.createRandom().address;
  const seed = { hash: `0x${'cd'.repeat(32)}`, from: stranger, to: MERCHANT, value: PRICE_UNITS };
  // NODE_ENV unset: the most permissive configuration the server can run in.
  const server = await boot({ MERCURY_TEST_SEED_TX: JSON.stringify(seed) });
  t.after(() => server.stop());
  assert.strictEqual(server.exitCode(), null, server.output());

  const headers = { authorization: claimToken(claimant, seed.hash) };
  const results = await Promise.all(Array.from({ length: 10 }, () => call(server.base, headers)));
  assert.deepStrictEqual(results.map((r) => r.status), Array(10).fill(402));

  const rows = server.accessRows().filter((r) => r.endpoint === ENDPOINT);
  assert.strictEqual(rows.length, 10);
  assert.strictEqual(rows.filter((r) => r.verified === true).length, 0, JSON.stringify(rows, null, 1));
  assert.deepStrictEqual(server.redemptionRows(), []);
});

test('test token: outside production ALLOW_TEST_TOKEN=true logs wallet_source "test_token", unverified, with no wallet or tx', async (t) => {
  const server = await boot({ ALLOW_TEST_TOKEN: 'true' });
  t.after(() => server.stop());
  assert.strictEqual(server.exitCode(), null, server.output());

  // The handler runs (and fails against the sandbox's disabled FRED), so the
  // status is whatever the handler answers; what is pinned is the access row.
  const res = await call(server.base, { authorization: 'Bearer x402_test' });
  assert.notStrictEqual(res.status, 402);

  const row = server.accessRows().at(-1);
  assert.strictEqual(row.endpoint, ENDPOINT);
  assert.strictEqual(row.wallet_source, 'test_token');
  assert.strictEqual(row.verified, false);
  assert.strictEqual(row.wallet_address, null);
  assert.strictEqual(row.tx_hash, null);
});

test('test token: NODE_ENV=production with ALLOW_TEST_TOKEN=true refuses to start', async (t) => {
  const server = await boot({ NODE_ENV: 'production', ALLOW_TEST_TOKEN: 'true' });
  t.after(() => server.stop());
  assert.strictEqual(server.exitCode(), 1, `expected startup refusal, got:\n${server.output()}`);
  assert.match(server.output(), /ALLOW_TEST_TOKEN/);
  assert.ok(!server.output().includes('Mercury x402 Service'), 'server must not listen');
});

test('test token: in production without the flag, Bearer x402_test gets the unchanged 402', async (t) => {
  const server = await boot({ NODE_ENV: 'production' });
  t.after(() => server.stop());
  assert.strictEqual(server.exitCode(), null, server.output());

  const unpaid = await call(server.base, {});
  const res = await call(server.base, { authorization: 'Bearer x402_test' });
  assert.strictEqual(res.status, 402);
  assert.deepStrictEqual(res.body, unpaid.body);
  const row = server.accessRows().at(-1);
  assert.strictEqual(row.verified, false);
  assert.strictEqual(row.price_usd, 0);
});
