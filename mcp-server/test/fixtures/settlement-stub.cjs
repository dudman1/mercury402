// Preloaded (node --require) into a child process running ../src/server.js,
// after test/fixtures/server-sandbox.js. Swaps the `ethers` seen by the server's
// own modules for a copy whose network-facing classes never touch a chain:
//   - JsonRpcProvider: rejects every call (no RPC traffic).
//   - Contract: records the transferWithAuthorization() arguments the server
//     would simulate/submit on-chain to MERCURY_TEST_SETTLE_LOG, then throws,
//     so the request ends as an unsettled 402. No transaction is ever sent.
const SETTLE_LOG = process.env.MERCURY_TEST_SETTLE_LOG;
if (!SETTLE_LOG) return;

const fs = require('fs');
const path = require('path');
const Module = require('module');

const SERVER_SRC = path.resolve(__dirname, '..', '..', '..', 'src') + path.sep;

class NoNetworkProvider {
  async getBlockNumber() {
    throw new Error('network disabled in tests');
  }
  destroy() {}
}

class RecordingContract {
  constructor(address) {
    this.address = address;
    // Shaped like an ethers v6 contract method: the server simulates with
    // `.staticCall(...)` before it would ever send. Either entry point records
    // the arguments and fails, so no transaction is ever sent.
    const record = async (...args) => {
      fs.appendFileSync(SETTLE_LOG, JSON.stringify({ contract: this.address, args: args.map(String) }) + '\n');
      throw new Error('SETTLEMENT_STUBBED');
    };
    record.staticCall = record;
    this.transferWithAuthorization = record;
    this.balanceOf = async () => 1000000000000n;
  }
}

let patched;
const origLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  const mod = origLoad.call(this, request, parent, ...rest);
  if (request !== 'ethers' || !parent || !parent.filename || !parent.filename.startsWith(SERVER_SRC)) return mod;
  if (!patched) {
    // ethers exports are non-configurable getters, so build a plain copy.
    const ns = { ...mod.ethers, JsonRpcProvider: NoNetworkProvider, Contract: RecordingContract };
    patched = { ...mod, ...ns, ethers: ns };
  }
  return patched;
};
