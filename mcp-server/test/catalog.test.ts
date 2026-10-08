import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CATALOG, findEndpoint, resolveRequest } from '../src/catalog.js';

const require = createRequire(import.meta.url);

describe('catalog', () => {
  it('matches the API pricing source of truth (src/pricing.js) exactly', () => {
    const { PRICING } = require('../../src/pricing.js') as { PRICING: Record<string, number> };
    const expected = Object.entries(PRICING).filter(([p]) => p !== 'default');
    expect(CATALOG.count).toBe(expected.length);
    expect(CATALOG.endpoints).toHaveLength(expected.length);
    for (const [path, price] of expected) {
      const e = CATALOG.endpoints.find((x) => x.path === path);
      expect(e, path).toBeDefined();
      expect(e!.price_usd, path).toBe(price);
      expect(e!.price_usdc_atomic).toBe(String(Math.floor(price * 1_000_000)));
    }
  });

  it('has complete metadata for every endpoint', () => {
    for (const e of CATALOG.endpoints) {
      expect(e.path).toMatch(/^\/v1\//);
      expect(['GET', 'POST']).toContain(e.method);
      expect(e.category).toBeTruthy();
      expect(e.description.length).toBeGreaterThan(5);
    }
    const post = CATALOG.endpoints.filter((e) => e.method === 'POST').map((e) => e.path).sort();
    expect(post).toEqual(['/v1/ai/ask', '/v1/treasury/yield-curve/historical']);
  });

  it('prefers exact matches over the FRED template', () => {
    expect(findEndpoint('/v1/fred/cpi')!.endpoint.path).toBe('/v1/fred/cpi');
    expect(findEndpoint('/v1/fred/UNRATE')!.endpoint.path).toBe('/v1/fred/{series_id}');
    expect(findEndpoint('/v1/does/not/exist')).toBeUndefined();
  });

  it('resolves path params inline or from params, and routes the rest by method', () => {
    expect(resolveRequest('/v1/fred/UNRATE', { limit: 5 })).toMatchObject({ path: '/v1/fred/UNRATE', query: { limit: '5' } });
    expect(resolveRequest('/v1/fred/{series_id}', { series_id: 'DGS10', observation_start: '2026-01-01' })).toMatchObject({
      path: '/v1/fred/DGS10',
      query: { observation_start: '2026-01-01' },
    });
    const post = resolveRequest('/v1/treasury/yield-curve/historical', { start_date: '2026-01-01', end_date: '2026-02-01' });
    expect(post).toMatchObject({ path: '/v1/treasury/yield-curve/historical', query: {}, body: { start_date: '2026-01-01', end_date: '2026-02-01' } });
  });

  it('rejects unknown paths, missing required params and unsafe path params', () => {
    expect(() => resolveRequest('/admin')).toThrow(/Unknown endpoint/);
    expect(() => resolveRequest('/v1/fred/{series_id}')).toThrow(/series_id/);
    expect(() => resolveRequest('/v1/fred/{series_id}', { series_id: '../../health' })).toThrow(/Invalid value/);
    expect(() => resolveRequest('/v1/treasury/yield-curve/historical', { start_date: '2026-01-01' })).toThrow(/end_date/);
    expect(() => resolveRequest('/v1/ai/ask', {})).toThrow(/question/);
  });
});
