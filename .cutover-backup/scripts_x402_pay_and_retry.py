#!/usr/bin/env python3
"""
x402_pay_and_retry.py — Inspect Mercury402 payment requirements and optionally retry
with a supplied payment-signature header.

Usage:
  # Inspect descriptor only
  python3 x402_pay_and_retry.py

  # Retry with an existing payment-signature
  python3 x402_pay_and_retry.py --signature '<base64_x402_payment_payload>'

  # Or via env var
  PAYMENT_SIGNATURE='<base64_x402_payment_payload>' python3 x402_pay_and_retry.py

This script no longer tries to mint legacy bearer tokens. Production Mercury expects
`payment-signature`, not `Authorization: Bearer x402_...`.
"""

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Optional

MERCURY_BASE_URL = "https://mercury402.uk"
DEFAULT_ENDPOINT = "/v1/fred/CPIAUCSL"
DEFAULT_HEADERS = {
    "User-Agent": "curl/8.4.0",
    "Accept": "*/*",
}


def decode_payment_descriptor(b64_value: str) -> dict:
    padded = b64_value.replace("-", "+").replace("_", "/")
    padded += "=" * (4 - len(padded) % 4) if len(padded) % 4 else ""
    raw = base64.b64decode(padded)
    return json.loads(raw)


def http_get(url: str, headers: Optional[dict] = None):
    merged = {**DEFAULT_HEADERS, **(headers or {})}
    req = urllib.request.Request(url, headers=merged)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def extract_payment_required(headers: dict) -> Optional[str]:
    for key, value in headers.items():
        if key.lower() == "payment-required":
            return value
    return None


def main():
    parser = argparse.ArgumentParser(description="Inspect Mercury402 x402 descriptor and optionally retry with payment-signature")
    parser.add_argument("--url", default=f"{MERCURY_BASE_URL}{DEFAULT_ENDPOINT}", help="Paid endpoint URL")
    parser.add_argument("--signature", default=os.environ.get("PAYMENT_SIGNATURE", ""), help="Base64 x402 payment payload for payment-signature header")
    args = parser.parse_args()

    print("\n" + "=" * 60)
    print("Mercury402 payment-signature helper")
    print(f"Endpoint : {args.url}")
    print(f"Mode     : {'RETRY' if args.signature else 'INSPECT'}")
    print("=" * 60 + "\n")

    print("STEP 1 — Unpaid request (expect 402) ...")
    status, headers, body = http_get(args.url)
    print(f"  HTTP {status}")

    if status != 402:
        preview = body.decode("utf-8", errors="replace")[:400]
        print(f"  Unexpected response body:\n{preview}")
        sys.exit(1)

    payment_required = extract_payment_required(headers)
    if not payment_required:
        print("  ERROR: no Payment-Required header found")
        sys.exit(1)

    raw_descriptor = decode_payment_descriptor(payment_required)
    descriptor = raw_descriptor.get("accepts", [{}])[0] if raw_descriptor.get("accepts") else raw_descriptor

    print("\nSTEP 2 — Payment descriptor")
    print(json.dumps(raw_descriptor, indent=2))

    if not args.signature:
        print("\nNo payment-signature supplied.")
        print("Use an x402-compatible client or wallet to turn the Payment-Required descriptor into a signed payment payload, then rerun with:")
        print(f"  python3 {os.path.basename(__file__)} --url {args.url} --signature '<base64_x402_payment_payload>'")
        sys.exit(0)

    print("\nSTEP 3 — Retrying with payment-signature ...")
    status2, headers2, body2 = http_get(args.url, {"payment-signature": args.signature})
    print(f"  HTTP {status2}")
    preview2 = body2.decode("utf-8", errors="replace")[:1200]
    print(preview2)

    if status2 == 200:
        sys.exit(0)

    sys.exit(1)


if __name__ == "__main__":
    main()

# ---
# *Last updated: 2026-04-20 23:09 ET | Updated by: Forge*
