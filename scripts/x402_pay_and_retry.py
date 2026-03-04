#!/usr/bin/env python3
"""
x402_pay_and_retry.py — Headless x402 payment + retry for Mercury402

Usage:
  # Dry-run: parse descriptor, detect payment tooling, stop before paying
  python3 x402_pay_and_retry.py

  # Execute payment (requires APPROVE PAYMENT env flag or --pay flag)
  python3 x402_pay_and_retry.py --pay

  # Test with a specific endpoint
  python3 x402_pay_and_retry.py --url https://mercury402.uk/v1/fred/UNRATE

No external Python deps — only stdlib + subprocess calls to bankr/cast.

Payment flow:
  1. GET paid endpoint → expect HTTP 402 + payment-required header
  2. Decode base64 descriptor → extract chain, asset, payTo, amount
  3. Detect wallet tooling (bankr preferred, cast fallback)
  4. Send USDC via chosen tool
  5. Derive Authorization token from payment result
  6. Retry paid endpoint with Authorization header → expect HTTP 200
  7. Print first 300 chars of JSON response

x402.io is optional: this script does NOT call x402.io.
The payment descriptor in the 402 response contains everything needed.

Authorization token convention used by this server:
  Bearer x402_<anything-non-test>  → accepted (server TODO: validate against ledger)
  The token we derive: x402_bankr_<txhash_prefix> or x402_cast_<txhash_prefix>
"""

import argparse
import base64
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
from typing import Optional

MERCURY_BASE_URL = "https://mercury402.uk"
DEFAULT_ENDPOINT = "/v1/fred/CPIAUCSL"

# ─── helpers ──────────────────────────────────────────────────────────────────

def decode_payment_descriptor(b64_value: str) -> dict:
    """Decode the base64url payment-required header."""
    # Normalize base64url → standard base64
    padded = b64_value.replace("-", "+").replace("_", "/")
    padded += "=" * (4 - len(padded) % 4) if len(padded) % 4 else ""
    raw = base64.b64decode(padded)
    return json.loads(raw)


DEFAULT_HEADERS = {
    "User-Agent": "curl/8.4.0",
    "Accept": "*/*",
}

