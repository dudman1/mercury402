// Regression: the fallback JsonRpcProviders (used while sharedProvider is still
// null) were built without staticNetwork, so each one ran ethers' eth_chainId
// detection loop against the RPC. Every provider in src/server.js must pin the
// same network as the shared provider and pass staticNetwork: true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
const NETWORK = "{ chainId: parseInt(process.env.CHAIN_ID || '8453'), name: 'base' }";

// Argument text of every `new ethers.JsonRpcProvider(...)` call (balanced parens).
function providerCalls(src) {
  const calls = [];
  const needle = 'new ethers.JsonRpcProvider(';
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    let depth = 1;
    let j = i + needle.length;
    for (; depth > 0; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')') depth--;
    }
    calls.push({ line: src.slice(0, i).split('\n').length, args: src.slice(i + needle.length, j - 1).replace(/\s+/g, ' ').trim() });
  }
  return calls;
}

test('every JsonRpcProvider in src/server.js pins the base network with staticNetwork: true', () => {
  const calls = providerCalls(SRC);
  // shared provider + fallbacks: getProvider() (payment path), facilitator
  // balance refresh, /health throwaway.
  assert.ok(calls.length >= 4, `expected shared + 3 fallback providers, found ${calls.length}`);
  for (const { line, args } of calls) {
    assert.strictEqual(args, `process.env.BASE_RPC_URL, ${NETWORK}, { staticNetwork: true }`, `server.js:${line}`);
  }
});
