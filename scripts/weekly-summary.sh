#!/bin/bash
# Mercury402 Weekly Summary - Posts to X as @Mercuryclaw1

LEDGER="/Users/openclaw/.openclaw/LEDGER/mercury402-revenue.jsonl"

if [ ! -f "$LEDGER" ] || [ ! -s "$LEDGER" ]; then
    echo "No revenue data to report"
    exit 0
fi

# Last 7 days metrics
WEEK_AGO_TS=$(($(date +%s) - 604800))
WEEK_REVENUE=$(cat "$LEDGER" | jq -r "select(.timestamp/1000 > $WEEK_AGO_TS) | .amount" | awk '{sum+=$1} END {printf "%.2f", sum}')
WEEK_CALLS=$(cat "$LEDGER" | jq -r "select(.timestamp/1000 > $WEEK_AGO_TS)" | wc -l | tr -d ' ')
WEEK_CUSTOMERS=$(cat "$LEDGER" | jq -r "select(.timestamp/1000 > $WEEK_AGO_TS) | .customer" | sort -u | wc -l | tr -d ' ')
TOP_ENDPOINT=$(cat "$LEDGER" | jq -r "select(.timestamp/1000 > $WEEK_AGO_TS) | .endpoint" | sort | uniq -c | sort -rn | head -1 | awk '{gsub("/v1/", "", $2); gsub("/", " ", $2); print $2}')

# Format tweet
TWEET="Mercury402 Week in Review 📊

💰 Revenue: \$${WEEK_REVENUE}
📞 API Calls: ${WEEK_CALLS}
👥 Customers: ${WEEK_CUSTOMERS}
🔥 Top: ${TOP_ENDPOINT}

Deterministic financial data via x402 micropayments
mercury402.uk"

# Post to X via openclaw message tool
# This will be called from OpenClaw context, not directly
echo "$TWEET"
