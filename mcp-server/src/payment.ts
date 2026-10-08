import { randomBytes } from 'node:crypto';
import { Wallet, getAddress, isAddress } from 'ethers';

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_NETWORKS = new Set(['eip155:8453', 'base']);

/** A single x402 payment option, normalized from either the v2 header or the v1 JSON body. */
export interface PaymentRequirement {
  x402Version: number;
  scheme: string;
  network: string;
  /** Amount in USDC atomic units (6 decimals). */
  amount: string;
  amountUsd: number;
  asset: string;
  payTo: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string; [k: string]: unknown };
  /** The requirement object exactly as the server sent it; echoed back as `accepted`. */
  raw: Record<string, unknown>;
}

function decodeBase64Json(value: string): unknown {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

function normalize(req: Record<string, unknown>, version: number, resourceFallback?: string): PaymentRequirement | undefined {
  const amount = String(req.amount ?? req.maxAmountRequired ?? '');
  if (!/^\d+$/.test(amount)) return undefined;
  const resource = typeof req.resource === 'string' ? req.resource : resourceFallback;
  return {
    x402Version: version,
    scheme: String(req.scheme ?? ''),
    network: String(req.network ?? ''),
    amount,
    amountUsd: Number(amount) / 1_000_000,
    asset: String(req.asset ?? ''),
    payTo: String(req.payTo ?? ''),
    resource,
    description: typeof req.description === 'string' ? req.description : undefined,
    maxTimeoutSeconds: typeof req.maxTimeoutSeconds === 'number' ? req.maxTimeoutSeconds : undefined,
    extra: (req.extra as PaymentRequirement['extra']) ?? undefined,
    raw: req,
  };
}

/**
 * Parses an HTTP 402 response into payment requirements. Prefers the x402 v2
 * `Payment-Required` header; falls back to the v1 JSON body `accepts[]`.
 */
export function parsePaymentRequired(headers: Headers, body: unknown): PaymentRequirement[] {
  const header = headers.get('payment-required');
  if (header) {
    try {
      const decoded = decodeBase64Json(header) as {
        x402Version?: number;
        accepts?: Record<string, unknown>[];
        resource?: { url?: string; description?: string };
      };
      const reqs = (decoded.accepts ?? [])
        .map((a) => normalize(a, decoded.x402Version ?? 2, decoded.resource?.url))
        .filter((r): r is PaymentRequirement => !!r);
      if (reqs.length) {
        if (decoded.resource?.description) {
          for (const r of reqs) r.description ??= decoded.resource.description;
        }
        return reqs;
      }
    } catch {
      // fall through to the body
    }
  }
  const b = body as { x402Version?: number; accepts?: Record<string, unknown>[] } | null;
  if (b && Array.isArray(b.accepts)) {
    return b.accepts
      .map((a) => normalize(a, b.x402Version ?? 1))
      .filter((r): r is PaymentRequirement => !!r);
  }
  return [];
}

/** Picks the first requirement this client can pay (exact scheme, USDC on Base). */
export function selectPayable(reqs: PaymentRequirement[]): PaymentRequirement | undefined {
  return reqs.find(
    (r) =>
      r.scheme === 'exact' &&
      BASE_NETWORKS.has(r.network) &&
      r.asset.toLowerCase() === BASE_USDC.toLowerCase() &&
      isAddress(r.payTo),
  );
}

export interface Payer {
  readonly address: string;
  /** Returns the value for the `PAYMENT-SIGNATURE` request header. */
  createPaymentHeader(req: PaymentRequirement): Promise<string>;
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * x402 "exact" scheme payer: signs an EIP-3009 transferWithAuthorization for
 * exactly the requested amount. Signing happens locally; the Mercury402 server
 * submits the authorization on-chain. The private key never leaves this object.
 */
export function createEvmPayer(privateKey: string): Payer {
  let wallet: Wallet;
  try {
    wallet = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  } catch {
    // ethers' error message includes the bad value; never surface it.
    throw new Error('MERCURY402_PAYER_PRIVATE_KEY is not a valid EVM private key');
  }
  return {
    address: wallet.address,
    async createPaymentHeader(req) {
      const now = Math.floor(Date.now() / 1000);
      const authorization = {
        from: wallet.address,
        to: getAddress(req.payTo),
        value: req.amount,
        validAfter: String(now - 60),
        validBefore: String(now + 600),
        nonce: `0x${randomBytes(32).toString('hex')}`,
      };
      const domain = {
        name: req.extra?.name ?? 'USD Coin',
        version: req.extra?.version ?? '2',
        chainId: BASE_CHAIN_ID,
        verifyingContract: getAddress(req.asset),
      };
      const signature = await wallet.signTypedData(domain, TRANSFER_WITH_AUTHORIZATION_TYPES, authorization);
      const payload = {
        x402Version: 2,
        accepted: req.raw,
        payload: { authorization, signature },
      };
      return Buffer.from(JSON.stringify(payload)).toString('base64');
    },
  };
}

/** Decodes the base64 `PAYMENT-RESPONSE` settlement header, if present. */
export function parsePaymentResponse(headers: Headers): Record<string, unknown> | undefined {
  const h = headers.get('payment-response');
  if (!h) return undefined;
  try {
    return decodeBase64Json(h) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
