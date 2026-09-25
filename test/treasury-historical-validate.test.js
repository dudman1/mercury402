const test = require('node:test');
const assert = require('node:assert');
const { preValidateTreasuryHistorical, MAX_RANGE_DAYS } = require('../src/treasury-historical-validate');

// Runs the middleware against a fake req/res. `next` stands in for the x402
// payment middleware + FRED fetch, so nothing past validation (and no network)
// is ever reached.
function run(body) {
  const out = { status: null, body: null, passed: false };
  const res = {
    status(code) { out.status = code; return this; },
    json(payload) { out.body = payload; return this; }
  };
  preValidateTreasuryHistorical({ body }, res, () => { out.passed = true; });
  return out;
}

function withTZ(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
  }
}

const TZS = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Kiritimati'];

test('limit is 90 days', () => {
  assert.strictEqual(MAX_RANGE_DAYS, 90);
});

test('exact 90-day range passes in every host timezone', () => {
  for (const tz of TZS) {
    withTZ(tz, () => {
      const r = run({ start_date: '2024-01-01', end_date: '2024-03-31' });
      assert.ok(r.passed, `${tz}: ${JSON.stringify(r.body)}`);
    });
  }
});

test('90 days + 1 fails with RANGE_TOO_LARGE in every host timezone', () => {
  for (const tz of TZS) {
    withTZ(tz, () => {
      const r = run({ start_date: '2024-01-01', end_date: '2024-04-01' });
      assert.strictEqual(r.passed, false);
      assert.strictEqual(r.status, 400);
      assert.strictEqual(r.body.error.code, 'RANGE_TOO_LARGE', tz);
    });
  }
});

test('boundary across a DST change and a leap day', () => {
  // 2024-03-10 is the US spring-forward date; 2024 is a leap year.
  withTZ('America/New_York', () => {
    assert.ok(run({ start_date: '2024-02-01', end_date: '2024-05-01' }).passed); // 90 days
    assert.strictEqual(run({ start_date: '2024-02-01', end_date: '2024-05-02' }).body.error.code, 'RANGE_TOO_LARGE'); // 91
  });
});

test('previously-failing example: local-time date-time no longer yields RANGE_TOO_LARGE', () => {
  // Old code: new Date('2024-03-31T23:59:59') is parsed as host-local time.
  // On an America/New_York host that adds ~4h, pushing a 90-day range to 91
  // and returning RANGE_TOO_LARGE (the same request passed on a UTC host).
  for (const tz of TZS) {
    withTZ(tz, () => {
      const r = run({ start_date: '2024-01-01', end_date: '2024-03-31T23:59:59' });
      assert.strictEqual(r.passed, false);
      assert.strictEqual(r.body.error.code, 'INVALID_DATE', tz);
    });
  }
});

test('documented example request passes', () => {
  assert.ok(run({ start_date: '2026-01-01', end_date: '2026-03-01' }).passed);
});

test('same start and end date passes (0-day range)', () => {
  assert.ok(run({ start_date: '2024-06-03', end_date: '2024-06-03' }).passed);
});

test('omitted params return MISSING_PARAMS (no defaults are applied)', () => {
  for (const body of [undefined, {}, { start_date: '2024-01-01' }, { end_date: '2024-01-31' }, { start_date: '', end_date: '2024-01-31' }]) {
    const r = run(body);
    assert.strictEqual(r.passed, false);
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'MISSING_PARAMS', JSON.stringify(body));
  }
});

test('reversed dates return INVALID_RANGE', () => {
  const r = run({ start_date: '2024-03-31', end_date: '2024-01-01' });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.error.code, 'INVALID_RANGE');
});

test('reversed dates more than 90 days apart return INVALID_RANGE, not RANGE_TOO_LARGE', () => {
  const r = run({ start_date: '2024-12-31', end_date: '2024-01-01' });
  assert.strictEqual(r.body.error.code, 'INVALID_RANGE');
});

test('invalid dates return INVALID_DATE before payment', () => {
  const bad = [
    { start_date: '2024-01-01', end_date: 'garbage' },  // old code: NaN -> passed to payment
    { start_date: 'garbage', end_date: 'garbage' },
    { start_date: '2024-02-30', end_date: '2024-03-01' }, // old code: rolled over to Mar 1
    { start_date: '2023-02-29', end_date: '2023-03-01' }, // not a leap year
    { start_date: '2024-13-01', end_date: '2024-12-31' },
    { start_date: '2024-1-1', end_date: '2024-3-31' },
    { start_date: '01/01/2024', end_date: '03/31/2024' },
    { start_date: 20240101, end_date: 20240331 },         // old code: epoch ms -> passed
    { start_date: '2024-01-01T00:00:00Z', end_date: '2024-01-31' },
    { start_date: ' 2024-01-01', end_date: '2024-01-31' }
  ];
  for (const body of bad) {
    const r = run(body);
    assert.strictEqual(r.passed, false, JSON.stringify(body));
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.body.error.code, 'INVALID_DATE', JSON.stringify(body));
  }
});

test('leap day itself is valid', () => {
  assert.ok(run({ start_date: '2024-02-29', end_date: '2024-03-01' }).passed);
});
