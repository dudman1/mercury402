// Preloaded (node --require) into a child process that boots src/server.js for
// route-level tests. No-op unless MERCURY_TEST_SANDBOX_DIR is set, so the
// node --test glob running this file directly does nothing.
//
// - Points MERCURY402_LOG_DIR at the temp dir so tests never touch the real
//   revenue/redemption/access logs under /Users/openclaw/.openclaw.
// - Stubs axios: FRED series validation answers from a fixed list; every other
//   outbound axios call logs `SANDBOX_UPSTREAM_CALL <url>` (so a test can
//   assert a paid handler did or did not reach upstream) and fails. With
//   MERCURY_TEST_FRED_OBSERVATIONS=1, FRED observation requests instead get a
//   canned single observation so a paid handler can answer 200.
//   MERCURY_TEST_UPSTREAM_DELAY_MS delays every stubbed upstream answer.
// - With MERCURY_TEST_AI_STUB=1, global fetch answers the OpenRouter chat
//   completions URL with a canned completion (logged the same way) so the
//   /v1/ai/* handlers can answer 200. Everything else goes to the real fetch.
//   No network, no payments.
const SANDBOX = process.env.MERCURY_TEST_SANDBOX_DIR;
if (!SANDBOX) return;

const axios = require('axios');

// server.js reads this when it loads (after this preload, and dotenv never
// overrides an env var that is already set).
process.env.MERCURY402_LOG_DIR = SANDBOX;

const VALID_FRED_IDS = new Set((process.env.MERCURY_TEST_VALID_FRED_IDS || '').split(',').filter(Boolean));
const OBSERVATIONS_URL = 'https://api.stlouisfed.org/fred/series/observations';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const UPSTREAM_DELAY_MS = Number(process.env.MERCURY_TEST_UPSTREAM_DELAY_MS || 0);
const upstreamDelay = () => (UPSTREAM_DELAY_MS > 0 ? new Promise((r) => setTimeout(r, UPSTREAM_DELAY_MS)) : Promise.resolve());

axios.get = async (url, config = {}) => {
  if (url === 'https://api.stlouisfed.org/fred/series') {
    const id = config.params && config.params.series_id;
    if (VALID_FRED_IDS.has(id)) return { status: 200, data: { seriess: [{ id }] } };
    const err = new Error('Bad Request');
    err.response = { status: 400 };
    throw err;
  }
  console.log(`SANDBOX_UPSTREAM_CALL ${url}`);
  await upstreamDelay();
  if (url === OBSERVATIONS_URL && process.env.MERCURY_TEST_FRED_OBSERVATIONS) {
    const id = (config.params && config.params.series_id) || 'TEST';
    return {
      status: 200,
      data: {
        title: `Sandbox ${id}`, units: 'Percent', frequency: 'Monthly', seasonal_adjustment: 'SA',
        last_updated: '2026-01-02', observations: [{ date: '2026-01-01', value: '4.1' }],
      },
    };
  }
  throw new Error(`network disabled in tests: GET ${url}`);
};
axios.post = async (url) => {
  console.log(`SANDBOX_UPSTREAM_CALL ${url}`);
  throw new Error(`network disabled in tests: POST ${url}`);
};

if (process.env.MERCURY_TEST_AI_STUB) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) !== OPENROUTER_URL) return realFetch(url, init);
    console.log(`SANDBOX_UPSTREAM_CALL ${url}`);
    await upstreamDelay();
    const body = JSON.stringify({
      model: 'sandbox/model',
      choices: [{ message: { content: 'Sandbox answer: UNRATE was 4.1 on 2026-01-01.' }, finish_reason: 'stop' }],
      usage: null,
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
