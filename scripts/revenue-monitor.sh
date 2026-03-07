#!/bin/bash
# Mercury402 Revenue Monitor
# Parses revenue ledger and reports metrics

LEDGER="/Users/openclaw/.openclaw/LEDGER/mercury402-revenue.jsonl"

# Check if ledger exists
if [ ! -f "$LEDGER" ]; then
    echo "📊 Mercury402 Revenue: No data yet (ledger not found)"
    exit 0
fi

# Check if ledger is empty
if [ ! -s "$LEDGER" ]; then
    echo "📊 Mercury402 Revenue: No transactions yet"
    exit 0
fi

# Calculate metrics (verified payments only)
TOTAL_REVENUE=$(cat "$LEDGER" | jq -r 'select(.verified == true) | .amount' | awk '{sum+=$1} END {print sum}')
TOTAL_CALLS=$(cat "$LEDGER" | jq -r 'select(.verified == true)' | wc -l | tr -d ' ')
UNIQUE_CUSTOMERS=$(cat "$LEDGER" | jq -r 'select(.verified == true) | .customer' | sort -u | wc -l | tr -d ' ')

# Today's revenue (last 24 hours, verified only)
YESTERDAY_TS=$(($(date +%s) - 86400))
TODAY_REVENUE=$(cat "$LEDGER" | jq -r "select(.verified == true and .timestamp/1000 > $YESTERDAY_TS) | .amount" | awk '{sum+=$1} END {print sum}')

# This week's revenue (last 7 days, verified only)
WEEK_AGO_TS=$(($(date +%s) - 604800))
WEEK_REVENUE=$(cat "$LEDGER" | jq -r "select(.verified == true and .timestamp/1000 > $WEEK_AGO_TS) | .amount" | awk '{sum+=$1} END {print sum}')

# Most popular endpoint (verified only)
TOP_ENDPOINT=$(cat "$LEDGER" | jq -r 'select(.verified == true) | .endpoint' | sort | uniq -c | sort -rn | head -1 | awk '{print $2, "("$1" calls)"}')

# Format output
echo "📊 Mercury402 Revenue Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "💰 Total Revenue: \$${TOTAL_REVENUE:-0}"
echo "📞 Total API Calls: ${TOTAL_CALLS}"
echo "👥 Unique Customers: ${UNIQUE_CUSTOMERS}"
echo ""
echo "📅 Last 24h: \$${TODAY_REVENUE:-0}"
echo "📆 Last 7d: \$${WEEK_REVENUE:-0}"
echo ""
echo "🔥 Top Endpoint: ${TOP_ENDPOINT}"
