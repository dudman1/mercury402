// Preloaded (node --require) after server-sandbox.js by tests that need the
// payment path to see on-chain state without a chain. No-op unless
// MERCURY_TEST_STUB_OK is set.
//
// - ethers.JsonRpcProvider -> StubProvider, a small fake node:
//     getTransactionCount   the facilitator's pending transaction count
//     estimateGas           simulates the call (reverts like the contract)
//     getNetwork/getFeeData fixed values, so the real ethers.Wallet can
//                           populate and sign a real transaction
//     broadcastTransaction  takes the signed raw transaction, decodes it, and
//                           "mines" it: logs SETTLED, mints a receipt for
//                           (from -> to, value) under the transaction's real
//                           hash, and returns a tx whose wait() resolves it
//     getTransactionReceipt answers from the receipt map after a short delay
//   getBlockNumber throws so the server never adopts the stub as its shared
//   provider.
// - ethers.Contract -> StubContract: transferWithAuthorization has
//   `.staticCall(...)` (simulates, logs SIMULATED),
//   `.populateTransaction(...)` (encodes the real calldata), and a direct call
//   that populates and sends through the connected signer, as ethers does.
//   balanceOf answers from the balance table.
//   Simulation and gas estimation revert, ethers-style (code CALL_EXCEPTION +
//   USDC reason string), for an empty wallet or an authorization nonce already
//   settled by this process.
// - Facilitator account nonce: a broadcast whose nonce is already taken is
//   refused like a node refuses it ("replacement transaction underpriced"),
//   so two unserialized concurrent broadcasts collide. A broadcast whose
//   nonce is ahead of the pending count is accepted but never mined (logs
//   GAPPED), like a node queues it. SETTLED lines carry `facilitator_nonce`.
//
// Env knobs:
//   MERCURY_TEST_SEED_TX='{"hash","from","to","value"}'  pre-seed one receipt
//   MERCURY_TEST_EMPTY_WALLETS=0xabc,0xdef   these payers have balance 0
//   MERCURY_TEST_WALLET_BALANCES='{"0xabc":"150000"}'  USDC units per payer
//                                 (others: 1e12). Settling debits the balance.
//   MERCURY_TEST_SETTLE_REVERT=1   simulation passes, the settlement's gas
//                                 estimate reverts
//   MERCURY_TEST_RECEIPT_MISSING=1 provider.getTransactionReceipt always null
//   MERCURY_TEST_WAIT_FAILS=1      tx.wait() throws a timeout instead of a receipt
//   MERCURY_TEST_TX_REPLACED=1     the broadcast is accepted, then another
//                                 facilitator tx takes its nonce: tx.wait()
//                                 throws ethers' TRANSACTION_REPLACED carrying
//                                 the REPLACEMENT's status-1 receipt (which has
//                                 a matching payer -> merchant transfer). The
//                                 authorization itself is never settled.
//                                 Logs BROADCAST_REPLACED.
//   MERCURY_TEST_TX_REPRICED=1     the broadcast is accepted, then re-sent
//                                 with the same call at a higher fee:
//                                 tx.wait() throws TRANSACTION_REPLACED with
//                                 reason "repriced" and the replacement's
//                                 receipt. The authorization IS settled, by
//                                 the replacement. Logs BROADCAST_REPRICED.
//   MERCURY_TEST_RECEIPT_WRONG_PAYTO=1  the mined status-1 receipt's USDC
//                                 transfer goes to another address
//   MERCURY_TEST_DROP_FIRST_TX=1   the first broadcast is accepted and then
//                                 dropped: never mined, and the pending count
//                                 never includes it. Logs DROPPED.
//   MERCURY_TEST_FIRST_PREPARE_DELAY_MS=n  the first gas estimate answers
//                                 after n ms (an RPC call that hangs before
//                                 anything is sent). Logs PREPARE_HUNG.
//   MERCURY_TEST_FIRST_SUBMIT_DELAY_MS=n   the first broadcast reaches the
//                                 node after n ms (a submit that hangs, then
//                                 lands). Logs SUBMIT_HUNG.
//   MERCURY_TEST_PENDING_NONCE_LAG_MS=n  getTransactionCount answers with the
//                                 pending count as it was n ms ago (an RPC that
//                                 has not seen the last broadcast yet)
if (!process.env.MERCURY_TEST_STUB_OK) return;

const crypto = require('node:crypto');
const { ethers } = require('ethers');

