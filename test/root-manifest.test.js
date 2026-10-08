// Regression: express.static answered every GET / with public/index.html, so
// agents asking for JSON never got the manifest. Boots the real server in a
// sandboxed child process (see fixtures/server-sandbox.js) and checks both
// sides of the content negotiation.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const BROWSER_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

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
  assert.ok(body.endpoints && body.endpoints.fred, label);
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
