// Preloaded (node --require) after server-sandbox.js by tests that drive the
// x402 payment path. Replaces ethers.Contract so the settlement step logs the
// transferWithAuthorization call to stdout and then fails, instead of sending
// a transaction. No-op unless MERCURY_TEST_STUB_SETTLE is set.
if (!process.env.MERCURY_TEST_STUB_SETTLE) return;

const { ethers } = require('ethers');

class StubContract {
  async transferWithAuthorization(from, to, value, validAfter, validBefore, nonce) {
    console.log(`SETTLE_STUB ${JSON.stringify({ from, to, value: String(value), nonce })}`);
    throw new Error('SETTLE_STUB: on-chain settlement disabled in tests');
  }
}

Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
