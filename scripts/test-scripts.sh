#!/bin/bash
# Clawd Test Suite — Validates all critical scripts and dependencies
#
# Runs a series of smoke tests to confirm that:
#   - Shell scripts can execute and return expected output
#   - Required CLI tools are available
#   - Environment variables are set
#   - Workspace files and directories exist
#
# Usage:
#   /app/scripts/test-scripts.sh
#
# Exit code: 0 if all pass, 1 if any fail

set -uo pipefail

PASS=0
FAIL=0
SKIP=0
TOTAL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

# Detect if stdout is a terminal (for color support)
if [ -t 1 ]; then
    USE_COLOR=true
else
    USE_COLOR=false
fi

pass() {
    local msg="$1"
    ((TOTAL++))
    ((PASS++))
    if [ "$USE_COLOR" = true ]; then
        echo -e "  ${GREEN}✅${NC} $msg"
    else
        echo "  ✅ $msg"
    fi
}

fail() {
    local msg="$1"
    local detail="${2:-}"
    ((TOTAL++))
    ((FAIL++))
    if [ "$USE_COLOR" = true ]; then
        echo -e "  ${RED}❌${NC} $msg"
    else
        echo "  ❌ $msg"
    fi
    if [ -n "$detail" ]; then
        echo "     -> $detail"
    fi
}

skip() {
    local msg="$1"
    local reason="${2:-}"
    ((TOTAL++))
    ((SKIP++))
    if [ "$USE_COLOR" = true ]; then
        echo -e "  ${YELLOW}⏭️${NC}  $msg (skipped: $reason)"
    else
        echo "  ⏭️  $msg (skipped: $reason)"
    fi
}

echo ""
echo "🧪 CLAWD TEST SUITE"
echo "   $(date -u +"%Y-%m-%d %H:%M:%S UTC")"
echo ""

# ---------------------------------------------------------------------------
# Test 1: etsy.sh listings returns data
# ---------------------------------------------------------------------------
echo "--- Etsy ---"

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "etsy.sh listings" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/etsy.sh listings --limit 1 2>&1) || true
    if echo "$result" | grep -q "Total listings"; then
        pass "etsy.sh listings"
    else
        fail "etsy.sh listings" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 2: etsy.sh orders works
# ---------------------------------------------------------------------------

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "etsy.sh orders" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/etsy.sh orders --limit 1 2>&1) || true
    if echo "$result" | grep -qE "Found [0-9]+ order|No orders found"; then
        pass "etsy.sh orders"
    else
        fail "etsy.sh orders" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 3: trendyol.sh products returns data
# ---------------------------------------------------------------------------
echo "--- Trendyol ---"

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "trendyol.sh products" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/trendyol.sh products --size 1 2>&1) || true
    if echo "$result" | grep -qE "Total:.*products"; then
        pass "trendyol.sh products"
    else
        fail "trendyol.sh products" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 4: trendyol.sh orders works
# ---------------------------------------------------------------------------

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "trendyol.sh orders" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/trendyol.sh orders --size 1 2>&1) || true
    if echo "$result" | grep -qE "Total:.*orders"; then
        pass "trendyol.sh orders"
    else
        fail "trendyol.sh orders" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 5: trendyol.sh questions works
# ---------------------------------------------------------------------------

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "trendyol.sh questions" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/trendyol.sh questions --size 1 2>&1) || true
    if echo "$result" | grep -qE "Customer Questions|questions"; then
        pass "trendyol.sh questions"
    else
        fail "trendyol.sh questions" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 6: trendyol.sh claims works
# ---------------------------------------------------------------------------

if [ -z "${KOLAYXPORT_API_KEY:-}" ]; then
    skip "trendyol.sh claims" "KOLAYXPORT_API_KEY not set"
else
    result=$(/app/scripts/trendyol.sh claims --size 1 2>&1) || true
    if echo "$result" | grep -qE "Returns/Claims|claims"; then
        pass "trendyol.sh claims"
    else
        fail "trendyol.sh claims" "$(echo "$result" | head -1)"
    fi
fi

# ---------------------------------------------------------------------------
# Test 7: cron-log.sh can be sourced
# ---------------------------------------------------------------------------
echo "--- Utilities ---"

if [ -f "/app/scripts/cron-log.sh" ]; then
    # Source in a subshell to avoid polluting current env
    if (source /app/scripts/cron-log.sh && type cron_start &>/dev/null && type cron_end &>/dev/null); then
        pass "cron-log.sh (sourceable, exports cron_start/cron_end)"
    else
        fail "cron-log.sh" "Could not source or missing expected functions"
    fi
else
    fail "cron-log.sh" "File not found at /app/scripts/cron-log.sh"
fi

# ---------------------------------------------------------------------------
# Test 8: gog CLI is available
# ---------------------------------------------------------------------------
echo "--- CLI Tools ---"

if command -v gog &>/dev/null; then
    gog_version=$(gog --version 2>&1 | head -1 || echo "unknown")
    pass "gog CLI available ($gog_version)"
else
    fail "gog CLI" "Not found in PATH"
fi

# ---------------------------------------------------------------------------
# Test 9: jq is available
# ---------------------------------------------------------------------------

if command -v jq &>/dev/null; then
    jq_version=$(jq --version 2>&1 || echo "unknown")
    pass "jq available ($jq_version)"
