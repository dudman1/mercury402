# Mercury402 Integration Guide for x402 Agents

## Quick Start

Mercury402 provides deterministic financial data via x402 micropayments. No API keys, no rate limits - just pay per call.

### Discovery

Your agent can auto-discover Mercury402 via the x402 marketplace:

```bash
curl https://mercury402.uk/.well-known/x402
```

### Available Endpoints

#### 1. US Treasury Yield Curve ($0.10)
```
GET https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot
```

Returns complete Treasury par yield curve with cryptographic provenance.

**Response:**
```json
{
  "data": {
    "date": "2026-03-03",
    "yields": {
      "1mo": "4.25",
      "3mo": "4.30",
      "6mo": "4.35",
      "1yr": "4.40",
      "2yr": "4.45",
      "3yr": "4.48",
      "5yr": "4.52",
      "7yr": "4.55",
      "10yr": "4.58",
      "20yr": "4.62",
      "30yr": "4.65"
    }
  },
  "provenance": {
    "source": "U.S. Department of the Treasury",
    "source_url": "https://home.treasury.gov/...",
    "fetched_at": "2026-03-03T16:00:00.000Z",
    "signature": "0x..."
  }
}
```

#### 2. FRED Economic Data ($0.15 single, $0.30 range)
```
GET https://mercury402.uk/v1/fred/{series_id}
```

Access any of 800,000+ Federal Reserve economic series.

**Popular series:**
- `GDP` - Gross Domestic Product
- `UNRATE` - Unemployment Rate
- `CPIAUCSL` - Consumer Price Index
- `FEDFUNDS` - Federal Funds Rate
- `DGS10` - 10-Year Treasury Yield

**Examples:**
```bash
# Latest unemployment rate
GET /v1/fred/UNRATE

# CPI on specific date
GET /v1/fred/CPIAUCSL?date=2026-01-01

# GDP range (costs $0.30)
GET /v1/fred/GDP?observation_start=2025-01-01&observation_end=2026-01-01
```

#### 3. Economic Dashboard ($0.50)
```
GET https://mercury402.uk/v1/composite/economic-dashboard
```

Get GDP, CPI, and Unemployment in one composite call.

**Response:**
```json
{
  "data": {
    "dashboard": "economic-overview",
    "timestamp": "2026-03-03T16:00:00.000Z",
    "indicators": [
      {
        "series_id": "GDP",
        "title": "Gross Domestic Product",
        "value": "28,500",
        "date": "2025-Q4",
        "units": "Billions of Dollars"
      },
      {
        "series_id": "CPIAUCSL",
        "title": "Consumer Price Index",
        "value": "315.2",
        "date": "2026-02-01",
        "units": "Index 1982-1984=100"
      },
      {
        "series_id": "UNRATE",
        "title": "Unemployment Rate",
        "value": "4.1",
        "date": "2026-02-01",
        "units": "Percent"
      }
    ]
  },
  "provenance": { ... }
}
```

#### 4. Inflation Tracker ($0.40)
```
GET https://mercury402.uk/v1/composite/inflation-tracker
```

Get CPI, PCE, and Core CPI inflation metrics.

#### 5. Labor Market ($0.40)
```
GET https://mercury402.uk/v1/composite/labor-market
```

Get Unemployment, Jobless Claims, and Nonfarm Payrolls.

## x402 Payment Flow

### 1. Initial Request (402 Payment Required)

```bash
curl -i https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot
```

**Response:**
```
HTTP/2 402 Payment Required
X-Accept-Payment: x402 [BASE64_PAYMENT_INFO]

{
  "error": {
    "code": "PAYMENT_REQUIRED",
    "message": "Payment required to access this endpoint"
  }
}
```

### 2. Parse Payment Info

Decode the `X-Accept-Payment` header:

```javascript
const paymentInfo = JSON.parse(
  Buffer.from(base64url, 'base64url').toString()
);

// {
//   "scheme": "exact",
//   "network": "eip155:8453",  // Base mainnet
//   "amount": "100000",         // 0.10 USDC (6 decimals)
//   "payTo": "0xF8d59270cBC746a7593D25b6569812eF1681C6D2",
//   "maxTimeoutSeconds": 30,
//   "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // USDC on Base
// }
```

### 3. Submit Payment

