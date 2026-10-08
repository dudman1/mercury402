// Contract test against the real API code: boots ../src/server.js in a sandboxed
// child process (no network, temp ledgers, no .env), pays a real 402 with
// mcp-server's client + payer, and checks that require402Payment() accepts the
// payment and would submit a valid transferWithAuthorization for our wallet.
// Settlement is stubbed (test/fixtures/settlement-stub.cjs): nothing is sent on-chain.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Signature, Wallet, verifyTypedData } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveRequest } from '../src/catalog.js';
import { MercuryClient } from '../src/client.js';
import { BASE_USDC, createEvmPayer } from '../src/payment.js';

const REPO = join(__dirname, '..', '..');
const MERCHANT = '0x1111111111111111111111111111111111111111';
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

// Needs the API's own dependencies (npm ci at the repo root).
const hasServerDeps = existsSync(join(REPO, 'node_modules', 'express'));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

describe.skipIf(!hasServerDeps)('payment payload vs src/server.js require402Payment()', () => {
  let child: ChildProcess;
  let sandbox: string;
  let settleLog: string;
  let apiUrl: string;
  let stderr = '';

  beforeAll(async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'mercury402-mcp-contract-'));
    settleLog = join(sandbox, 'settlements.jsonl');
    const port = await freePort();
    apiUrl = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [
        '--require', join(REPO, 'test', 'fixtures', 'server-sandbox.js'),
        '--require', join(__dirname, 'fixtures', 'settlement-stub.cjs'),
        join(REPO, 'src', 'server.js'),
      ],
      {
        cwd: sandbox, // dotenv never loads a real .env
        env: {
          PATH: process.env.PATH,
          PORT: String(port),
          MERCHANT_WALLET: MERCHANT,
          // Throwaway facilitator key so the server reaches the (stubbed) on-chain call.
          SERVER_PRIVATE_KEY: Wallet.createRandom().privateKey,
          USDC_CONTRACT_BASE: BASE_USDC,
          BASE_RPC_URL: 'http://127.0.0.1:1',
          FRED_API_KEY: 'test-fred-key',
          MERCURY_TEST_SANDBOX_DIR: sandbox,
          MERCURY_TEST_VALID_FRED_IDS: 'UNRATE',
          MERCURY_TEST_SETTLE_LOG: settleLog,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    child.stderr!.on('data', (b) => (stderr += b));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${stdout}${stderr}`)), 15000);
      child.stdout!.on('data', (b) => {
        stdout += b;
        if (stdout.includes('Mercury x402 Service')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`server exited (${code}):\n${stdout}${stderr}`));
      });
    });
  }, 20000);

  afterAll(() => {
    child?.kill('SIGKILL');
    if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  });

  const settlements = () =>
    existsSync(settleLog)
      ? readFileSync(settleLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { contract: string; args: string[] })
      : [];

  it.each([
    { label: 'named endpoint ($0.05)', path: '/v1/fred/unemployment-rate', params: {}, value: '50000' },
    { label: 'raw FRED range query (2x, $0.10)', path: '/v1/fred/UNRATE', params: { observation_start: '2025-01-01', observation_end: '2025-12-31' }, value: '100000' },
  ])('$label: server accepts the payment and would settle a valid authorization', async ({ path, params, value }) => {
    const wallet = Wallet.createRandom();
    const client = new MercuryClient({ apiUrl, payer: createEvmPayer(wallet.privateKey), maxPriceUsd: 1, timeoutMs: 10000 });
    const before = settlements().length;

    const result = await client.call(resolveRequest(path, params));

    // Settlement is stubbed to fail, so the server answers 402 after validation.
    expect(result.status).toBe('payment_required');
    const recorded = settlements();
    expect(recorded.length, `server rejected the payment before settlement:\n${stderr}`).toBe(before + 1);
    const { contract, args } = recorded[recorded.length - 1];
    const [from, to, val, validAfter, validBefore, nonce, v, r, s] = args;

    expect(contract).toBe(BASE_USDC);
    expect(from).toBe(wallet.address);
    expect(to.toLowerCase()).toBe(MERCHANT);
    expect(val).toBe(value);
    const signer = verifyTypedData(
      { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC },
      TYPES,
      { from, to, value: val, validAfter, validBefore, nonce },
      Signature.from({ v: Number(v), r, s }),
    );
    expect(signer).toBe(wallet.address);
    expect(stderr).not.toMatch(/Insufficient payment|Wrong payTo|Wrong authorization\.to|Missing authorization|No signature found/);
  });
});
