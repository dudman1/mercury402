// Preloaded (node --require) after server-sandbox.js by tests that drive the
// x402 payment path. Replaces ethers.Contract so the first on-chain step the
// server takes for an authorization (the eth_call simulation, or a direct
// transferWithAuthorization) logs the call to stdout and then fails, instead
// of touching a chain. No-op unless MERCURY_TEST_STUB_SETTLE is set.
if (!process.env.MERCURY_TEST_STUB_SETTLE) return;

const { ethers } = require('ethers');

function recordAndFail(from, to, value, validAfter, validBefore, nonce) {
  console.log(`SETTLE_STUB ${JSON.stringify({ from, to, value: String(value), nonce })}`);
  throw new Error('SETTLE_STUB: on-chain settlement disabled in tests');
}

class StubContract {
  constructor() {
    const send = async (...args) => recordAndFail(...args);
    send.staticCall = async (...args) => recordAndFail(...args);
    this.transferWithAuthorization = send;
  }
}

Object.defineProperty(ethers, 'Contract', { value: StubContract, configurable: true, enumerable: true });
