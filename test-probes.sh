#!/usr/bin/env bash

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4020}"
CURL_BIN="${CURL_BIN:-$(command -v curl || echo /usr/bin/curl)}"

pass=0
fail=0
total=0

probe() {
  local name="$1"
  local expected_method="$2"
  local path="$3"
  shift 3

  total=$((total + 1))
  local status
  if [[ "$expected_method" == "HEAD" ]]; then
    status="$("$CURL_BIN" -sS -I -o /dev/null -w '%{http_code}' "$@" "${BASE_URL}${path}")"
  else
    status="$("$CURL_BIN" -sS -o /dev/null -w '%{http_code}' -X "$expected_method" "$@" "${BASE_URL}${path}")"
  fi

  if [[ "$status" != "402" ]]; then
    echo "FAIL ${expected_method} ${path} (${name}) -> ${status}"
    fail=$((fail + 1))
    return 1
  fi

  echo "PASS ${expected_method} ${path} (${name}) -> 402"
  pass=$((pass + 1))
}

echo "=== Mercury402 Probe Suite ==="
echo "Base: ${BASE_URL}"
echo ""

# ── Original 9 endpoints ──
echo "--- Original Endpoints ---"
probe "fred" "GET" "/v1/fred/UNRATE"
probe "treasury-daily-snapshot" "GET" "/v1/treasury/yield-curve/daily-snapshot"
probe "economic-dashboard" "GET" "/v1/composite/economic-dashboard"
probe "inflation-tracker" "GET" "/v1/composite/inflation-tracker"
probe "labor-market" "GET" "/v1/composite/labor-market"
probe "macro-snapshot" "GET" "/v1/macro/snapshot/all"
probe "treasury-historical-probe-get" "GET" "/v1/treasury/yield-curve/historical"
probe "treasury-historical-probe-head" "HEAD" "/v1/treasury/yield-curve/historical"
probe "treasury-historical" "POST" "/v1/treasury/yield-curve/historical" -H 'Content-Type: application/json' --data '{}'
probe "treasury-auction-results" "GET" "/v1/treasury/auction-results/recent"
probe "treasury-tips-rates" "GET" "/v1/treasury/tips-rates/current"

