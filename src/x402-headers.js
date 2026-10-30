// Request headers that carry an x402 payment artifact. Shared by
// require402Payment (server.js) and pre-payment validators so both agree on
// what counts as "the caller attached a payment".

// v2 clients send PAYMENT-SIGNATURE, v1 clients (which follow the v1 402
// body) send X-PAYMENT. Same base64 JSON envelope; first match wins, so v2
// wins if both are present. Lower-case: Node lower-cases incoming names.
const PAYMENT_HEADERS = ['payment-signature', 'x-payment'];

// Bearer tokens require402Payment inspects (dev-only `x402_test`; anything
// else is rejected there with a 402).
const X402_BEARER = /^Bearer\s+(x402_\S+)$/;

function paymentHeaderOf(req) {
  const headers = (req && req.headers) || {};
  for (const name of PAYMENT_HEADERS) {
    if (headers[name]) return headers[name];
  }
  return undefined;
}

function bearerTokenOf(req) {
  const m = String((req && req.headers && req.headers.authorization) || '').match(X402_BEARER);
  return m ? m[1] : null;
}

// True when require402Payment would treat the request as a payment attempt
// rather than an unpaid probe.
function hasPaymentArtifact(req) {
  return Boolean(paymentHeaderOf(req) || bearerTokenOf(req));
}

module.exports = { PAYMENT_HEADERS, X402_BEARER, paymentHeaderOf, bearerTokenOf, hasPaymentArtifact };
