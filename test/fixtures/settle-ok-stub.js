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
// - Facilitator account nonce: the stub keeps the facilitator's pending
//   transaction count. A broadcast uses the `{ nonce }` override when the
//   server passes one; otherwise it reads the pending count itself, with RPC
//   latency, the way ethers populates a transaction. A nonce that is already
//   taken is refused like a node refuses it ("replacement transaction
//   underpriced"), so two unserialized concurrent broadcasts collide.
//   SETTLED lines carry `facilitator_nonce`.
//
// Env knobs:
//   MERCURY_TEST_SEED_TX='{"hash","from","to","value"}'  pre-seed one receipt
//   MERCURY_TEST_EMPTY_WALLETS=0xabc,0xdef   these payers have balance 0
//   MERCURY_TEST_WALLET_BALANCES='{"0xabc":"150000"}'  USDC units per payer
//                                 (others: 1e12). Settling debits the balance.
//   MERCURY_TEST_SETTLE_REVERT=1   simulation passes, the broadcast reverts
//   MERCURY_TEST_RECEIPT_MISSING=1 provider.getTransactionReceipt always null
//   MERCURY_TEST_WAIT_FAILS=1      tx.wait() throws a timeout instead of a receipt
//   MERCURY_TEST_TX_REPLACED=1     the broadcast is accepted, then another
//                                 facilitator tx takes its nonce: tx.wait()
//                                 throws ethers' TRANSACTION_REPLACED carrying
//                                 the REPLACEMENT's status-1 receipt (which has
//                                 a matching payer -> merchant transfer). The
//                                 authorization itself is never settled.
//                                 Logs BROADCAST_REPLACED.
//   MERCURY_TEST_RECEIPT_WRONG_PAYTO=1  the mined status-1 receipt's USDC
//                                 transfer goes to another address
//   MERCURY_TEST_FIRST_SEND_DELAY_MS=n  the first broadcast only reaches the
//                                 node after n ms (an RPC submit that hangs);
//                                 later broadcasts are unaffected
//   MERCURY_TEST_PENDING_NONCE_LAG_MS=n  getTransactionCount answers with the
//                                 pending count as it was n ms ago (an RPC that
//                                 has not seen the last broadcast yet)
if (!process.env.MERCURY_TEST_STUB_OK) return;

const crypto = require('node:crypto');
const { ethers } = require('ethers');

const USDC = process.env.USDC_CONTRACT_BASE;
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const EMPTY_WALLETS = new Set(String(process.env.MERCURY_TEST_EMPTY_WALLETS || '').toLowerCase().split(',').filter(Boolean));
const BALANCES = new Map(Object.entries(JSON.parse(process.env.MERCURY_TEST_WALLET_BALANCES || '{}'))
  .map(([addr, units]) => [addr.toLowerCase(), BigInt(units)]));
const DEFAULT_BALANCE = 1000000000000n;
function balanceOf(addr) {
  const k = String(addr).toLowerCase();
  if (EMPTY_WALLETS.has(k)) return 0n;
  return BALANCES.has(k) ? BALANCES.get(k) : DEFAULT_BALANCE;
}
const receipts = new Map();
const usedNonces = new Set();
let firstSendDelayMs = Number(process.env.MERCURY_TEST_FIRST_SEND_DELAY_MS || 0);

// Facilitator account nonce (pending transaction count) and its history, so a
// lagging RPC can be modelled.
const NONCE_LAG_MS = Number(process.env.MERCURY_TEST_PENDING_NONCE_LAG_MS || 0);
let facilitatorPending = 0;
const pendingHistory = [{ at: 0, value: 0 }];
function takeFacilitatorNonce(nonce) {
  if (nonce < facilitatorPending) {
    const err = new Error('replacement transaction underpriced');
    err.code = 'REPLACEMENT_UNDERPRICED';
    throw err;
  }
  if (nonce > facilitatorPending) throw new Error(`settle-ok-stub: facilitator nonce gap (got ${nonce}, pending ${facilitatorPending})`);
  facilitatorPending = nonce + 1;
  pendingHistory.push({ at: Date.now(), value: facilitatorPending });
}
async function readPendingNonce() {
  await new Promise((r) => setTimeout(r, 50));
  const cutoff = Date.now() - NONCE_LAG_MS;
  let value = 0;
  for (const h of pendingHistory) if (h.at <= cutoff) value = h.value;
  return value;
}

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
  if (balanceOf(from) < BigInt(value)) throw revert('ERC20: transfer amount exceeds balance');
  return key;
}

class StubProvider {
  async getBlockNumber() { throw new Error('settle-ok-stub: no chain'); }
  async getBalance() { return 0n; }
  async getTransactionCount() { return readPendingNonce(); }
  async getTransactionReceipt(hash) {
    await new Promise((r) => setTimeout(r, 50));
    if (process.env.MERCURY_TEST_RECEIPT_MISSING) return null;
    return receipts.get(String(hash).toLowerCase()) || null;
  }
}

class StubContract {
  constructor() {
    const send = async (from, to, value, validAfter, validBefore, nonce, v, r, s, overrides) => {
      const key = simulate(from, to, value, validAfter, validBefore, nonce);
      if (process.env.MERCURY_TEST_SETTLE_REVERT) throw revert('ERC20: transfer amount exceeds balance');
      if (firstSendDelayMs > 0) {
        const delay = firstSendDelayMs;
        firstSendDelayMs = 0;
        console.log(`SEND_HUNG ${JSON.stringify({ from, nonce, delay_ms: delay })}`);
        await new Promise((r2) => setTimeout(r2, delay));
      }
      const facilitatorNonce = overrides && overrides.nonce !== undefined ? Number(overrides.nonce) : await readPendingNonce();
      await new Promise((r2) => setTimeout(r2, 20)); // gas estimate + submit
      takeFacilitatorNonce(facilitatorNonce);
      const hash = `0x${crypto.randomBytes(32).toString('hex')}`;
      if (process.env.MERCURY_TEST_TX_REPLACED) {
        const replacement = `0x${crypto.randomBytes(32).toString('hex')}`;
        console.log(`BROADCAST_REPLACED ${JSON.stringify({ hash, replacement, from, nonce })}`);
        return {
          hash,
          wait: async () => {
            await new Promise((r2) => setTimeout(r2, 20));
            const err = new Error('transaction was replaced');
            err.code = 'TRANSACTION_REPLACED';
            err.reason = 'replaced';
            err.cancelled = true;
            err.hash = replacement;
            err.receipt = makeReceipt(replacement, from, to, value);
            throw err;
          },
        };
      }
      const receipt = makeReceipt(hash, from, process.env.MERCURY_TEST_RECEIPT_WRONG_PAYTO ? '0x2222222222222222222222222222222222222222' : to, value);
      receipts.set(hash, receipt);
      usedNonces.add(key);
      BALANCES.set(String(from).toLowerCase(), balanceOf(from) - BigInt(value));
      console.log(`SETTLED ${JSON.stringify({ hash, from, to, value: String(value), nonce, facilitator_nonce: facilitatorNonce })}`);
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
    this.balanceOf = async (addr) => {
      await new Promise((r) => setTimeout(r, 20));
      return balanceOf(addr);
    };
  }
}

Object.defineProperty(ethers, 'JsonRpcProvider', { value: StubProvider, configurable: true, enumerable: true });
Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