const USDC = process.env.USDC_CONTRACT_BASE;
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const USDC_IFACE = new ethers.Interface([
  'function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)',
]);
const EMPTY_WALLETS = new Set(String(process.env.MERCURY_TEST_EMPTY_WALLETS || '').toLowerCase().split(',').filter(Boolean));
const BALANCES = new Map(Object.entries(JSON.parse(process.env.MERCURY_TEST_WALLET_BALANCES || '{}'))
  .map(([addr, units]) => [addr.toLowerCase(), BigInt(units)]));
const DEFAULT_BALANCE = 1000000000000n;
function balanceOf(addr) {
  const k = String(addr).toLowerCase();
  if (EMPTY_WALLETS.has(k)) return 0n;
  return BALANCES.has(k) ? BALANCES.get(k) : DEFAULT_BALANCE;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = new Map();
const usedNonces = new Set();
let firstPrepareDelayMs = Number(process.env.MERCURY_TEST_FIRST_PREPARE_DELAY_MS || 0);
let firstSubmitDelayMs = Number(process.env.MERCURY_TEST_FIRST_SUBMIT_DELAY_MS || 0);
let dropFirstTx = Boolean(process.env.MERCURY_TEST_DROP_FIRST_TX);

// Facilitator account nonce (pending transaction count) and its history, so a
// lagging RPC can be modelled.
const NONCE_LAG_MS = Number(process.env.MERCURY_TEST_PENDING_NONCE_LAG_MS || 0);
let facilitatorPending = 0;
const pendingHistory = [{ at: 0, value: 0 }];
async function readPendingNonce() {
  await sleep(50);
  const cutoff = Date.now() - NONCE_LAG_MS;
  let value = 0;
  for (const h of pendingHistory) if (h.at <= cutoff) value = h.value;
  return value;
}

function makeReceipt(hash, from, to, value, status = 1) {
  return {
    hash,
    status,
    blockNumber: 1,
    logs: status === 1 ? [{
      address: USDC,
      topics: [TRANSFER_TOPIC, ethers.zeroPadValue(from, 32), ethers.zeroPadValue(to, 32)],
      data: ethers.toBeHex(BigInt(value), 32),
    }] : [],
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

// transferWithAuthorization arguments out of raw calldata.
function decodeCall(data) {
  const [from, to, value, validAfter, validBefore, nonce] = USDC_IFACE.decodeFunctionData('transferWithAuthorization', data);
  return { from, to, value, validAfter, validBefore, nonce };
}

const neverMined = (hash) => ({
  hash,
  wait: async () => {
    await sleep(20);
    const err = new Error('timeout waiting for receipt');
    err.code = 'TIMEOUT';
    throw err;
  },
});

const replacedTx = (hash, reason, receipt) => ({
  hash,
  wait: async () => {
    await sleep(20);
    const err = new Error('transaction was replaced');
    err.code = 'TRANSACTION_REPLACED';
    err.reason = reason;
    err.cancelled = reason !== 'repriced';
    err.hash = receipt.hash;
    err.receipt = receipt;
    throw err;
  },
});

class StubProvider {
  async getBlockNumber() { throw new Error('settle-ok-stub: no chain'); }
  async getBalance() { return 0n; }
  async getTransactionCount() { return readPendingNonce(); }
  async getNetwork() { return ethers.Network.from(Number(process.env.CHAIN_ID || 8453)); }
  async getFeeData() { return new ethers.FeeData(null, 2000000n, 1000000n); }

  // Gas estimate for the settlement call: reverts like the contract would.
  async estimateGas(tx) {
    const call = decodeCall(tx.data);
    if (firstPrepareDelayMs > 0) {
      const delay = firstPrepareDelayMs;
      firstPrepareDelayMs = 0;
      console.log(`PREPARE_HUNG ${JSON.stringify({ from: call.from, nonce: call.nonce, delay_ms: delay })}`);
      await sleep(delay);
    }
    await sleep(10);
    simulate(call.from, call.to, call.value, call.validAfter, call.validBefore, call.nonce);
    if (process.env.MERCURY_TEST_SETTLE_REVERT) throw revert('ERC20: transfer amount exceeds balance');
    return 100000n;
  }

  // eth_sendRawTransaction.
  async broadcastTransaction(signedTx) {
    const parsed = ethers.Transaction.from(signedTx);
    const hash = parsed.hash;
    const facilitatorNonce = Number(parsed.nonce);
    const { from, to, value, validAfter, validBefore, nonce } = decodeCall(parsed.data);
    if (firstSubmitDelayMs > 0) {
      const delay = firstSubmitDelayMs;
      firstSubmitDelayMs = 0;
      console.log(`SUBMIT_HUNG ${JSON.stringify({ hash, from, nonce, delay_ms: delay })}`);
      await sleep(delay);
    }
    await sleep(10);

    if (facilitatorNonce < facilitatorPending) {
      const err = new Error('replacement transaction underpriced');
      err.code = 'REPLACEMENT_UNDERPRICED';
      throw err;
    }
    if (dropFirstTx) {
      // Accepted, then dropped: never mined, never part of the pending count.
      dropFirstTx = false;
      console.log(`DROPPED ${JSON.stringify({ hash, from, nonce, facilitator_nonce: facilitatorNonce })}`);
      return neverMined(hash);
    }
    if (facilitatorNonce > facilitatorPending) {
      // Queued behind a missing nonce: accepted, never mined.
      console.log(`GAPPED ${JSON.stringify({ hash, from, nonce, facilitator_nonce: facilitatorNonce, pending: facilitatorPending })}`);
      return neverMined(hash);
    }
    facilitatorPending = facilitatorNonce + 1;
    pendingHistory.push({ at: Date.now(), value: facilitatorPending });

    if (process.env.MERCURY_TEST_TX_REPLACED) {
      const replacement = `0x${crypto.randomBytes(32).toString('hex')}`;
      console.log(`BROADCAST_REPLACED ${JSON.stringify({ hash, replacement, from, nonce })}`);
      return replacedTx(hash, 'replaced', makeReceipt(replacement, from, to, value));
    }

    // Mined. The call itself can still revert on-chain (status 0).
    let key;
    try {
      key = simulate(from, to, value, validAfter, validBefore, nonce);
    } catch (_) {
      const failed = makeReceipt(hash, from, to, value, 0);
      receipts.set(hash, failed);
      console.log(`REVERTED_ONCHAIN ${JSON.stringify({ hash, from, nonce, facilitator_nonce: facilitatorNonce })}`);
      return {
        hash,
        wait: async () => {
          await sleep(20);
          const err = revert('transaction execution reverted');
          err.receipt = failed;
          throw err;
        },
      };
    }
    usedNonces.add(key);
    BALANCES.set(String(from).toLowerCase(), balanceOf(from) - BigInt(value));

    if (process.env.MERCURY_TEST_TX_REPRICED) {
      // The same call went through under a different transaction hash.
      const replacement = `0x${crypto.randomBytes(32).toString('hex')}`;
      receipts.set(replacement, makeReceipt(replacement, from, to, value));
      console.log(`BROADCAST_REPRICED ${JSON.stringify({ hash, replacement, from, nonce })}`);
      return replacedTx(hash, 'repriced', receipts.get(replacement));
    }

    const receipt = makeReceipt(hash, from, process.env.MERCURY_TEST_RECEIPT_WRONG_PAYTO ? '0x2222222222222222222222222222222222222222' : to, value);
    receipts.set(hash, receipt);
    console.log(`SETTLED ${JSON.stringify({ hash, from, to, value: String(value), nonce, facilitator_nonce: facilitatorNonce })}`);
    return {
      hash,
      wait: async () => {
        await sleep(20);
        if (process.env.MERCURY_TEST_WAIT_FAILS) {
          const err = new Error('timeout waiting for receipt');
          err.code = 'TIMEOUT';
          throw err;
        }
        return receipt;
      },
    };
  }

  async getTransactionReceipt(hash) {
    await sleep(50);
    if (process.env.MERCURY_TEST_RECEIPT_MISSING) return null;
    return receipts.get(String(hash).toLowerCase()) || null;
  }
}

class StubContract {
  constructor(address, abi, runner) {
    // A direct call is what ethers' Contract does: populate, then the
    // connected signer signs and broadcasts (reading the pending nonce itself
    // unless the caller passed one).
    const method = async (...args) => runner.sendTransaction(await method.populateTransaction(...args));
    method.staticCall = async (from, to, value, validAfter, validBefore, nonce) => {
      await sleep(20);
      simulate(from, to, value, validAfter, validBefore, nonce);
      console.log(`SIMULATED ${JSON.stringify({ from, to, value: String(value), nonce })}`);
    };
    method.populateTransaction = async (from, to, value, validAfter, validBefore, nonce, v, r, s, overrides = {}) => ({
      ...overrides,
      to: USDC,
      data: USDC_IFACE.encodeFunctionData('transferWithAuthorization', [from, to, value, validAfter, validBefore, nonce, v, r, s]),
    });
    this.transferWithAuthorization = method;
    this.balanceOf = async (addr) => {
      await sleep(20);
      return balanceOf(addr);
    };
  }
}

Object.defineProperty(ethers, 'JsonRpcProvider', { value: StubProvider, configurable: true, enumerable: true });
Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
