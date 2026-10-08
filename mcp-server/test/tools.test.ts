import { Wallet, verifyTypedData } from 'ethers';
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog.js';
import { BASE_USDC, createEvmPayer } from '../src/payment.js';
import { createMercuryServer } from '../src/server.js';
import { API, MERCHANT, connect, fakePayer, jsonResponse, make402, mockFetch, payload, testConfig } from './helpers.js';

let session: Awaited<ReturnType<typeof connect>> | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
});

describe('list_endpoints', () => {
  it('lists every endpoint with path, method, category, description and price', async () => {
    const fetch = mockFetch();
    session = await connect(testConfig(), { fetch });
    const tools = await session.client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['get_endpoint_data', 'list_endpoints']);

    const { res, text } = await session.call('list_endpoints');
    expect(res.isError).toBeFalsy();
    const body = payload(text);
    expect(body.count).toBe(CATALOG.count);
    expect(body.paid_mode).toEqual({ enabled: false });
    expect(body.endpoints[0]).toEqual(
      expect.objectContaining({ path: expect.any(String), method: expect.any(String), category: expect.any(String), description: expect.any(String), price_usd: expect.any(Number) }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('filters by category and search', async () => {
    session = await connect(testConfig(), { fetch: mockFetch() });
    const byCat = payload((await session.call('list_endpoints', { category: 'forex' })).text);
    expect(byCat.endpoints.map((e: { path: string }) => e.path).sort()).toEqual([
      '/v1/forex/eur-usd',
      '/v1/forex/gbp-usd',
      '/v1/forex/usd-cny',
      '/v1/forex/usd-jpy',
    ]);
    const bySearch = payload((await session.call('list_endpoints', { search: 'labor market' })).text);
    expect(bySearch.endpoints.map((e: { path: string }) => e.path)).toContain('/v1/composite/labor-market');
  });
});

describe('get_endpoint_data without paid mode', () => {
  it('returns the 402 payment descriptor clearly', async () => {
    const fetch = mockFetch(make402('/v1/fred/UNRATE', 0.05));
    session = await connect(testConfig(), { fetch });
    const { res, text } = await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE', params: { limit: 3 } });

    expect(res.isError).toBeFalsy();
    expect(text).toMatch(/^PAYMENT REQUIRED \(HTTP 402\)/);
    expect(text).toContain('$0.05');
    const body = payload(text);
    expect(body.status).toBe('payment_required');
    // The v1 JSON body (what the live API returns) is preferred over the v2 header.
    expect(body.quote).toMatchObject({
      price_usd: 0.05,
      amount_usdc_atomic: '50000',
      network: 'base',
      asset: BASE_USDC,
      pay_to: MERCHANT,
      scheme: 'exact',
      x402_version: 1,
    });
    expect(body.how_to_pay.join(' ')).toMatch(/MERCURY402_PAYER_PRIVATE_KEY/);
    expect(body.raw_body.accepts[0].maxAmountRequired).toBe('50000');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${API}/v1/fred/UNRATE?limit=3`);
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)['PAYMENT-SIGNATURE']).toBeUndefined();
  });

  it('falls back to the v2 Payment-Required header when the body has no accepts', async () => {
    const r = make402('/v1/macro/bundle', 0.1);
    const headerOnly = new Response('{}', { status: 402, headers: { 'Payment-Required': r.headers.get('payment-required')! } });
    session = await connect(testConfig(), { fetch: mockFetch(headerOnly) });
    const body = payload((await session.call('get_endpoint_data', { path: '/v1/macro/bundle' })).text);
    expect(body.quote).toMatchObject({ price_usd: 0.1, amount_usdc_atomic: '100000', network: 'eip155:8453', x402_version: 2 });
  });

  it('sends POST endpoints with a JSON body', async () => {
    const fetch = mockFetch(make402('/v1/treasury/yield-curve/historical', 0.05, 'POST'));
    session = await connect(testConfig(), { fetch });
    await session.call('get_endpoint_data', {
      path: '/v1/treasury/yield-curve/historical',
      params: { start_date: '2026-01-01', end_date: '2026-02-01' },
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${API}/v1/treasury/yield-curve/historical`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({ start_date: '2026-01-01', end_date: '2026-02-01' });
  });

  it('passes through non-402 responses (free 400 validation errors, data)', async () => {
    const fetch = mockFetch(jsonResponse({ error: { code: 'INVALID_SERIES', charged: false } }, 400));
    session = await connect(testConfig(), { fetch });
    const { res, text } = await session.call('get_endpoint_data', { path: '/v1/fred/NOTREAL' });
    expect(res.isError).toBe(true);
    expect(payload(text)).toMatchObject({ status: 'error', http_status: 400, error: { error: { code: 'INVALID_SERIES' } } });
  });

  it('rejects unknown endpoints without making a request', async () => {
    const fetch = mockFetch();
    session = await connect(testConfig(), { fetch });
    const { res, text } = await session.call('get_endpoint_data', { path: '/health' });
    expect(res.isError).toBe(true);
    expect(text).toMatch(/Unknown endpoint/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('get_endpoint_data in paid mode (mocked payment)', () => {
  const data = { data: { series_id: 'UNRATE', observations: [{ date: '2026-09-01', value: '4.1' }] } };
  const settlement = { success: true, transaction: '0xabc', network: 'eip155:8453', payer: '0x2222222222222222222222222222222222222222' };
  const settlementHeader = Buffer.from(JSON.stringify(settlement)).toString('base64');

  it('pays the 402 and returns the data plus the settlement receipt', async () => {
    const payer = fakePayer();
    const fetch = mockFetch(make402('/v1/fred/UNRATE', 0.05), jsonResponse(data, 200, { 'PAYMENT-RESPONSE': settlementHeader }));
    session = await connect(testConfig(), { fetch, payer });
    const { res, text } = await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE' });

    expect(res.isError).toBeFalsy();
    expect(text).toMatch(/^OK \(HTTP 200\).*Paid \$0\.05/);
    const body = payload(text);
    expect(body.data).toEqual(data);
    expect(body.payment).toEqual({ paid: true, price_usd: 0.05, payer: payer.address, settlement });

    expect(payer.createPaymentHeader).toHaveBeenCalledTimes(1);
    expect(payer.createPaymentHeader.mock.calls[0][0]).toMatchObject({ amount: '50000', payTo: MERCHANT, network: 'base', x402Version: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1][1]?.headers as Record<string, string>)['PAYMENT-SIGNATURE']).toBe('FAKE_PAYMENT_HEADER');
  });

  it('refuses to pay above MERCURY402_MAX_PRICE_USD', async () => {
    const payer = fakePayer();
    const fetch = mockFetch(make402('/v1/composite/economic-dashboard', 0.5));
    session = await connect(testConfig({ MERCURY402_MAX_PRICE_USD: '0.25' }), { fetch, payer });
    const body = payload((await session.call('get_endpoint_data', { path: '/v1/composite/economic-dashboard' })).text);
    expect(body.status).toBe('payment_required');
    expect(body.reason).toMatch(/exceeds MERCURY402_MAX_PRICE_USD/);
    expect(payer.createPaymentHeader).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('only quotes when pay=false', async () => {
    const payer = fakePayer();
    session = await connect(testConfig(), { fetch: mockFetch(make402('/v1/fred/UNRATE', 0.05)), payer });
    const body = payload((await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE', pay: false })).text);
    expect(body.status).toBe('payment_required');
    expect(body.reason).toMatch(/pay=false/);
    expect(payer.createPaymentHeader).not.toHaveBeenCalled();
  });

  it('refuses to sign for a non-USDC asset or another network', async () => {
    const payer = fakePayer();
    const evilAsset = make402('/v1/fred/UNRATE', 0.05, 'GET', { asset: '0x3333333333333333333333333333333333333333' });
    session = await connect(testConfig(), { fetch: mockFetch(evilAsset), payer });
    const body = payload((await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE' })).text);
    expect(body.reason).toMatch(/no option is payable/);
    expect(payer.createPaymentHeader).not.toHaveBeenCalled();
  });

  it('reports a rejected payment and does not retry', async () => {
    const payer = fakePayer();
    const fetch = mockFetch(make402('/v1/fred/UNRATE', 0.05), make402('/v1/fred/UNRATE', 0.05));
    session = await connect(testConfig(), { fetch, payer });
    const body = payload((await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE' })).text);
    expect(body.status).toBe('payment_required');
    expect(body.reason).toMatch(/rejected or not settled/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('signs a valid EIP-3009 authorization with the configured key and never leaks it', async () => {
    // Throwaway random key generated in-process; never funded, nothing is broadcast.
    const wallet = Wallet.createRandom();
    const fetch = mockFetch(make402('/v1/fred/UNRATE', 0.05), jsonResponse(data));
    session = await connect(testConfig({ MERCURY402_PAYER_PRIVATE_KEY: wallet.privateKey }), { fetch });

    const { text: listText } = await session.call('list_endpoints');
    expect(payload(listText).paid_mode).toEqual({ enabled: true, payer: wallet.address, max_price_usd: 0.5 });

    const { text } = await session.call('get_endpoint_data', { path: '/v1/fred/UNRATE' });
    expect(payload(text).payment).toMatchObject({ paid: true, payer: wallet.address });

    const header = (fetch.mock.calls[1][1]?.headers as Record<string, string>)['PAYMENT-SIGNATURE'];
    const sent = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    // Same envelope as src/mcp-mercury.js: v2 wrapper, `accepted` = the v1 body's accepts[0] verbatim.
    const v1Body = await make402('/v1/fred/UNRATE', 0.05).json();
    expect(Object.keys(sent).sort()).toEqual(['accepted', 'payload', 'x402Version']);
    expect(sent.x402Version).toBe(2);
    expect(sent.accepted).toEqual(v1Body.accepts[0]);
    expect(Object.keys(sent.payload).sort()).toEqual(['authorization', 'signature']);
    const { authorization, signature } = sent.payload;
    expect(authorization).toMatchObject({ from: wallet.address, to: MERCHANT, value: '50000' });
    expect(authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const recovered = verifyTypedData(
      { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC },
      {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      authorization,
      signature,
    );
    expect(recovered).toBe(wallet.address);

    const keyHex = wallet.privateKey.slice(2).toLowerCase();
    for (const out of [listText, text, header, JSON.stringify(fetch.mock.calls)]) {
      expect(out.toLowerCase()).not.toContain(keyHex);
    }
  });

  it('does not echo an invalid private key in its error', () => {
    const bad = '0xnot-a-real-key-SECRET123';
    expect(() => createEvmPayer(bad)).toThrow('MERCURY402_PAYER_PRIVATE_KEY is not a valid EVM private key');
    let error: unknown;
    try {
      createMercuryServer(testConfig({ MERCURY402_PAYER_PRIVATE_KEY: bad }));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('SECRET123');
  });
});
