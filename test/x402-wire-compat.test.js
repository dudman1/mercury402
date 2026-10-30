// Wire compatibility with x402 v2 validators (CDP's x402/validate, x402scan).
// Boots the real server in a sandboxed child process (no network, no .env,
// no on-chain calls) and probes every priced route unpaid:
// - the PAYMENT-REQUIRED header must be strict standard base64 (RFC 4648 §4,
//   padded) of JSON — CDP rejected the old unpadded base64url header;
// - every extensions.bazaar block must validate, the way facilitators check
//   it: info against the block's own schema (Ajv draft 2020-12, as
//   @x402/extensions does), info against the bazaar spec schema (vendored in
//   fixtures/x402-bazaar-spec-schema.json), and the spec-level invariants.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020').default;

const { getCatalog } = require('../src/catalog');
const SPEC_SCHEMA = require('./fixtures/x402-bazaar-spec-schema.json');

const MERCHANT = '0x1111111111111111111111111111111111111111';
const ENDPOINTS = getCatalog().endpoints;
const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

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
    path.join(__dirname, '..', 'src', 'server.js'),
  ], {
    // cwd = sandbox so dotenv never loads a real .env
    cwd: sandbox,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      MERCHANT_WALLET: MERCHANT,
      BASE_RPC_URL: 'http://127.0.0.1:1',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      MERCURY_TEST_VALID_FRED_IDS: 'UNRATE',
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

const concrete = (p) => p.replace('{series_id}', 'UNRATE');

async function probe(e) {
  const res = await fetch(base + concrete(e.path), {
    method: e.method,
    headers: e.method === 'POST' ? { 'content-type': 'application/json' } : {},
    body: e.method === 'POST' ? '{}' : undefined,
  });
  await res.arrayBuffer();
  return { status: res.status, header: res.headers.get('payment-required') };
}

function decodeStrict(header, where) {
  assert.match(header, STRICT_BASE64, `${where}: non-standard base64 alphabet`);
  assert.strictEqual(header.length % 4, 0, `${where}: length ${header.length} not a multiple of 4 (padding stripped?)`);
  const bytes = Buffer.from(header, 'base64');
  assert.strictEqual(bytes.toString('base64'), header, `${where}: base64 does not round-trip`);
  return JSON.parse(bytes.toString('utf8'));
}

// Port of validateDiscoveryExtensionSpec (coinbase/x402
// typescript/packages/extensions/src/bazaar/facilitator.ts @ 0e6e8c5).
function specInvariantErrors(bazaar) {
  const input = bazaar && bazaar.info && bazaar.info.input;
  if (!input || typeof input !== 'object') return ['missing info.input'];
  const errors = [];
  if (input.type !== 'http') errors.push(`info.input.type must be "http", got ${input.type}`);
  const query = ['GET', 'HEAD', 'DELETE'];
  const body = ['POST', 'PUT', 'PATCH'];
  if (input.method !== undefined && ![...query, ...body].includes(input.method)) errors.push(`bad method ${input.method}`);
  if (input.bodyType !== undefined) {
    if (!['json', 'form-data', 'text'].includes(input.bodyType)) errors.push(`bad bodyType ${input.bodyType}`);
    if (input.method !== undefined && !body.includes(input.method)) errors.push(`bodyType set on ${input.method}`);
  }
  return errors;
}

test('every priced route answers an unpaid probe with 402 and a strict standard-base64 JSON PAYMENT-REQUIRED header', async () => {
  assert.ok(ENDPOINTS.length > 70, `expected the full priced catalog, got ${ENDPOINTS.length}`);
  for (const e of ENDPOINTS) {
    const where = `${e.method} ${concrete(e.path)}`;
    const { status, header } = await probe(e);
    assert.strictEqual(status, 402, where);
    assert.ok(header, `${where}: PAYMENT-REQUIRED header missing`);
    const pr = decodeStrict(header, where);
    assert.strictEqual(pr.x402Version, 2, where);
    assert.ok(Array.isArray(pr.accepts) && pr.accepts.length > 0, where);
  }
});

test('every emitted bazaar extension validates against its own schema, the vendored spec schema, and the spec invariants', async () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const specValidate = ajv.compile(SPEC_SCHEMA);
  let withBazaar = 0;
  for (const e of ENDPOINTS) {
    const where = `${e.method} ${concrete(e.path)}`;
    const pr = decodeStrict((await probe(e)).header, where);
    const bazaar = pr.extensions && pr.extensions.bazaar;
    if (!bazaar) continue; // extending coverage to new-routes.js is a separate change
    withBazaar++;

    const own = ajv.compile(bazaar.schema);
    assert.ok(own(bazaar.info), `${where}: info fails its own schema: ${ajv.errorsText(own.errors)}`);
    assert.ok(specValidate(bazaar.info), `${where}: info fails the spec schema: ${ajv.errorsText(specValidate.errors)}`);
    assert.deepStrictEqual(specInvariantErrors(bazaar), [], where);
    assert.strictEqual(bazaar.info.input.method, e.method, `${where}: info.input.method`);
    assert.strictEqual(bazaar.info.input.pathParams, undefined, `${where}: pathParams must not be declared`);
    for (const [k, v] of Object.entries(bazaar.info.input.queryParams || {})) {
      assert.notStrictEqual(typeof v, 'object', `${where}: queryParams.${k} must be an example scalar`);
    }
  }
  assert.strictEqual(withBazaar, 9, 'the nine BAZAAR_SCHEMAS routes carry the extension');
});

test('the old object-valued queryParams shape is rejected by the same check (guards the test itself)', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  const specValidate = ajv.compile(SPEC_SCHEMA);
  const old = {
    input: { type: 'http', method: 'GET', pathParams: { series_id: { type: 'string', example: 'UNRATE' } }, queryParams: { limit: { type: 'integer', example: 5 } } },
    output: { type: 'json', example: {} },
  };
  assert.strictEqual(specValidate(old), false);
});
