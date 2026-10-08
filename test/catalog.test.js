// Unit tests for src/catalog.js — the generated endpoint index behind the JSON
// manifest (GET /, /meta.json), /llms.txt and mcp-server/src/catalog.json.
// No server boot here: see root-manifest.test.js for the served documents.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { PRICING, getPrice } = require('../src/pricing');
const { buildCatalog, getCatalog } = require('../src/catalog');

const PRICED_PATHS = Object.keys(PRICING).filter((p) => p !== 'default');
const CATALOG = buildCatalog();
const BY_PATH = new Map(CATALOG.endpoints.map((e) => [e.path, e]));

test('catalog lists every priced endpoint exactly once', () => {
  assert.strictEqual(CATALOG.count, PRICED_PATHS.length);
  assert.strictEqual(CATALOG.endpoints.length, PRICED_PATHS.length);
  assert.strictEqual(BY_PATH.size, PRICED_PATHS.length);
  for (const p of PRICED_PATHS) assert.ok(BY_PATH.has(p), `${p} missing from catalog`);
  assert.ok(!BY_PATH.has('default'), 'the default fallback price is not an endpoint');
});

test('every catalog entry carries the metadata agents need', () => {
  for (const e of CATALOG.endpoints) {
    assert.ok(e.path.startsWith('/v1/'), e.path);
    assert.ok(['GET', 'POST'].includes(e.method), e.path);
    assert.ok(e.category && e.category.length > 0, e.path);
    assert.ok(e.description.length > 5, e.path);
    assert.strictEqual(e.price_usd, PRICING[e.path], e.path);
    assert.strictEqual(e.price_usdc_atomic, String(Math.floor(PRICING[e.path] * 1000000)), e.path);
    assert.ok(Array.isArray(e.params), e.path);
  }
});

test('catalog prices agree with the x402 descriptor price lookup', () => {
  for (const e of CATALOG.endpoints) assert.strictEqual(e.price_usd, getPrice(e.path), e.path);
});

test('POST endpoints are exactly the two documented ones', () => {
  const post = CATALOG.endpoints.filter((e) => e.method === 'POST').map((e) => e.path).sort();
  assert.deepStrictEqual(post, ['/v1/ai/ask', '/v1/treasury/yield-curve/historical']);
});

test('the FRED template entry documents its params and the range-query price note', () => {
  const t = BY_PATH.get('/v1/fred/{series_id}');
  assert.ok(t, 'template entry present');
  assert.deepStrictEqual(t.params.map((p) => p.name), ['series_id', 'date', 'observation_start', 'observation_end', 'limit']);
  assert.match(t.price_note, /doubles/i);
});

test('mcp-server/src/catalog.json is in sync with src/catalog.js', () => {
  const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'mcp-server', 'src', 'catalog.json'), 'utf8'));
  assert.deepStrictEqual(onDisk, CATALOG);
});

test('getCatalog() is memoized and equals buildCatalog()', () => {
  assert.strictEqual(getCatalog(), getCatalog());
  assert.deepStrictEqual(getCatalog(), CATALOG);
});
