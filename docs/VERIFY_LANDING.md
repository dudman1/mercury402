# Landing Page Verification

Run these commands to confirm all routes behave correctly after deployment.

## Browser client → HTML landing page
```sh
curl -H "Accept: text/html" https://mercury402.uk/
```
Expected: HTML response starting with `<!DOCTYPE html>`, title "Mercury x402".

## Machine client → JSON manifest (backwards-compatible)
```sh
curl -H "Accept: application/json" https://mercury402.uk/ | jq .
```
Expected JSON:
```json
{
  "name": "Mercury x402",
  "tagline": "Deterministic financial data with cryptographic provenance",
  "version": "1.0.0",
  "endpoints": { ... }
}
```

## /meta.json always returns JSON manifest
```sh
curl https://mercury402.uk/meta.json | jq .
```
Expected: same JSON as above.

## /docs returns HTML quickstart
```sh
curl -H "Accept: text/html" https://mercury402.uk/docs | head -5
```
Expected: `<!DOCTYPE html>` … `Mercury x402 — Quickstart`.

## x402 discovery unchanged
```sh
curl https://mercury402.uk/.well-known/x402 | jq '.x402Version, .accepts[].payTo'
```
Expected:
```
2
"0xF8d59270cBC746a7593D25b6569812eF1681C6D2"
"0xF8d59270cBC746a7593D25b6569812eF1681C6D2"
```

## Health unchanged
```sh
curl https://mercury402.uk/health | jq .status
```
Expected: `"healthy"`