# ── Named FRED Series (40+ endpoints) ──
echo ""
echo "--- Named FRED Series ---"
probe "cpi" "GET" "/v1/fred/cpi"
probe "cpi-core" "GET" "/v1/fred/cpi-core"
probe "ppi" "GET" "/v1/fred/ppi"
probe "pce" "GET" "/v1/fred/pce"
probe "pce-core" "GET" "/v1/fred/pce-core"
probe "pce-deflator" "GET" "/v1/fred/pce-deflator"
probe "unemployment-rate" "GET" "/v1/fred/unemployment-rate"
probe "nonfarm-payrolls" "GET" "/v1/fred/nonfarm-payrolls"
probe "initial-claims" "GET" "/v1/fred/initial-claims"
probe "continuing-claims" "GET" "/v1/fred/continuing-claims"
probe "labor-force-participation" "GET" "/v1/fred/labor-force-participation"
probe "average-hourly-earnings" "GET" "/v1/fred/average-hourly-earnings"
probe "jolts-openings" "GET" "/v1/fred/jolts-openings"
probe "quits-rate" "GET" "/v1/fred/quits-rate"
probe "u6-unemployment" "GET" "/v1/fred/u6-unemployment"
probe "gdp" "GET" "/v1/fred/gdp"
probe "gdp-growth" "GET" "/v1/fred/gdp-growth"
probe "gdi" "GET" "/v1/fred/gdi"
probe "gdp-deflator" "GET" "/v1/fred/gdp-deflator"
probe "corporate-profits" "GET" "/v1/fred/corporate-profits"
probe "m1-money-stock" "GET" "/v1/fred/m1-money-stock"
probe "m2-money-stock" "GET" "/v1/fred/m2-money-stock"
probe "fed-funds-rate" "GET" "/v1/fred/fed-funds-rate"
probe "fed-funds-target-upper" "GET" "/v1/fred/fed-funds-target-upper"
probe "treasury-3m" "GET" "/v1/fred/treasury-3m"
probe "treasury-2y" "GET" "/v1/fred/treasury-2y"
probe "treasury-5y" "GET" "/v1/fred/treasury-5y"
probe "treasury-10y" "GET" "/v1/fred/treasury-10y"
probe "treasury-30y" "GET" "/v1/fred/treasury-30y"
probe "mortgage-30y" "GET" "/v1/fred/mortgage-30y"
probe "bbb-corporate-yield" "GET" "/v1/fred/bbb-corporate-yield"
probe "high-yield-spread" "GET" "/v1/fred/high-yield-spread"
probe "a-rated-spread" "GET" "/v1/fred/a-rated-spread"
probe "consumer-confidence" "GET" "/v1/fred/consumer-confidence"
probe "conference-board-ci" "GET" "/v1/fred/conference-board-ci"
probe "inflation-expectations" "GET" "/v1/fred/inflation-expectations"
probe "leading-indicators" "GET" "/v1/fred/leading-indicators"
probe "trade-balance" "GET" "/v1/fred/trade-balance"
probe "current-account" "GET" "/v1/fred/current-account"
probe "housing-starts" "GET" "/v1/fred/housing-starts"
probe "building-permits" "GET" "/v1/fred/building-permits"
probe "existing-home-sales" "GET" "/v1/fred/existing-home-sales"
probe "case-shiller" "GET" "/v1/fred/case-shiller"
probe "homeownership-rate" "GET" "/v1/fred/homeownership-rate"
probe "industrial-production" "GET" "/v1/fred/industrial-production"
probe "retail-sales" "GET" "/v1/fred/retail-sales"
probe "personal-income" "GET" "/v1/fred/personal-income"
probe "personal-saving-rate" "GET" "/v1/fred/personal-saving-rate"
probe "total-vehicle-sales" "GET" "/v1/fred/total-vehicle-sales"
probe "federal-debt" "GET" "/v1/fred/federal-debt"
probe "federal-deficit" "GET" "/v1/fred/federal-deficit"
probe "vix" "GET" "/v1/fred/vix"

# ── Forex Cross-Rates ──
echo ""
echo "--- Forex Cross-Rates ---"
probe "eur-usd" "GET" "/v1/forex/eur-usd"
probe "gbp-usd" "GET" "/v1/forex/gbp-usd"
probe "usd-jpy" "GET" "/v1/forex/usd-jpy"
probe "usd-cny" "GET" "/v1/forex/usd-cny"

# ── Yield Curve Spreads ──
echo ""
echo "--- Yield Curve Spreads ---"
probe "spread-10y-2y" "GET" "/v1/yield-spread/10y-2y"
probe "spread-10y-3m" "GET" "/v1/yield-spread/10y-3m"
probe "spread-5y-2y" "GET" "/v1/yield-spread/5y-2y"
probe "spread-30y-5y" "GET" "/v1/yield-spread/30y-5y"
probe "spread-10y-5y" "GET" "/v1/yield-spread/10y-5y"

# ── Breakeven Inflation ──
echo ""
echo "--- Breakeven Inflation ---"
probe "breakeven-5y" "GET" "/v1/breakeven/5y"
probe "breakeven-10y" "GET" "/v1/breakeven/10y"
probe "breakeven-2y" "GET" "/v1/breakeven/2y"
probe "breakeven-5y5y" "GET" "/v1/breakeven/5y5y"

# ── Premium Endpoints ──
echo ""
echo "--- Premium Endpoints ---"
probe "macro-bundle" "GET" "/v1/macro/bundle"
probe "recession-probability" "GET" "/v1/macro/recession-probability"

# ── Summary ──
echo ""
echo "=== Results: ${pass} PASS, ${fail} FAIL, ${total} TOTAL ==="

if [[ $fail -gt 0 ]]; then
  exit 1
fi
