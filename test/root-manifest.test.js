// Regression + contract tests for the agent-facing discovery documents.
//
// History: express.static used to answer every GET / with public/index.html, so
// agents asking for JSON never got the manifest. The manifest also listed only 9
// of the 78 priced endpoints by hand. This file boots the real server in a
// sandboxed child process (see fixtures/server-sandbox.js) and checks that the
// served documents (GET /, /meta.json, /llms.txt, /openapi.json) agree with
// src/pricing.js — the payment source of truth behind /.well-known/x402.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const { PRICING } = require('../src/pricing');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const PRICED_PATHS = Object.keys(PRICING).filter((p) => p !== 'default');

// Concrete URLs for templated paths, and valid bodies for POST endpoints.
const CALL_AS = { '/v1/fred/{series_id}': '/v1/fred/UNRATE' };
const POST_BODIES = {
  '/v1/treasury/yield-curve/historical': { start_date: '2026-01-01', end_date: '2026-02-01' },
  '/v1/ai/ask': { question: 'What is the latest 10-year Treasury yield?' },
};

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
      MERCHANT_WALLET: '0x1111111111111111111111111111111111111111',
      BASE_RPC_URL: 'http://127.0.0.1:1',
      MERCURY_TEST_SANDBOX_DIR: sandbox,
      // The manifest points the FRED template at /v1/fred/UNRATE; the generic
      // route's pre-payment guard has to accept it or the 402 check below gets a 400.
      MERCURY_TEST_VALID_FRED_IDS: 'UNRATE',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
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

function getRoot(headers) {
  return fetch(`${base}/`, { headers });
}

async function assertManifest(res, label) {
  assert.strictEqual(res.status, 200, label);
  assert.match(res.headers.get('content-type'), /^application\/json/, label);
  assert.match(res.headers.get('vary') || '', /Accept/i, label);
  const body = await res.json();
  assert.strictEqual(body.name, 'Mercury x402', label);
  assert.ok(Array.isArray(body.endpoints) && body.endpoints.length > 0, label);
  assert.ok(body.featured && body.featured.fred, label);
}

async function assertLanding(res, label) {
  assert.strictEqual(res.status, 200, label);
  assert.match(res.headers.get('content-type'), /^text\/html/, label);
  assert.match(res.headers.get('vary') || '', /Accept/i, label);
  assert.strictEqual(await res.text(), INDEX_HTML, label);
}

test('GET / with Accept: application/json returns the JSON manifest', async () => {
  await assertManifest(await getRoot({ Accept: 'application/json' }), 'application/json');
});

test('GET / without text/html in Accept returns the JSON manifest', async () => {
  await assertManifest(await getRoot({ Accept: '*/*' }), '*/*');
  await assertManifest(await getRoot({ Accept: 'application/json, text/plain' }), 'json+plain');
  await assertManifest(await getRoot({}), 'fetch default');
});

test('GET / preferring JSON over HTML returns the JSON manifest', async () => {
  await assertManifest(await getRoot({ Accept: 'application/json, text/html;q=0.1' }), 'json preferred');
});

test('GET / from a browser returns the HTML landing page (public/index.html)', async () => {
  await assertLanding(await getRoot({ Accept: BROWSER_ACCEPT }), 'browser');
  await assertLanding(await getRoot({ Accept: 'text/html' }), 'text/html');
});

