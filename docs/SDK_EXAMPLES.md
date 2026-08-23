# Mercury x402 — SDK Examples

Base URL: `https://api.mercury402.com`

**Payment details**
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- payTo: `0xF8d59270cBC746a7593D25b6569812eF1681C6D2`

---

## Important

Production Mercury expects the `payment-signature` header.
Unsigned manually constructed `Authorization: Bearer x402_<token>` flows are deprecated and rejected in production.

---

## Node.js (native fetch, no dependencies)

### Unpaid request, inspect the 402

```js
const res = await fetch('https://api.mercury402.com/v1/fred/UNRATE');

if (res.status === 402) {
  const body = await res.json();
  console.log('Payment required');
  console.log('Accepts:', body.accepts);
  console.log('Payment-Required header:', res.headers.get('payment-required'));

  const descriptor = JSON.parse(
    Buffer.from(res.headers.get('payment-required'), 'base64url').toString('utf8')
  );

  console.log(descriptor);
}
```

### Paid request with `payment-signature`

```js
const PAYMENT_SIGNATURE = '<base64_x402_payment_payload>';

const res = await fetch('https://api.mercury402.com/v1/fred/UNRATE', {
  headers: { 'payment-signature': PAYMENT_SIGNATURE }
});

if (!res.ok) throw new Error(`Unexpected status ${res.status}`);

const { data, provenance } = await res.json();
console.log('Series:', data.series_id);
console.log('Latest observation:', data.observations[0]);
console.log('Signature:', provenance.signature);
```

### Axios

```js
const axios = require('axios');
const PAYMENT_SIGNATURE = '<base64_x402_payment_payload>';

async function fetchFred(seriesId) {
  try {
    const { data } = await axios.get(
      `https://api.mercury402.com/v1/fred/${seriesId}`,
      { headers: { 'payment-signature': PAYMENT_SIGNATURE } }
    );
    return data;
  } catch (err) {
    if (err.response?.status === 402) {
      console.error('Payment required:', err.response.data.accepts);
      console.error('Descriptor:', err.response.headers['payment-required']);
    }
    throw err;
  }
}
```

---

## Python (requests)

### Unpaid request, inspect the 402

```python
import base64, json, requests

r = requests.get('https://api.mercury402.com/v1/fred/UNRATE')

if r.status_code == 402:
    body = r.json()
    print('Payment required')
    print('Accepts:', body['accepts'])
    raw = r.headers.get('Payment-Required', '')
    padded = raw + '=' * (-len(raw) % 4)
    descriptor = json.loads(base64.urlsafe_b64decode(padded))
    print(json.dumps(descriptor, indent=2))
```

### Paid request with `payment-signature`

```python
import requests

PAYMENT_SIGNATURE = '<base64_x402_payment_payload>'
HEADERS = {'payment-signature': PAYMENT_SIGNATURE}

r = requests.get(
    'https://api.mercury402.com/v1/treasury/yield-curve/daily-snapshot',
    headers=HEADERS
)
r.raise_for_status()

payload = r.json()
rates = payload['data']['rates']
prov = payload['provenance']

print(f"Date:      {payload['data']['record_date']}")
print(f"10Y yield: {rates['10_YEAR']}%")
print(f"2Y yield:  {rates['2_YEAR']}%")
print(f"Signature: {prov['signature']}")
```

---

## Endpoints reference

| Endpoint | Price | amount (μUSDC) |
|----------|-------|----------------|
| `/v1/fred/{series_id}` | $0.05 | 50000 |
| `/v1/treasury/yield-curve/daily-snapshot` | $0.05 | 50000 |

Popular FRED series IDs: `UNRATE`, `GDP`, `CPIAUCSL`, `FEDFUNDS`, `DGS10`.

---

## Discovery

```sh
curl https://api.mercury402.com/.well-known/x402 | jq .
curl https://api.mercury402.com/meta.json | jq .
```

---
*Last updated: 2026-04-20 22:53 ET | Updated by: Forge*
