// Last-resort error handling (src/error-guards.js). A route that throws must
// get a fixed JSON 500 with no stack/env/path; the process guards log
// unhandled rejections and exit 1 on an uncaught exception so PM2 restarts.
const test = require('node:test');
const assert = require('node:assert');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

const { errorHandler } = require('../src/error-guards');

const GUARDS = path.join(__dirname, '..', 'src', 'error-guards.js');

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

function assertNoLeak(text) {
  assert.ok(!/\bat\s+\S+\s+\(|\.js:\d+|node_modules|\/Users\/|\/home\/|stack/i.test(text), `response leaks internals: ${text}`);
}

test('a route that throws yields 500 JSON {"error":"internal_error"} with no stack', async (t) => {
  const app = express();
  app.get('/sync', () => { throw new Error(`boom at ${__filename}`); });
  app.get('/async', (req, res, next) => { Promise.reject(new Error('async boom')).catch(next); });
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const origError = console.error;
  console.error = () => {};
  t.after(() => { console.error = origError; });
  for (const p of ['/sync', '/async']) {
    const res = await fetch(base + p);
    assert.strictEqual(res.status, 500, p);
    assert.match(res.headers.get('content-type'), /^application\/json/, p);
    const text = await res.text();
    assert.deepStrictEqual(JSON.parse(text), { error: 'internal_error' }, p);
    assertNoLeak(text);
  }
});

test('process guards: unhandledRejection is logged only, uncaughtException logs and exits 1', () => {
  const script = `
    require(${JSON.stringify(GUARDS)}).installProcessGuards();
    Promise.reject(new Error('rejected-on-purpose'));
    setTimeout(() => { console.log('still-running'); throw new Error('thrown-on-purpose'); }, 50);
  `;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stdout, /still-running/);
  assert.match(r.stderr, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] unhandledRejection: Error: rejected-on-purpose/m);
  assert.match(r.stderr, /^\[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] uncaughtException: Error: thrown-on-purpose/m);
});

test('the real server answers middleware errors with JSON (no stack) and leaves 404s alone', async (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury402-test-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures', 'server-sandbox.js'), path.join(__dirname, '..', 'src', 'server.js')], {
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
  t.after(() => {
    child.kill('SIGKILL');
    fs.rmSync(sandbox, { recursive: true, force: true });
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

  // express.json() rejects the body before any route runs; Express's default
  // handler used to answer with an HTML page containing the stack trace.
  const res = await fetch(`${base}/v1/treasury/yield-curve/historical`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"start_date":',
  });
  assert.strictEqual(res.status, 400);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const text = await res.text();
  assert.deepStrictEqual(JSON.parse(text), { error: 'invalid_request' });
  assertNoLeak(text);
  assert.match(output, /\] Unhandled error on POST \/v1\/treasury\/yield-curve\/historical:/);

  const missing = await fetch(`${base}/no-such-route`);
  assert.strictEqual(missing.status, 404);
});
