import type { ResolvedEndpoint } from './catalog.js';
import {
  parsePaymentRequired,
  parsePaymentResponse,
  selectPayable,
  type Payer,
  type PaymentRequirement,
} from './payment.js';

export type FetchFn = typeof fetch;

export interface ClientOptions {
  apiUrl: string;
  fetch?: FetchFn;
  payer?: Payer;
  maxPriceUsd: number;
  timeoutMs: number;
  /** Publicly exposed HTTP server (see publicExposure() in http.ts): callers cannot enable paid mode. */
  hosted?: boolean;
}

export interface PaymentQuote {
  price_usd: number;
  amount_usdc_atomic: string;
  network: string;
  asset: string;
  pay_to: string;
  scheme: string;
  resource?: string;
  description?: string;
  x402_version: number;
}

export type CallResult =
  | {
      status: 'ok';
      http_status: number;
      url: string;
      data: unknown;
      payment?: { paid: true; price_usd: number; payer: string; settlement?: Record<string, unknown> };
    }
  | {
      status: 'payment_required';
      http_status: 402;
      url: string;
      reason: string;
      quote?: PaymentQuote;
      all_options: PaymentQuote[];
      how_to_pay: string[];
      raw_body: unknown;
    }
  | { status: 'error'; http_status: number; url: string; error: unknown };

function toQuote(r: PaymentRequirement): PaymentQuote {
  return {
    price_usd: r.amountUsd,
    amount_usdc_atomic: r.amount,
    network: r.network,
    asset: r.asset,
    pay_to: r.payTo,
    scheme: r.scheme,
    resource: r.resource,
    description: r.description,
    x402_version: r.x402Version,
  };
}

const HOW_TO_PAY = [
  'Mercury402 uses the x402 protocol: pay per call in USDC on Base (chain id 8453).',
  'Sign an EIP-3009 transferWithAuthorization for the quoted amount to pay_to, base64-encode an x402 PaymentPayload, and resend the same request with a PAYMENT-SIGNATURE header. Any x402-compatible client/wallet can do this.',
  'Or enable paid mode in this MCP server: set MERCURY402_PAYER_PRIVATE_KEY to a funded Base hot wallet (and optionally MERCURY402_MAX_PRICE_USD), then call get_endpoint_data again.',
];

// A hosted (publicly exposed) server refuses to boot with a payer key, and a remote caller
// cannot set its env vars, so it must not suggest enabling paid mode on itself.
export const HOSTED_HOW_TO_PAY = [
  HOW_TO_PAY[0],
  HOW_TO_PAY[1],
  'To pay automatically, run mercury402-mcp locally (npx -y mercury402-mcp) with MERCURY402_PAYER_PRIVATE_KEY set to a funded Base hot wallet you control.',
];

export const LOCAL_NO_PAYER_REASON = 'Payment required. Paid mode is disabled (MERCURY402_PAYER_PRIVATE_KEY not set).';
export const HOSTED_NO_PAYER_REASON = 'Payment required. This hosted endpoint is discovery-only and never pays on your behalf.';

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class MercuryClient {
  private readonly fetchFn: FetchFn;

  constructor(private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetch ?? fetch;
  }

  get paidModeEnabled(): boolean {
    return !!this.opts.payer;
  }

  buildUrl(req: ResolvedEndpoint): string {
    const url = new URL(this.opts.apiUrl + req.path);
    for (const [k, v] of Object.entries(req.query)) url.searchParams.set(k, v);
    return url.toString();
  }

  private send(req: ResolvedEndpoint, url: string, extraHeaders: Record<string, string> = {}): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json', ...extraHeaders };
    const init: RequestInit = { method: req.endpoint.method, headers, signal: AbortSignal.timeout(this.opts.timeoutMs) };
    if (req.endpoint.method === 'POST') {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(req.body ?? {});
    }
    return this.fetchFn(url, init);
  }

  private paymentRequired(url: string, reason: string, reqs: PaymentRequirement[], body: unknown): CallResult {
    const options = reqs.map(toQuote);
    const payable = selectPayable(reqs);
    return {
      status: 'payment_required',
      http_status: 402,
      url,
      reason,
      quote: payable ? toQuote(payable) : options[0],
      all_options: options,
      how_to_pay: this.opts.hosted ? HOSTED_HOW_TO_PAY : HOW_TO_PAY,
      raw_body: body,
    };
  }

  /**
   * Calls the endpoint. On HTTP 402: returns the quote, or — when paid mode is
   * enabled and `pay` is not false — pays once (subject to maxPriceUsd) and
   * retries. A paid request is never retried automatically to avoid double charges.
   */
  async call(req: ResolvedEndpoint, pay = true): Promise<CallResult> {
    const url = this.buildUrl(req);
    const first = await this.send(req, url);
    const firstBody = await readBody(first);

    if (first.status !== 402) {
      return first.ok
        ? { status: 'ok', http_status: first.status, url, data: firstBody }
        : { status: 'error', http_status: first.status, url, error: firstBody };
    }

    const reqs = parsePaymentRequired(first.headers, firstBody);
    const payer = this.opts.payer;
    if (!payer) {
      return this.paymentRequired(url, this.opts.hosted ? HOSTED_NO_PAYER_REASON : LOCAL_NO_PAYER_REASON, reqs, firstBody);
    }
    if (!pay) {
      return this.paymentRequired(url, 'Payment required. Not paying because pay=false was requested.', reqs, firstBody);
    }
    const target = selectPayable(reqs);
    if (!target) {
      return this.paymentRequired(url, 'Payment required, but no option is payable by this client (needs x402 "exact" USDC on Base).', reqs, firstBody);
    }
    if (target.amountUsd > this.opts.maxPriceUsd) {
      return this.paymentRequired(
        url,
        `Price $${target.amountUsd} exceeds MERCURY402_MAX_PRICE_USD ($${this.opts.maxPriceUsd}); not paying.`,
        reqs,
        firstBody,
      );
    }

    const header = await payer.createPaymentHeader(target);
    let second: Response;
    try {
      second = await this.send(req, url, { 'PAYMENT-SIGNATURE': header });
    } catch (err) {
      return {
        status: 'error',
        http_status: 0,
        url,
        error: {
          message: `Request failed after a payment authorization was sent; it may have settled. Check payer ${payer.address} on Base before retrying.`,
          cause: err instanceof Error ? err.message : String(err),
        },
      };
    }
    const secondBody = await readBody(second);
    if (second.status === 402) {
      return this.paymentRequired(url, 'Payment was submitted but rejected or not settled by the server.', parsePaymentRequired(second.headers, secondBody), secondBody);
    }
    if (!second.ok) {
      return { status: 'error', http_status: second.status, url, error: secondBody };
    }
    return {
      status: 'ok',
      http_status: second.status,
      url,
      data: secondBody,
      payment: { paid: true, price_usd: target.amountUsd, payer: payer.address, settlement: parsePaymentResponse(second.headers) },
    };
  }
}