Transfer USDC on Base to the `payTo` address using EIP-3009 (transferWithAuthorization) or standard ERC20 transfer.

### 4. Get x402 Token

After payment confirmation, call the payment processor to get your x402 token:

```bash
curl -X POST https://payment-processor/get-token \
  -H "Content-Type: application/json" \
  -d '{"txHash": "0x..."}'
```

**Response:**
```json
{
  "x402_token": "x402_ABC123..."
}
```

### 5. Access Endpoint with Token

```bash
curl https://mercury402.uk/v1/treasury/yield-curve/daily-snapshot \
  -H "Authorization: Bearer x402_ABC123..."
```

**Response:**
```
HTTP/2 200 OK
X-Mercury-Price: $0.10

{
  "data": { ... },
  "provenance": { ... }
}
```

## Integration Examples

### Python
```python
import requests
import json
import base64

def fetch_mercury_data(endpoint):
    url = f"https://mercury402.uk{endpoint}"
    
    # Initial request
    response = requests.get(url)
    
    if response.status_code == 402:
        # Parse payment info
        payment_header = response.headers.get('X-Accept-Payment')
        payment_info = json.loads(
            base64.urlsafe_b64decode(payment_header.split()[1] + '==')
        )
        
        # Submit payment (your payment logic here)
        tx_hash = submit_payment(payment_info)
        
        # Get x402 token
        token = get_x402_token(tx_hash)
        
        # Retry with token
        response = requests.get(url, headers={
            'Authorization': f'Bearer {token}'
        })
    
    return response.json()

# Usage
data = fetch_mercury_data('/v1/treasury/yield-curve/daily-snapshot')
print(data)
```

### TypeScript
```typescript
async function fetchMercuryData(endpoint: string) {
  const url = `https://mercury402.uk${endpoint}`;
  
  let response = await fetch(url);
  
  if (response.status === 402) {
    const paymentHeader = response.headers.get('X-Accept-Payment');
    const paymentInfo = JSON.parse(
      Buffer.from(paymentHeader.split(' ')[1], 'base64url').toString()
    );
    
    // Submit payment
    const txHash = await submitPayment(paymentInfo);
    
    // Get token
    const token = await getX402Token(txHash);
    
    // Retry with token
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
  }
  
  return response.json();
}
```

## Why Mercury402?

### Deterministic Data
Every response includes cryptographic signatures proving data integrity and source attribution.

### No Subscriptions
Pay only for what you use. No monthly fees, no API key management.

### Agent-Native
Built for autonomous agents operating in x402 micropayment ecosystems.

### Low Cost
- Treasury data: $0.10/call
- Single FRED series: $0.15/call
- FRED date range: $0.30/call
- Composite dashboards: $0.40-$0.50/call

### Base Mainnet
Settlement on Base (chain ID 8453) for minimal gas fees.

## Support

- **Website:** https://mercury402.uk
- **Discovery:** https://mercury402.uk/.well-known/x402
- **Marketplace:** https://www.x402scan.com/server/mercury402
- **X/Twitter:** @Mercuryclaw1

## Example Use Cases

### Trading Bots
```python
# Get latest unemployment data before trading decision
unemployment = fetch_mercury_data('/v1/fred/UNRATE')
if unemployment['data']['observations'][0]['value'] > threshold:
    execute_trade('defensive')
```

### Economic Analysis Agents
```python
# Pull comprehensive economic snapshot
dashboard = fetch_mercury_data('/v1/composite/economic-dashboard')
analyze_macro_conditions(dashboard['data'])
```

### Yield Curve Analysis
```python
# Track yield curve inversions
yields = fetch_mercury_data('/v1/treasury/yield-curve/daily-snapshot')
if yields['data']['yields']['2yr'] > yields['data']['yields']['10yr']:
    alert_recession_signal()
```

### Multi-Agent Research
```python
# Coordinate economic data collection across agent swarm
inflation = fetch_mercury_data('/v1/composite/inflation-tracker')
labor = fetch_mercury_data('/v1/composite/labor-market')
treasury = fetch_mercury_data('/v1/treasury/yield-curve/daily-snapshot')

synthesize_market_outlook(inflation, labor, treasury)
```

---

**Built for the x402 ecosystem. Deterministic. Verifiable. Agent-native.**
