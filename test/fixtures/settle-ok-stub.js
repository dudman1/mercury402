// Preloaded (node --require) after server-sandbox.js by tests that need the
// payment path to see on-chain state without a chain. No-op unless
// MERCURY_TEST_STUB_OK is set.
//
// - ethers.JsonRpcProvider -> StubProvider: getTransactionReceipt answers from
//   an in-memory receipt map after a short delay (real RPC latency, so
//   check-then-act races in the server are reachable). getBlockNumber throws
//   so the server never adopts the stub as its shared provider.
// - ethers.Contract -> StubContract: transferWithAuthorization behaves like an
//   ethers v6 contract method: `.staticCall(...)` simulates (logs SIMULATED),
//   a direct call broadcasts (logs SETTLED), mints a receipt for
//   (from -> to, value) and returns a tx whose wait() resolves that receipt.
//   Both revert, ethers-style (code CALL_EXCEPTION + USDC reason string),
//   for an empty wallet or a nonce already settled by this process.
//
// Env knobs:
//   MERCURY_TEST_SEED_TX='{"hash","from","to","value"}'  pre-seed one receipt
//   MERCURY_TEST_EMPTY_WALLETS=0xabc,0xdef   these payers revert "exceeds balance"
//   MERCURY_TEST_SETTLE_REVERT=1   simulation passes, the broadcast reverts
//   MERCURY_TEST_RECEIPT_MISSING=1 provider.getTransactionReceipt always null
//   MERCURY_TEST_WAIT_FAILS=1      tx.wait() throws a timeout instead of a receipt
if (!process.env.MERCURY_TEST_STUB_OK) return;

const crypto = require('node:crypto');
const { ethers } = require('ethers');

const USDC = process.env.USDC_CONTRACT_BASE;
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const EMPTY_WALLETS = new Set(String(process.env.MERCURY_TEST_EMPTY_WALLETS || '').toLowerCase().split(',').filter(Boolean));
const receipts = new Map();
const usedNonces = new Set();

function makeReceipt(hash, from, to, value) {
  return {
    hash,
    status: 1,
    blockNumber: 1,
    logs: [{
      address: USDC,
      topics: [TRANSFER_TOPIC, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(to, 32)],
      data: ethers.toBeHex(BigInt(value), 32),
    }],
  };
}

if (process.env.MERCURY_TEST_SEED_TX) {
  const s = JSON.parse(process.env.MERCURY_TEST_SEED_TX);
  receipts.set(s.hash.toLowerCase(), makeReceipt(s.hash, s.from, s.to, s.value));
}

function revert(reason) {
  const err = new Error(`execution reverted: "${reason}"`);
  err.code = 'CALL_EXCEPTION';
  err.reason = reason;
  return err;
}

function simulate(from, to, value, validAfter, validBefore, nonce) {
  const key = `${String(from).toLowerCase()}:${String(nonce).toLowerCase()}`;
  if (usedNonces.has(key)) throw revert('FiatTokenV2: authorization is used or canceled');
  if (EMPTY_WALLETS.has(String(from).toLowerCase())) throw revert('ERC20: transfer amount exceeds balance');
  return key;
}

class StubProvider {
  async getBlockNumber() { throw new Error('settle-ok-stub: no chain'); }
  async getBalance() { return 0n; }
  async getTransactionReceipt(hash) {
    await new Promise((r) => setTimeout(r, 50));
    if (process.env.MERCURY_TEST_RECEIPT_MISSING) return null;
    return receipts.get(String(hash).toLowerCase()) || null;
  }
}

class StubContract {
  constructor() {
    const send = async (from, to, value, validAfter, validBefore, nonce) => {
      const key = simulate(from, to, value, validAfter, validBefore, nonce);
      if (process.env.MERCURY_TEST_SETTLE_REVERT) throw revert('ERC20: transfer amount exceeds balance');
      const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
      const receipt = makeReceipt(hash, from, to, value);
      receipts.set(hash, receipt);
      usedNonces.add(key);
      console.log(`SETTLED ${JSON.stringify({ hash, from, to, value: String(value), nonce })}`);
      return {
        hash,
        wait: async () => {
          await new Promise((r) => setTimeout(r, 20));
          if (process.env.MERCURY_TEST_WAIT_FAILS) {
            const err = new Error('timeout waiting for receipt');
            err.code = 'TIMEOUT';
            throw err;
          }
          return receipt;
        },
      };
    };
    send.staticCall = async (from, to, value, validAfter, validBefore, nonce) => {
      await new Promise((r) => setTimeout(r, 20));
      simulate(from, to, value, validAfter, validBefore, nonce);
      console.log(`SIMULATED ${JSON.stringify({ from, to, value: String(value), nonce })}`);
    };
    this.transferWithAuthorization = send;
  }
}

Object.defineProperty(ethers, 'JsonRpcProvider', { value: StubProvider, configurable: true, enumerable: true });
Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
