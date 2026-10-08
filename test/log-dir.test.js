// MERCURY402_LOG_DIR moves the ledgers (LEDGER/) and access log (LOGS/) that
// src/server.js used to hardcode under /Users/openclaw/.openclaw. Boots the real
// server WITHOUT the sandbox preload, so only the env var redirects the paths.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

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

test('unset MERCURY402_LOG_DIR keeps the production base dir', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.ok(src.includes("const LOG_BASE_DIR = process.env.MERCURY402_LOG_DIR || '/Users/openclaw/.openclaw';"));
  assert.ok(!/['"`]\/Users\/openclaw\/\.openclaw\//.test(src), 'a log path is still hardcoded');
});

test('MERCURY402_LOG_DIR redirects the redemption ledger and access log', async (t) => {
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mercury402-logdir-'));
  fs.mkdirSync(path.join(logDir, 'LEDGER'));
  fs.writeFileSync(
    path.join(logDir, 'LEDGER', 'mercury402-redemptions.jsonl'),
    JSON.stringify({ key: 'test-key', ts: Date.now(), endpoint: '/v1/test' }) + '\n',
  );
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
    // cwd = logDir so dotenv never loads a real .env
    cwd: logDir,
    env: {
      PATH: process.env.PATH,
      PORT: String(port),
      MERCHANT_WALLET: '0x1111111111111111111111111111111111111111',
      BASE_RPC_URL: 'http://127.0.0.1:1',
      MERCURY402_LOG_DIR: logDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => {
    child.kill('SIGKILL');
    fs.rmSync(logDir, { recursive: true, force: true });
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

  assert.match(output, /Loaded 1 prior payment redemptions/);
  assert.ok(output.includes(`Log directory ready: ${path.join(logDir, 'LOGS')}`), output);

  const res = await fetch(`http://127.0.0.1:${port}/v1/treasury/yield-curve/daily-snapshot`);
  assert.strictEqual(res.status, 402);
  const accessLog = path.join(logDir, 'LOGS', 'mercury402-access.jsonl');
  const entries = fs.readFileSync(accessLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(entries.some((e) => e.endpoint === '/v1/treasury/yield-curve/daily-snapshot' && e.status === 402), JSON.stringify(entries));
});