test('other static files are unaffected', async () => {
  const res = await fetch(`${base}/index.html`, { headers: { Accept: 'application/json' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(await res.text(), INDEX_HTML);
});

async function manifest() {
  const res = await getRoot({ Accept: 'application/json' });
  return res.json();
}

test('manifest advertises the MCP server, in sync with mcp-server/', async () => {
  const { mcp } = await manifest();
  const mcpPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp-server', 'package.json'), 'utf8'));
  const mcpSrc = fs.readFileSync(path.join(__dirname, '..', 'mcp-server', 'src', 'server.ts'), 'utf8');
  const registeredTools = [...mcpSrc.matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);

  assert.deepStrictEqual(mcp, {
    package: mcpPkg.name,
    install: `npx -y ${mcpPkg.name}`,
    npm: `https://www.npmjs.com/package/${mcpPkg.name}`,
    tools: registeredTools,
  });
  assert.deepStrictEqual(mcp.tools, ['list_endpoints', 'get_endpoint_data']);
});

test('manifest and /meta.json list every priced endpoint with the price from src/pricing.js', async () => {
  const body = await manifest();
  assert.strictEqual(body.count, PRICED_PATHS.length);
  assert.strictEqual(body.endpoints.length, PRICED_PATHS.length);
  for (const e of body.endpoints) {
    assert.ok(typeof e.path === 'string' && e.path.startsWith('/v1/'), JSON.stringify(e));
    assert.ok(['GET', 'POST'].includes(e.method), e.path);
    assert.strictEqual(e.price_usd, PRICING[e.path], e.path);
    assert.strictEqual(e.price_usdc_atomic, String(Math.floor(PRICING[e.path] * 1000000)), e.path);
    assert.ok(e.description.length > 5, e.path);
  }
  assert.deepStrictEqual(
    body.endpoints.map((e) => e.path).sort(),
    [...PRICED_PATHS].sort(),
  );

  const meta = await (await fetch(`${base}/meta.json`)).json();
  assert.deepStrictEqual(meta.endpoints, body.endpoints);
});

test('every paid manifest endpoint answers its declared method with a 402', async () => {
  const { endpoints } = await manifest();
  const paid = endpoints.filter((e) => e.price_usd > 0);
  assert.ok(paid.length > 0);
  for (const e of paid) {
    const target = CALL_AS[e.path] || e.path;
    const init = { method: e.method, headers: { Accept: 'application/json' } };
    if (e.method === 'POST') {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(POST_BODIES[e.path] || {});
    }
    const res = await fetch(base + target, init);
    assert.strictEqual(res.status, 402, `${e.method} ${target} -> ${res.status}`);
  }
});

test('GET /llms.txt lists every priced endpoint and the discovery documents', async () => {
  const res = await fetch(`${base}/llms.txt`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  const body = await res.text();
  assert.match(body, /^# Mercury402/);
  assert.match(body, new RegExp(`Paid endpoints: ${PRICED_PATHS.length}`));
  for (const p of PRICED_PATHS) assert.ok(body.includes(` ${p} — $`), `${p} missing from llms.txt`);
  assert.ok(body.includes('/.well-known/x402'));
  assert.ok(body.includes('/openapi.json'));
  assert.ok(body.includes('npx -y mercury402-mcp'));
});

test('GET /openapi.json is OpenAPI 3.1 and covers every priced endpoint at the same price', async () => {
  const res = await fetch(`${base}/openapi.json`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const spec = await res.json();

  assert.strictEqual(spec.openapi, '3.1.0');
  assert.ok(spec.paths, 'spec has paths');
  const { endpoints } = await manifest();
  for (const p of PRICED_PATHS) {
    const op = spec.paths[p];
    assert.ok(op, `${p} missing from /openapi.json`);
    const declared = op.post || op.get;
    assert.ok(declared, `${p} has no get/post operation`);
    const method = op.post ? 'POST' : 'GET';
    const manifestEntry = endpoints.find((e) => e.path === p);
    assert.strictEqual(method, manifestEntry.method, `${p} method`);
    const price = declared['x-payment-info'].price;
    if (price.amount !== undefined) {
      assert.strictEqual(Number(price.amount), PRICING[p], `${p} price`);
    } else {
      // Dynamic pricing (the FRED template charges 2x for date-range queries):
      // the declared minimum must still match the price in src/pricing.js.
      assert.strictEqual(price.mode, 'dynamic', `${p} price mode`);
      assert.strictEqual(Number(price.min), PRICING[p], `${p} min price`);
      assert.ok(Number(price.max) > Number(price.min), `${p} max price`);
    }
    // Human-readable copies of the price drifted separately from x-payment-info
    // after the 2026-03-24 $0.05 floor (prose said $0.10, header examples $0.01/$0.02).
    const prose = (declared.description || '').match(/\*\*Pric(?:e|ing):\*\*\s*\$([0-9.]+)/);
    if (prose) assert.strictEqual(Number(prose[1]), PRICING[p], `${p} description price`);
    for (const [code, r] of Object.entries(declared.responses || {})) {
      const example = r.headers && r.headers['X-Mercury-Price'] && r.headers['X-Mercury-Price'].schema.example;
      if (example) assert.strictEqual(Number(String(example).replace('$', '')), PRICING[p], `${p} ${code} X-Mercury-Price example`);
    }
  }
  // 3.1 uses JSON Schema 2020-12: `nullable` is not a keyword, type arrays are.
  assert.ok(!JSON.stringify(spec).includes('"nullable"'), 'spec still uses the 3.0 nullable keyword');
});
