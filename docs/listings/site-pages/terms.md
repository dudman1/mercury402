<!--
DRAFT for https://mercury402.com/terms (later PR, not this one). Facts checked against dudman1/mercury402 @ ceb5b47.
Dustin fills: [OPERATOR], [EFFECTIVE DATE], [GOVERNING LAW], [LIABILITY CAP]. Dustin decides the payment-problem
wording (no refund guarantee is promised here). Not legal advice; have a lawyer look before relying on it.
-->

# Terms of Service

Effective [EFFECTIVE DATE]

These terms cover your use of the Mercury402 API (api.mercury402.com), the hosted MCP server (mcp.mercury402.com)
and the website mercury402.com (together, "the service"). The service is operated by [OPERATOR]. By using it you
agree to these terms.

## The service

Mercury402 sells financial and economic data per call. An unpaid request gets HTTP 402 with a price and payment
instructions. You pay in USDC on the Base network using the x402 protocol, then get the data. No account is needed.

Each endpoint's price is in its 402 response and in https://api.mercury402.com/openapi.json. Prices can change. The
price in the 402 response you pay against is the one that applies.

## Payments

- Payments are blockchain transactions. Once settled, they're final.
- You're responsible for the wallet you pay from, its keys, and any network fees.
- If you run the `mercury402-mcp` package in paid mode, it pays automatically up to the per-call cap you set. Use a
  dedicated low-balance wallet. We never receive your private key.
- If you were charged and didn't get your data, contact us through https://mercury402.com/support with the
  transaction hash and we'll review it.

## Data and AI output

- Data comes from public sources, including the Federal Reserve Bank of St. Louis (FRED®) and the U.S. Treasury,
  plus calculations we make on top of them. It can be delayed, revised, incomplete or wrong.
- Some FRED series are owned by third parties and carry their own copyright terms. Those terms still apply to you.
  <!-- FRED API terms: https://fred.stlouisfed.org/docs/api/terms_of_use.html -->
- AI endpoints (/v1/ai/\*) generate text with a language model and can be inaccurate.
- **Nothing from the service is financial, investment, tax or legal advice.** Don't rely on it alone for decisions.

FRED® is a registered trademark of the Federal Reserve Bank of St. Louis. Mercury402 is not affiliated with or
endorsed by the Federal Reserve Bank of St. Louis or the U.S. Treasury.

## Acceptable use

Don't:

- try to get paid data without paying, or replay or forge payments;
- overload, probe for vulnerabilities in, or disrupt the service (report security issues instead; see the support
  page);
- use the service for anything illegal, including in breach of sanctions that apply to you.

We may rate-limit or block traffic that breaks these rules.

## Open-source software

The `mercury402-mcp` package and the code in https://github.com/dudman1/mercury402 are MIT-licensed. That license,
not these terms, covers the code itself.

## No warranty

The service is provided "as is" and "as available", without warranties of any kind, including accuracy,
availability or fitness for a purpose.

## Limitation of liability

To the extent the law allows, we're not liable for indirect or consequential losses, including trading losses. Our
total liability for any claim is limited to [LIABILITY CAP, e.g. the amount you paid us in the 30 days before the
claim].

## Changes and termination

We may change these terms or the service. Changes apply from the effective date above. We may stop offering any
endpoint. You can stop using the service at any time.

## Governing law

[GOVERNING LAW]

## Contact

https://mercury402.com/support
