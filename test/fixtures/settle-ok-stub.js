// Preloaded (node --require) after server-sandbox.js by tests that need the
// payment path to see a *successful* on-chain state without a chain. No-op
// unless MERCURY_TEST_STUB_OK is set.
//
// - ethers.JsonRpcProvider -> StubProvider: getTransactionReceipt answers from
//   an in-memory receipt map after a short delay (real RPC latency, so
//   check-then-act races in the server are reachable). getBlockNumber throws
//   so the server never adopts the stub as its shared provider.
// - ethers.Contract -> StubContract: transferWithAuthorization mints a receipt
//   for (from -> to, value) and returns a tx whose wait() resolves status 1.
// - MERCURY_TEST_SEED_TX='{"hash","from","to","value"}' pre-seeds one receipt:
//   a USDC transfer to the merchant that some *other* wallet already made.
if (!process.env.MERCURY_TEST_STUB_OK) return;

const crypto = require('node:crypto');
const { ethers } = require('ethers');

const USDC = process.env.USDC_CONTRACT_BASE;
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const receipts = new Map();

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

class StubProvider {
  async getBlockNumber() { throw new Error('settle-ok-stub: no chain'); }
  async getBalance() { return 0n; }
  async getTransactionReceipt(hash) {
    await new Promise((r) => setTimeout(r, 50));
    return receipts.get(String(hash).toLowerCase()) || null;
  }
}

class StubContract {
  async transferWithAuthorization(from, to, value) {
    const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
    receipts.set(hash, makeReceipt(hash, from, to, value));
    console.log(`SETTLED ${JSON.stringify({ hash, from, to, value: String(value) })}`);
    return { hash, wait: async () => ({ hash, status: 1 }) };
  }
}

Object.defineProperty(ethers, 'JsonRpcProvider', { value: StubProvider, configurable: true, enumerable: true });
Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
