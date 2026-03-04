# x402 Token Format Research

## Current State

**Token format observed:** `x402_<token_body>`

**Current implementation:**
```javascript
function parsePaymentToken(token) {
  return {
    wallet_address: null,
    tx_hash: null,
    token_id: token
  };
}
```

**Problem:** wallet_address and tx_hash always null → metrics can't track unique buyers

---

## Token Format Hypothesis

### Option 1: JWT (JSON Web Token)

**Format:** `x402_<header>.<payload>.<signature>`

**Payload would contain:**
```json
{
  "wallet": "0x...",
  "tx": "0x...",
  "merchant": "0xF8d59270cBC746...",
  "amount": "20000",
  "network": "eip155:8453",
  "iat": 1709594843,
  "exp": 1709595143
}
```

**Pros:**
- Standard format
- Tamper-proof (signature)
- Expirable

**Cons:**
- Requires verification key
- Heavier payload

---

### Option 2: Base64-encoded JSON

**Format:** `x402_<base64(json)>`

**Payload:**
```json
{
  "wallet": "0x...",
  "tx": "0x...",
  "merchant": "0xF8d59270cBC746...",
  "amount": "20000",
  "network": "8453",
  "timestamp": 1709594843
}
```

**Pros:**
- Simple to decode
- Lightweight

**Cons:**
- No signature (must verify on-chain)
- Easy to forge

---

### Option 3: Custom Binary Format

**Format:** `x402_<hex(binary_data)>`

**Would need spec from x402 protocol maintainers**

---

## Payment Flow (from DEMO-AGENT-REPORT.md)

```
1. CLIENT → SERVER
   GET /v1/treasury/yield-curve/daily-snapshot
   (no Authorization header)

2. SERVER → CLIENT
   HTTP 402 Payment Required
   Payment-Required: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJlaXAxNTU6ODQ1MyIsImFtb3VudCI6IjIwMDAwIiwicGF5VG8iOiIweEY4ZDU5MjcwY0JDNzQ2YTc1OTNEMjViNjU2OTgxMmVGMTY4MUM2RDIiLCJtYXhUaW1lb3V0U2Vjb25kcyI6MzAsImFzc2V0IjoiMHg4MzM1ODlmQ0Q2ZURiNkUwOGY0YzdDMzJENGY3MWI1NGJkQTAyOTEzIn0

3. CLIENT (decode Payment-Required header)
   Base64url → JSON

4. CLIENT → BLOCKCHAIN
   Transfer 0.02 USDC on Base to merchant wallet

5. CLIENT → X402 GATEWAY
   POST https://x402.io/register-payment
   {
     "txHash": "0xabc123...",
     "endpoint": "/v1/treasury/yield-curve/daily-snapshot",
     "merchant": "0xF8d59270cBC746..."
   }

6. X402 GATEWAY → CLIENT
   {
     "token": "x402_abc123456789..."
   }

7. CLIENT → SERVER (retry)
   GET /v1/treasury/yield-curve/daily-snapshot
   Authorization: Bearer x402_abc123456789...
```

**Key insight:** x402 gateway issues token AFTER verifying on-chain payment

---

## What the Token SHOULD Contain

Based on the flow, the x402 gateway has already verified:
- Transaction exists on Base (chain 8453)
- Transaction sends correct amount to correct merchant
- Transaction is confirmed

**Therefore, the token should contain:**
- `wallet_address`: sender of the USDC transfer
- `tx_hash`: the on-chain transaction hash
- `merchant`: recipient (our wallet)
- `amount`: USDC amount (in microunits)
- `endpoint`: which endpoint was paid for (optional)
- `timestamp`: when payment was verified
- `expires`: token expiration (optional)

---

## Implementation Strategy

Since we don't have the x402 gateway spec, we'll implement a **defensive decoder**:

### Step 1: Try JWT decode
```javascript
const jwt = require('jsonwebtoken');
try {
  const payload = jwt.decode(token.replace('x402_', ''));
  if (payload && payload.wallet && payload.tx) {
    return {
      wallet_address: payload.wallet,
      tx_hash: payload.tx,
      wallet_source: 'jwt_claim'
    };
  }
} catch (e) {}
```

### Step 2: Try base64 JSON decode
```javascript
try {
  const body = token.replace('x402_', '');
  const json = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  if (json.wallet && json.tx) {
    return {
      wallet_address: json.wallet,
      tx_hash: json.tx,
      wallet_source: 'base64_claim'
    };
  }
} catch (e) {}
```

### Step 3: Check for hex-encoded data
```javascript
try {
  const body = token.replace('x402_', '');
  const hex = Buffer.from(body, 'hex').toString('utf8');
  const json = JSON.parse(hex);
  if (json.wallet && json.tx) {
    return {
      wallet_address: json.wallet,
      tx_hash: json.tx,
      wallet_source: 'hex_claim'
    };
  }
} catch (e) {}
```

### Step 4: Fallback
```javascript
return {
  wallet_address: null,
  tx_hash: null,
  token_id: token,
  wallet_source: 'unparseable'
};
```

---

## On-Chain Verification

**To fully verify payment:**
1. Decode token to get wallet + tx_hash
2. Query Base RPC endpoint for transaction details
3. Verify:
   - Transaction exists and is confirmed
   - Sender matches claimed wallet
   - Recipient is our merchant wallet
   - Amount matches endpoint price
   - Asset is USDC contract

**Base RPC endpoint:** `https://mainnet.base.org`  
(Public RPC, free, rate-limited)

**Alternative:** Alchemy, Infura, QuickNode (paid, higher limits)

**Cost:** 1 RPC call per payment = ~$0.0001-0.001 depending on provider

---

## Recommendation

**Phase 1 (This commit):**
- Implement multi-format token decoder
- Log wallet_address and tx_hash when available
- Mark as `wallet_source: "token_claim"` (unverified)
- Update metrics to track unique wallets
- Update Convex emit with wallet_address

**Phase 2 (Future):**
- Add on-chain verification via Base RPC
- Only mark as `wallet_source: "bridge_verified"` after RPC check
- Cache verified tx_hashes to avoid re-checking
- Add /metrics field: `bridge_verified_pct`

**Phase 3 (x402 Gateway Integration):**
- If/when x402 gateway provides a verification API:
  - Call `GET https://x402.io/verify-token?token=x402_...`
  - Get back verified payment metadata
  - Replace custom decoder with official SDK

---

## Next Steps

1. Implement defensive token decoder (JWT → base64 → hex → fallback)
2. Test with real x402 tokens (if available)
3. Log all decode attempts for debugging
4. Update metrics + Convex emit
5. Document what we observe in production

---

**END OF RESEARCH**
