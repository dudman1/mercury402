// Preloaded (node --require) into a child process that boots src/server.js for
// route-level tests. No-op unless MERCURY_TEST_SANDBOX_DIR is set, so the
// node --test glob running this file directly does nothing.
//
// - Redirects the hardcoded /Users/openclaw/.openclaw ledger/log paths into a
//   temp dir so tests never touch real revenue/redemption/access logs.
// - Stubs axios: FRED series validation answers from a fixed list; every other
//   outbound axios call fails. No network, no payments.
const SANDBOX = process.env.MERCURY_TEST_SANDBOX_DIR;
if (!SANDBOX) return;

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PROD_ROOT = '/Users/openclaw/.openclaw';
const remap = (p) => (typeof p === 'string' && p.startsWith(PROD_ROOT) ? path.join(SANDBOX, p.slice(PROD_ROOT.length)) : p);

for (const fn of ['existsSync', 'readFileSync', 'writeFileSync', 'appendFileSync', 'mkdirSync', 'readdirSync', 'statSync', 'unlinkSync']) {
  const orig = fs[fn];
  fs[fn] = (p, ...rest) => orig.call(fs, remap(p), ...rest);
}
const origRename = fs.renameSync;
fs.renameSync = (a, b) => origRename.call(fs, remap(a), remap(b));

const VALID_FRED_IDS = new Set((process.env.MERCURY_TEST_VALID_FRED_IDS || '').split(',').filter(Boolean));

axios.get = async (url, config = {}) => {
  if (url === 'https://api.stlouisfed.org/fred/series') {
    const id = config.params && config.params.series_id;
    if (VALID_FRED_IDS.has(id)) return { status: 200, data: { seriess: [{ id }] } };
    const err = new Error('Bad Request');
    err.response = { status: 400 };
    throw err;
  }
  throw new Error(`network disabled in tests: GET ${url}`);
};
axios.post = async (url) => {
  throw new Error(`network disabled in tests: POST ${url}`);
};
