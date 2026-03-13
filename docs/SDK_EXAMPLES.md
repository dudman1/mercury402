# Mercury x402 — SDK Examples

Base URL: `https://mercury402.uk`

**Payment details**
- USDC on Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- payTo: `0xF8d59270cBC746a7593D25b6569812eF1681C6D2`

---

## Node.js (native fetch — no dependencies)

### Unpaid request — observe the 402

```js
const res = await fetch('https://mercury402.uk/v1/fred/UNRATE');

if (res.status === 402) {
  const body = await res.json();
  console.log('Payment required');
  console.log('Price:', body.price);          // "$0.01 USDC (Base)"
  console.log('Pay at:', body.paymentUri);
  console.log('Payment-Required header:', res.headers.get('payment-required'));
  // Decode the payment descriptor:
  // Buffer.from(res.headers.get('payment-required'), 'base64').toString()
}
```

### Paid request

```js
const TOKEN = 'x402_YOUR_TOKEN_HERE';

const res = await fetch('https://mercury402.uk/v1/fred/UNRATE', {
  headers: { Authorization: `Bearer ${TOKEN}` }
});

if (!res.ok) throw new Error(`Unexpected status ${res.status}`);

const { data, provenance } = await res.json();

console.log('Series:', data.series_id);
console.log('Latest observation:', data.observations[0]);
console.log('Signed by Mercury at:', provenance.fetched_at);
console.log('Signature:', provenance.signature);
```

### Treasury yield curve (paid)

```js
const TOKEN = 'x402_YOUR_TOKEN_HERE';

const res = await fetch(
  'https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot',
  { headers: { Authorization: `Bearer ${TOKEN}` } }
);

const { data, provenance } = await res.json();

console.log('Record date:', data.record_date);
console.log('10Y:', data.rates['10_YEAR']);
console.log('Signature:', provenance.signature);
```

---

## Node.js (axios)

```js
const axios = require('axios');

const TOKEN = 'x402_YOUR_TOKEN_HERE';

async function fetchFred(seriesId) {
  try {
    const { data } = await axios.get(
      `https://mercury402.uk/v1/fred/${seriesId}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } }
    );
    return data;
  } catch (err) {
    if (err.response?.status === 402) {
      console.error('Payment required:', err.response.data.price);
      console.error('Pay at:', err.response.data.paymentUri);
    }
    throw err;
  }
}

const result = await fetchFred('UNRATE');
console.log(result.data.observations[0]);
```

---

## Python (requests)

### Unpaid request — observe the 402

```python
import requests

r = requests.get('https://mercury402.uk/v1/fred/UNRATE')

if r.status_code == 402:
    body = r.json()
    print('Payment required')
    print('Price:', body['price'])           # "$0.01 USDC (Base)"
    print('Pay at:', body['paymentUri'])
    print('Payment-Required header:', r.headers.get('Payment-Required'))
```

### Paid request — FRED series

```python
import requests

TOKEN = 'x402_YOUR_TOKEN_HERE'
HEADERS = {'Authorization': f'Bearer {TOKEN}'}

r = requests.get(
    'https://mercury402.uk/v1/fred/UNRATE',
    headers=HEADERS
)
r.raise_for_status()

payload = r.json()
data = payload['data']
provenance = payload['provenance']

print(f"Series:     {data['series_id']}")
print(f"Latest obs: {data['observations'][0]}")
print(f"Fetched at: {provenance['fetched_at']}")
print(f"Signature:  {provenance['signature']}")
```

### Paid request — Treasury yield curve

```python
import requests

TOKEN = 'x402_YOUR_TOKEN_HERE'
HEADERS = {'Authorization': f'Bearer {TOKEN}'}

r = requests.get(
    'https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot',
    headers=HEADERS
)
r.raise_for_status()

payload = r.json()
rates  = payload['data']['rates']
prov   = payload['provenance']

print(f"Date:      {payload['data']['record_date']}")
print(f"10Y yield: {rates['10_YEAR']}%")
print(f"2Y yield:  {rates['2_YEAR']}%")
print(f"Signature: {prov['signature']}")
```

### Decode the Payment-Required header (Python)

```python
import base64, json, requests

r = requests.get('https://mercury402.uk/v1/fred/UNRATE')

if r.status_code == 402:
    raw = r.headers.get('Payment-Required', '')
    # Restore base64 padding
    padded = raw + '=' * (-len(raw) % 4)
    descriptor = json.loads(base64.urlsafe_b64decode(padded))
    print(json.dumps(descriptor, indent=2))
    # {
    #   "scheme": "exact",
    #   "network": "eip155:8453",
    #   "amount": "150000",
    #   "payTo": "0xF8d59270cBC746a7593D25b6569812eF1681C6D2",
    #   "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    # }
```

---

## Endpoints reference

| Endpoint | Price | amount (μUSDC) |
|----------|-------|----------------|
| `/v1/fred/{series_id}` | $0.01 | 10000 |
| `/v1/treasury/yield-curve/daily-snapshot` | $0.02 | 20000 |

Popular FRED series IDs: `UNRATE` (unemployment), `GDP`, `CPIAUCSL` (CPI), `FEDFUNDS` (fed funds rate), `DGS10` (10Y Treasury).

---

## Discovery

```sh
curl https://mercury402.uk/.well-known/x402 | jq .
curl https://mercury402.uk/meta.json | jq .
```
