// Regression: the generic /v1/fred/:series_id route used to shadow every named
// FRED endpoint (/v1/fred/cpi-core -> 400 INVALID_SERIES, /v1/fred/gdp -> generic
// 402). Boots the real server in a sandboxed child process and checks the
// unpaid 402 for each named FRED endpoint in src/pricing.js.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { PRICING, getPrice } = require('../src/pricing');
const { FRED_SERIES } = require('../src/new-routes');

const MERCHANT = '0x1111111111111111111111111111111111111111';
const GENERIC_DESC = 'Federal Reserve Economic Data (FRED) series';
const NAMED_FRED_PATHS = Object.keys(PRICING).filter((p) => p.startsWith('/v1/fred/') && !p.includes('{'));

let child;
let base;
let sandbox;

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
  child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'server-sandbox.js'), path.join(__dirname, '..', 'src', 'server.js')], {
    // cwd = sandbox so dotenv never loads a real .env
    cwd: sandbox,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      MERCHANT_WALLET: MERCHANT,
      FRED_API_KEY: 'test-fred-key',
      BASE_RPC_URL: 'http://127.0.0.1:1',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      MERCURY_TEST_VALID_FRED_IDS: 'CPIAUCSL,GDP,UNRATE',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 15000);
    const onData = (buf) => {
      output += buf;
      if (output.includes('Mercury x402 Service')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
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

async function get(p) {
  const res = await fetch(base + p);
  const body = await res.json();
  const header = res.headers.get('payment-required');
  const v2 = header ? JSON.parse(Buffer.from(header, 'base64url').toString('utf8')) : null;
  return { status: res.status, body, v2 };
}

test('pricing lists named FRED endpoints and each has a named route definition', () => {
  assert.ok(NAMED_FRED_PATHS.length >= 50, `expected the named FRED set, got ${NAMED_FRED_PATHS.length}`);
  for (const p of NAMED_FRED_PATHS) assert.ok(FRED_SERIES[p], `${p} is priced but has no FRED_SERIES entry`);
});

test('every named FRED endpoint returns its own 402 descriptor, not the generic one', async () => {
  for (const p of NAMED_FRED_PATHS) {
    const { status, body, v2 } = await get(p);
    assert.strictEqual(status, 402, `${p}: expected 402, got ${status} ${JSON.stringify(body)}`);
    const accept = body.accepts[0];
    const amount = String(Math.floor(getPrice(p) * 1000000));
    assert.strictEqual(accept.description, FRED_SERIES[p].desc, `${p}: description`);
    assert.notStrictEqual(accept.description, GENERIC_DESC, `${p}: served by generic route`);
    assert.strictEqual(accept.maxAmountRequired, amount, `${p}: price`);
    assert.strictEqual(accept.resource, `https://api.mercury402.com${p}`, `${p}: resource`);
    assert.strictEqual(accept.payTo, MERCHANT, `${p}: payTo`);
    assert.strictEqual(accept.network, 'base', `${p}: network`);
    assert.strictEqual(accept.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', `${p}: asset`);
    // The generic route attaches the {series_id} bazaar schema; named routes have none.
    assert.strictEqual(body.extensions, undefined, `${p}: generic bazaar schema attached`);
    assert.strictEqual(v2.accepts[0].amount, amount, `${p}: v2 amount`);
    assert.strictEqual(v2.resource.url, `https://api.mercury402.com${p}`, `${p}: v2 resource`);
  }
});

test('raw FRED ids still go through the generic route', async () => {
  for (const id of ['CPIAUCSL', 'GDP']) {
    const { status, body, v2 } = await get(`/v1/fred/${id}`);
    assert.strictEqual(status, 402, `${id}: ${JSON.stringify(body)}`);
    assert.strictEqual(body.accepts[0].description, GENERIC_DESC, id);
    assert.strictEqual(body.accepts[0].maxAmountRequired, '50000', id);
    assert.ok(body.extensions && body.extensions.bazaar, `${id}: generic bazaar schema`);
    assert.strictEqual(v2.resource.url, `https://api.mercury402.com/v1/fred/${id}`);
  }
});

test('raw FRED range queries are still charged 2x', async () => {
  const { status, body } = await get('/v1/fred/CPIAUCSL?observation_start=2025-01-01&observation_end=2025-12-31');
  assert.strictEqual(status, 402);
  assert.strictEqual(body.accepts[0].maxAmountRequired, '100000');
});

test('invalid FRED ids still get a free 400', async () => {
  const res = await fetch(`${base}/v1/fred/NOTAREALSERIES`);
  const body = await res.json();
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.headers.get('payment-required'), null);
  assert.strictEqual(body.error.code, 'INVALID_SERIES');
  assert.strictEqual(body.error.charged, false);
});
