#!/bin/bash
# AgentCash Daily Intelligence Monitor
# Purpose: Fetch x402 ecosystem intel from Twitter + Moltbook
# Schedule: Runs daily at 09:00 ET via cron
# Cost: ~$0.05-0.07 per run = ~$1.50-2.10/month

set -euo pipefail

WORK_DIR="/Users/openclaw/wealthforge"
INTEL_DIR="${WORK_DIR}/intel"
TODAY=$(date +%Y-%m-%d)
REPORT_FILE="${INTEL_DIR}/${TODAY}.md"

# Create intel directory if missing
mkdir -p "${INTEL_DIR}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}[MONITOR]${NC} Starting AgentCash intelligence collection..."
echo "Time: $(date)"
echo "Report: ${REPORT_FILE}"
echo ""

# Initialize report
cat > "${REPORT_FILE}" << 'EOF'
# Daily x402 Intelligence Report
EOF

echo "**Date:** $(date)" >> "${REPORT_FILE}"
echo "**Cost Estimate:** \$0.05-0.07" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

# ============================================================================
# SECTION 1: Twitter Search - Mercury402 Mentions
# ============================================================================
echo -e "${YELLOW}[1/4]${NC} Twitter search: mercury402 mentions..."

TWITTER_COST=$(npx agentcash@latest fetch "https://x402.twit.sh/tweets/search?words=mercury402&minLikes=1" 2>&1 | jq -r '.payment.amount // "0.01"' || echo "0.01")

echo "" >> "${REPORT_FILE}"
echo "## Section 1: Mercury402 Mentions on Twitter" >> "${REPORT_FILE}"
echo "**Query:** mercury402 with minLikes=1" >> "${REPORT_FILE}"
echo "**Cost:** \$${TWITTER_COST}" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

MERCURY_TWEETS=$(npx agentcash@latest fetch "https://x402.twit.sh/tweets/search?words=mercury402&minLikes=1" 2>&1 || echo "{}")

echo "\`\`\`json" >> "${REPORT_FILE}"
echo "${MERCURY_TWEETS}" | jq '.' >> "${REPORT_FILE}" || echo "{}\" >> ${REPORT_FILE}"
echo "\`\`\`" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo -e "${GREEN}✓${NC} Twitter mercury402 scan complete"

# ============================================================================
# SECTION 2: Twitter Search - x402 Ecosystem  
# ============================================================================
echo -e "${YELLOW}[2/4]${NC} Twitter search: x402 ecosystem..."

echo "" >> "${REPORT_FILE}"
echo "## Section 2: x402 Protocol Ecosystem Activity" >> "${REPORT_FILE}"
echo "**Query:** x402 with minLikes=5" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

X402_TWEETS=$(npx agentcash@latest fetch "https://x402.twit.sh/tweets/search?words=x402&minLikes=5" 2>&1 || echo "{}")

echo "\`\`\`json" >> "${REPORT_FILE}"
echo "${X402_TWEETS}" | jq '.' >> "${REPORT_FILE}" || echo "{}" >> "${REPORT_FILE}"
echo "\`\`\`" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo -e "${GREEN}✓${NC} Twitter x402 scan complete"

# ============================================================================
# SECTION 3: Moltbook Narrative Digest
# ============================================================================
echo -e "${YELLOW}[3/4]${NC} Moltbook digest: latest narratives..."

echo "" >> "${REPORT_FILE}"
echo "## Section 3: Moltbook Community Narratives (Latest Digest)" >> "${REPORT_FILE}"
echo "**Endpoint:** /api/moltbook/digests/latest" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

MOLTBOOK_DIGEST=$(npx agentcash@latest fetch "https://api.moltalyzer.xyz/api/moltbook/digests/latest" 2>&1 || echo "{}")

echo "\`\`\`json" >> "${REPORT_FILE}"
echo "${MOLTBOOK_DIGEST}" | jq '.' >> "${REPORT_FILE}" || echo "{}" >> "${REPORT_FILE}"
echo "\`\`\`" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo -e "${GREEN}✓${NC} Moltbook digest complete"

# ============================================================================
# SECTION 4: Summary & Intelligence
# ============================================================================
echo -e "${YELLOW}[4/4]${NC} Compiling intelligence summary..."

echo "" >> "${REPORT_FILE}"
echo "## Section 4: Key Intelligence Findings" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"
echo "### Mercury402 Mentions" >> "${REPORT_FILE}"
MERCURY_COUNT=$(echo "${MERCURY_TWEETS}" | jq '.data | length // 0' 2>/dev/null || echo "0")
echo "- **Count:** ${MERCURY_COUNT} tweets with >1 like" >> "${REPORT_FILE}"
echo "- **Status:** $([ "${MERCURY_COUNT}" -gt 0 ] && echo 'Active mentions detected' || echo 'No mentions yet')" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo "### x402 Ecosystem" >> "${REPORT_FILE}"
X402_COUNT=$(echo "${X402_TWEETS}" | jq '.data | length // 0' 2>/dev/null || echo "0")
echo "- **Count:** ${X402_COUNT} tweets with >5 likes" >> "${REPORT_FILE}"
echo "- **Status:** $([ "${X402_COUNT}" -gt 3 ] && echo 'Strong ecosystem activity' || echo 'Moderate activity')" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo "### Moltbook Trends" >> "${REPORT_FILE}"
MOLTBOOK_POSTS=$(echo "${MOLTBOOK_DIGEST}" | jq '.data.total_posts // 0' 2>/dev/null || echo "0")
echo "- **Total posts (last hour):** ${MOLTBOOK_POSTS}" >> "${REPORT_FILE}"
echo "- **Analysis:** See digest JSON above for narratives, sentiment, and hot discussions" >> "${REPORT_FILE}"
echo "" >> "${REPORT_FILE}"

echo "---" >> "${REPORT_FILE}"
echo "**Report generated:** $(date)" >> "${REPORT_FILE}"
echo "**Cost:** \$0.05-0.07 per run" >> "${REPORT_FILE}"
echo "**Recurring cost:** ~\$1.50-2.10/month (daily runs)" >> "${REPORT_FILE}"

echo -e "${GREEN}✓${NC} Intelligence report complete"
echo ""
echo -e "${GREEN}[SUCCESS]${NC} Report written to: ${REPORT_FILE}"
echo ""
echo "Cost breakdown:"
echo "  - Twitter search (mercury402): \$0.01"
echo "  - Twitter search (x402): \$0.01"
echo "  - Moltbook digest: \$0.01-0.05"
echo "  Total: \$0.03-0.07"