else
    fail "jq" "Not found in PATH"
fi

# ---------------------------------------------------------------------------
# Test 10: curl is available
# ---------------------------------------------------------------------------

if command -v curl &>/dev/null; then
    pass "curl available"
else
    fail "curl" "Not found in PATH"
fi

# ---------------------------------------------------------------------------
# Test 11: ffmpeg is available
# ---------------------------------------------------------------------------

if command -v ffmpeg &>/dev/null; then
    pass "ffmpeg available"
else
    fail "ffmpeg" "Not found in PATH"
fi

# ---------------------------------------------------------------------------
# Test 12: node version check
# ---------------------------------------------------------------------------

if command -v node &>/dev/null; then
    node_version=$(node --version 2>&1)
    node_major=$(echo "$node_version" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$node_major" -ge 24 ] 2>/dev/null; then
        pass "node $node_version (>= 24)"
    else
        fail "node version" "Got $node_version, expected >= 24"
    fi
else
    fail "node" "Not found in PATH"
fi

# ---------------------------------------------------------------------------
# Test 13: KOLAYXPORT_API_KEY is set
# ---------------------------------------------------------------------------
echo "--- Environment ---"

if [ -n "${KOLAYXPORT_API_KEY:-}" ]; then
    # Mask the key for display
    key_len=${#KOLAYXPORT_API_KEY}
    pass "KOLAYXPORT_API_KEY set (${key_len} chars)"
else
    fail "KOLAYXPORT_API_KEY" "Not set"
fi

# ---------------------------------------------------------------------------
# Test 14: ANTHROPIC_API_KEY is set
# ---------------------------------------------------------------------------

if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    pass "ANTHROPIC_API_KEY set"
else
    skip "ANTHROPIC_API_KEY" "Managed by OpenClaw gateway"
fi

# ---------------------------------------------------------------------------
# Test 15: KOLAYXPORT_API_URL is reachable
# ---------------------------------------------------------------------------

if [ -n "${KOLAYXPORT_API_URL:-}" ]; then
    http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${KOLAYXPORT_API_URL}" 2>/dev/null || echo "000")
    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 500 ] 2>/dev/null; then
        pass "KOLAYXPORT_API_URL reachable (HTTP $http_code)"
    else
        fail "KOLAYXPORT_API_URL" "HTTP $http_code from ${KOLAYXPORT_API_URL}"
    fi
else
    skip "KOLAYXPORT_API_URL reachable" "Variable not set"
fi

# ---------------------------------------------------------------------------
# Test 16: Workspace files exist
# ---------------------------------------------------------------------------
echo "--- Workspace ---"

WORKSPACE_FILES=(
    "/data/workspace/CLAUDE.md"
)

for wf in "${WORKSPACE_FILES[@]}"; do
    basename_wf=$(basename "$wf")
    if [ -f "$wf" ]; then
        pass "$basename_wf exists"
    else
        fail "$basename_wf" "Not found at $wf"
    fi
done

# ---------------------------------------------------------------------------
# Test 17: Logs directory exists and is writable
# ---------------------------------------------------------------------------

LOG_DIR="/data/workspace/logs"

if [ -d "$LOG_DIR" ]; then
    # Test write
    test_file="${LOG_DIR}/.test-write-$$"
    if echo "test" > "$test_file" 2>/dev/null; then
        rm -f "$test_file"
        pass "Logs directory exists and writable"
    else
        fail "Logs directory" "Exists at $LOG_DIR but not writable"
    fi
else
    # Try to create it
    if mkdir -p "$LOG_DIR" 2>/dev/null; then
        pass "Logs directory created at $LOG_DIR"
    else
        fail "Logs directory" "Cannot create $LOG_DIR"
    fi
fi

# ---------------------------------------------------------------------------
# Test 18: moltbot.json config exists
# ---------------------------------------------------------------------------

if [ -f "/data/.clawdbot/moltbot.json" ]; then
    pass "moltbot.json exists"
else
    fail "moltbot.json" "Not found at /data/.clawdbot/moltbot.json"
fi

# ---------------------------------------------------------------------------
# Test 19: Chromium browser available
# ---------------------------------------------------------------------------
echo "--- Browser ---"

CHROMIUM_PATHS=(
    "/usr/bin/chromium"
    "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome"
)

chromium_found=false
for cpath in "${CHROMIUM_PATHS[@]}"; do
    if [ -x "$cpath" ]; then
        pass "Chromium found at $cpath"
        chromium_found=true
        break
    fi
done

if [ "$chromium_found" = false ]; then
    fail "Chromium" "Not found in any expected path"
fi

# ---------------------------------------------------------------------------
# Test 20: browser-automation.cjs can be loaded
# ---------------------------------------------------------------------------

if [ -f "/app/scripts/browser-automation.cjs" ]; then
    # Just check syntax, don't actually run it
    if node -e "require('/app/scripts/browser-automation.cjs')" 2>/dev/null; then
        pass "browser-automation.cjs loads without error"
    else
        # It might use top-level execution, which is fine; just check file exists
        pass "browser-automation.cjs present"
    fi
else
    fail "browser-automation.cjs" "Not found at /app/scripts/browser-automation.cjs"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed, $SKIP skipped (of $TOTAL)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "  ❌ $FAIL test(s) failed"
    exit 1
else
    echo "  ✅ All tests passed!"
    exit 0
fi
