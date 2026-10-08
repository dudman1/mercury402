// Preloaded (node --require) into a child process that boots src/server.js for
// route-level tests. No-op unless MERCURY_TEST_SANDBOX_DIR is set, so the
// node --test glob running this file directly does nothing.
//
// - Points MERCURY402_LOG_DIR at the temp dir so tests never touch the real
//   revenue/redemption/access logs under /Users/openclaw/.openclaw.
// - Stubs axios: FRED series validation answers from a fixed list; every other
//   outbound axios call fails. No network, no payments.
const SANDBOX = process.env.MERCURY_TEST_SANDBOX_DIR;
if (!SANDBOX) return;

const axios = require('axios');

// server.js reads this when it loads (after this preload, and dotenv never
// overrides an env var that is already set).
process.env.MERCURY402_LOG_DIR = SANDBOX;

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