def http_get(url: str, headers: Optional[dict] = None) -> tuple:
    """Returns (status_code, headers_dict, body_bytes)."""
    merged = {**DEFAULT_HEADERS, **(headers or {})}
    req = urllib.request.Request(url, headers=merged)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def find_bin(name: str) -> Optional[str]:
    """Find a binary on PATH."""
    result = subprocess.run(["which", name], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def run(cmd: list, timeout: int = 60) -> tuple:
    """Run a subprocess, return (returncode, stdout, stderr)."""
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout, result.stderr


# ─── payment backends ─────────────────────────────────────────────────────────

def pay_via_bankr(descriptor: dict) -> Optional[str]:
    """
    Use bankr CLI to send USDC on Base.
    Returns txhash string on success, None on failure.
    """
    amount_raw = int(descriptor["amount"])          # e.g. 150000
    amount_usdc = amount_raw / 1_000_000            # → 0.15
    pay_to = descriptor["payTo"]

    prompt = f"send {amount_usdc} USDC on base to {pay_to}"
    print(f"  [bankr] Sending: {prompt}")

    # bankr prompt outputs job status; poll until done
    rc, stdout, stderr = run(["bankr", "prompt", prompt], timeout=90)
    if rc != 0:
        print(f"  [bankr] ERROR (exit {rc}): {stderr.strip()}")
        return None

    # Extract job ID if present for polling
    job_id_match = re.search(r'job[_\s]?id[:\s]+([a-f0-9\-]{8,})', stdout, re.I)
    tx_match = re.search(r'0x[a-fA-F0-9]{64}', stdout)

    if tx_match:
        txhash = tx_match.group(0)
        print(f"  [bankr] tx hash: {txhash}")
        return txhash

    if job_id_match:
        job_id = job_id_match.group(1)
        print(f"  [bankr] Polling job {job_id} ...")
        for _ in range(10):
            time.sleep(4)
            rc2, out2, _ = run(["bankr", "status", job_id])
            tx2 = re.search(r'0x[a-fA-F0-9]{64}', out2)
            if tx2:
                txhash = tx2.group(0)
                print(f"  [bankr] tx hash: {txhash}")
                return txhash
            if "failed" in out2.lower() or "error" in out2.lower():
                print(f"  [bankr] job failed: {out2.strip()}")
                return None
        print("  [bankr] Job poll timed out after 40s")
        return None

    # bankr might print inline success without job_id
    if "success" in stdout.lower() or "sent" in stdout.lower():
        # No hash found — use timestamp as fallback token component
        print(f"  [bankr] Payment reported success (no txhash extracted)")
        return f"bankr_paid_{int(time.time())}"

    print(f"  [bankr] Unexpected output:\n{stdout[:400]}")
    return None


def pay_via_cast(descriptor: dict) -> Optional[str]:
    """
    Use foundry cast to send USDC ERC20 transfer on Base.
    Requires WALLET_PRIVATE_KEY env var OR a cast wallet configured.
    Returns txhash on success, None on failure.
    """
    amount_raw = descriptor["amount"]       # e.g. "150000"
    token_addr = descriptor["asset"]        # USDC on Base
    pay_to = descriptor["payTo"]
    chain_id = descriptor["network"].split(":")[-1]  # "8453"

    private_key = os.environ.get("WALLET_PRIVATE_KEY", "").strip()
    if not private_key:
        print("  [cast] WALLET_PRIVATE_KEY not set — cannot send via cast")
        return None

    # ERC20 transfer(address,uint256) = 0xa9059cbb
    cmd = [
        "cast", "send", token_addr,
        "transfer(address,uint256)", pay_to, str(amount_raw),
        "--private-key", private_key,
        "--chain", chain_id,
        "--rpc-url", f"https://mainnet.base.org",
        "--json"
    ]
    print(f"  [cast] Sending {amount_raw} (6-dec) USDC on chain {chain_id} to {pay_to}")
    rc, stdout, stderr = run(cmd, timeout=60)
    if rc != 0:
        print(f"  [cast] ERROR: {stderr.strip()}")
        return None

    try:
        result = json.loads(stdout)
        txhash = result.get("transactionHash", "")
        if txhash:
            print(f"  [cast] tx hash: {txhash}")
            return txhash
    except json.JSONDecodeError:
        pass

    tx_match = re.search(r'0x[a-fA-F0-9]{64}', stdout)
    if tx_match:
        return tx_match.group(0)

    print(f"  [cast] Unexpected output: {stdout[:300]}")
    return None


# ─── main logic ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Headless x402 pay-and-retry for Mercury402")
    parser.add_argument("--url", default=f"{MERCURY_BASE_URL}{DEFAULT_ENDPOINT}",
                        help="Paid endpoint URL (default: FRED CPIAUCSL)")
    parser.add_argument("--pay", action="store_true",
                        help="Actually execute the payment (omit for dry-run)")
    args = parser.parse_args()

    # Also accept APPROVE_PAYMENT env var (matches user convention)
    approve = args.pay or os.environ.get("APPROVE_PAYMENT", "").strip().lower() in ("1", "true", "yes")

    target_url = args.url

    print(f"\n{'='*60}")
    print(f"x402 Headless Pay-and-Retry")
    print(f"Endpoint : {target_url}")
    print(f"Mode     : {'PAYMENT' if approve else 'DRY-RUN (pass --pay to execute)'}")
    print(f"{'='*60}\n")

    # ── STEP 1: Unpaid request ─────────────────────────────────────────────────
    print("STEP 1 — Unpaid request (expect HTTP 402) ...")
    status, resp_headers, body = http_get(target_url)

    if status != 402:
        if status == 200:
            print(f"  HTTP {status} — endpoint returned 200 without payment (check server config)")
        else:
            print(f"  HTTP {status} — unexpected status, body: {body[:200]}")
        sys.exit(1)

    print(f"  HTTP {status} — payment required ✓")

    # ── STEP 2: Decode descriptor ──────────────────────────────────────────────
    pr_header = None
    for k, v in resp_headers.items():
        if k.lower() == "payment-required":
            pr_header = v
            break

    if not pr_header:
        print("  ERROR: no payment-required header found")
        sys.exit(1)

    descriptor = decode_payment_descriptor(pr_header)

    amount_raw = int(descriptor["amount"])
    amount_usdc = amount_raw / 1_000_000
    chain_id = descriptor["network"].split(":")[-1]

    print("\nSTEP 2 — Payment descriptor:")
    print(f"  network       : {descriptor['network']} (chain {chain_id})")
    print(f"  asset         : {descriptor['asset']}  (USDC on Base)")
    print(f"  payTo         : {descriptor['payTo']}")
    print(f"  amount (raw)  : {descriptor['amount']}  (6-dec USDC)")
    print(f"  amount (USDC) : ${amount_usdc:.6f}")
    print(f"  timeout       : {descriptor.get('maxTimeoutSeconds', '?')}s")

    # Also parse body for paymentUri
    try:
        body_json = json.loads(body)
        if "paymentUri" in body_json:
            print(f"  paymentUri    : {body_json['paymentUri']}")
            print(f"  (x402.io is optional — this script does NOT call x402.io)")
    except Exception:
        pass

    # ── STEP 3: Detect wallet tooling ─────────────────────────────────────────
    print("\nSTEP 3 — Detecting wallet tooling ...")
    bankr_bin = find_bin("bankr")
    cast_bin = find_bin("cast")

    if bankr_bin:
        print(f"  bankr : {bankr_bin}  ✓  (preferred)")
    else:
        print(f"  bankr : NOT FOUND")

    if cast_bin:
        key_set = bool(os.environ.get("WALLET_PRIVATE_KEY", "").strip())
        print(f"  cast  : {cast_bin}  {'✓' if key_set else '(WALLET_PRIVATE_KEY not set)'}  (fallback)")
    else:
        print(f"  cast  : NOT FOUND")

    if not bankr_bin and not cast_bin:
        print("\n  BLOCKED: No payment tooling found.")
        print("  Install bankr: npm i -g @bankr/cli")
        print("  Install cast:  curl -L https://foundry.paradigm.xyz | bash && foundryup")
        sys.exit(2)

    # ── STEP 4: Payment (if approved) ─────────────────────────────────────────
    if not approve:
        print(f"\nDRY-RUN COMPLETE — all checks passed.")
        print(f"To execute payment of ${amount_usdc:.2f} USDC on Base:")
        print(f"  python3 {sys.argv[0]} --pay")
        print(f"  (or set APPROVE_PAYMENT=1)")
        sys.exit(0)

    print(f"\nSTEP 4 — Sending ${amount_usdc:.2f} USDC on Base to {descriptor['payTo']} ...")

    txhash = None
    if bankr_bin:
        txhash = pay_via_bankr(descriptor)
    if not txhash and cast_bin:
        print("  Falling back to cast ...")
        txhash = pay_via_cast(descriptor)

    if not txhash:
        print("\n  PAYMENT FAILED — see errors above")
        sys.exit(1)

    # ── STEP 5: Derive Authorization token ────────────────────────────────────
    # Server currently accepts any x402_<non-test> bearer token (TODO: ledger validation)
    # Convention: x402_txhash_prefix so logs are traceable
    token_suffix = txhash.replace("0x", "")[:16] if txhash.startswith("0x") else txhash[:20]
    auth_token = f"x402_{token_suffix}"
    print(f"\nSTEP 5 — Authorization token: Bearer {auth_token}")

    # ── STEP 6: Paid retry ────────────────────────────────────────────────────
    print("\nSTEP 6 — Retrying paid endpoint ...")
    status2, _, body2 = http_get(target_url, {"Authorization": f"Bearer {auth_token}"})
    print(f"  HTTP {status2}")

    if status2 == 200:
        print("  PAYMENT SUCCESS ✓")
        try:
            body2_json = json.loads(body2)
            preview = json.dumps(body2_json, indent=2)[:300]
            print(f"\nResponse (first 300 chars):\n{preview}")
        except Exception:
            print(f"\nResponse: {body2[:300]}")
        sys.exit(0)
    else:
        print(f"  UNEXPECTED STATUS {status2}")
        print(f"  Body: {body2[:300]}")
        sys.exit(1)


if __name__ == "__main__":
    main()
