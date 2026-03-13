#!/bin/bash
# Mercury402 Milestone Checker
# Returns milestone info if crossed, empty if not

LEDGER="/Users/openclaw/.openclaw/LEDGER/mercury402-revenue.jsonl"
STATE_FILE="/Users/openclaw/.openclaw/workspace/mercury-milestone-state.json"

# Exit if no ledger
if [ ! -f "$LEDGER" ] || [ ! -s "$LEDGER" ]; then
    exit 0
fi

# Calculate total revenue
TOTAL=$(cat "$LEDGER" | jq -r '.amount' | awk '{sum+=$1} END {print sum}')

# Read last milestone
LAST_MILESTONE=$(cat "$STATE_FILE" | jq -r '.last_milestone')

# Check if we crossed a milestone
MILESTONES=(0.50 1 5 10 25 50 100 250 500 1000)
NEW_MILESTONE=""

for milestone in "${MILESTONES[@]}"; do
    # Use bc for float comparison
    if (( $(echo "$TOTAL >= $milestone" | bc -l) )) && (( $(echo "$milestone > $LAST_MILESTONE" | bc -l) )); then
        NEW_MILESTONE="$milestone"
    fi
done

# If crossed, output milestone info
if [ -n "$NEW_MILESTONE" ]; then
    TOTAL_CALLS=$(cat "$LEDGER" | wc -l | tr -d ' ')
    UNIQUE_CUSTOMERS=$(cat "$LEDGER" | jq -r '.customer' | sort -u | wc -l | tr -d ' ')
    TOP_ENDPOINT=$(cat "$LEDGER" | jq -r '.endpoint' | sort | uniq -c | sort -rn | head -1 | awk '{gsub("/v1/", "", $2); gsub("/", " ", $2); print $2}')
    
    # Output as JSON for easy parsing
    cat <<EOF
{
  "milestone": $NEW_MILESTONE,
  "total_revenue": $TOTAL,
  "total_calls": $TOTAL_CALLS,
  "unique_customers": $UNIQUE_CUSTOMERS,
  "top_endpoint": "$TOP_ENDPOINT"
}
EOF
fi
