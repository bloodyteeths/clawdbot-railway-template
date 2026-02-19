#!/bin/bash
# Clawd Security Review — Basic security checks for the container
#
# Checks performed:
#   1. Exposed API keys/tokens in workspace files
#   2. moltbot.json configuration sanity
#   3. WhatsApp session status
#   4. Disk usage of /data volume
#   5. Critical scripts present and executable
#
# Output: Human-readable summary + JSONL log
#
# Usage:
#   /app/scripts/security-review.sh

set -euo pipefail

LOG_DIR="/data/workspace/logs"
LOG_FILE="${LOG_DIR}/security-review.jsonl"
DATE_HEADER=$(date -u +"%b %d, %Y" 2>/dev/null || date +"%Y-%m-%d")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")

# Ensure log directory
mkdir -p "$LOG_DIR" 2>/dev/null || true

# Track results
PASS=0
WARN=0
FAIL=0
RESULTS=()

add_pass() {
    local msg="$1"
    echo "  ✅ $msg"
    RESULTS+=("{\"check\":\"$(json_escape "$msg")\",\"status\":\"pass\"}")
    ((PASS++))
}

add_warn() {
    local msg="$1"
    echo "  ⚠️  $msg"
    RESULTS+=("{\"check\":\"$(json_escape "$msg")\",\"status\":\"warn\"}")
    ((WARN++))
}

add_fail() {
    local msg="$1"
    echo "  ❌ $msg"
    RESULTS+=("{\"check\":\"$(json_escape "$msg")\",\"status\":\"fail\"}")
    ((FAIL++))
}

# Simple JSON string escaping (backslash, double-quote, newlines)
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

echo ""
echo "🔒 SECURITY REVIEW — $DATE_HEADER"
echo ""

# ---------------------------------------------------------------------------
# 1. Check for exposed secrets in workspace files
# ---------------------------------------------------------------------------
echo "  Checking for exposed secrets in /data/workspace..."

SECRET_PATTERNS=(
    'sk_live_[a-zA-Z0-9]'       # Stripe live keys
    'sk_test_[a-zA-Z0-9]'       # Stripe test keys
    'xoxb-[0-9]'                # Slack bot tokens
    'xoxp-[0-9]'                # Slack user tokens
    'xapp-[0-9]'                # Slack app tokens
    'AKIA[0-9A-Z]{16}'          # AWS access keys
    'ghp_[a-zA-Z0-9]{36}'       # GitHub personal tokens
    'gho_[a-zA-Z0-9]{36}'       # GitHub OAuth tokens
    'glpat-[a-zA-Z0-9_-]'      # GitLab tokens
    'Bearer [a-zA-Z0-9_-]{20,}' # Bearer tokens in plain text
)

SECRETS_FOUND=0
SECRETS_DETAIL=""

if [ -d "/data/workspace" ]; then
    for pattern in "${SECRET_PATTERNS[@]}"; do
        # Search text files, skip binaries, logs, and node_modules
        matches=$(grep -rlE "$pattern" /data/workspace/ \
            --include='*.md' --include='*.txt' --include='*.json' --include='*.yml' \
            --include='*.yaml' --include='*.env' --include='*.sh' --include='*.js' \
            --include='*.cjs' --include='*.mjs' --include='*.ts' \
            2>/dev/null | head -5 || true)
        if [ -n "$matches" ]; then
            SECRETS_FOUND=$((SECRETS_FOUND + 1))
            SECRETS_DETAIL="${SECRETS_DETAIL}Pattern '${pattern}' found in: ${matches}\n"
        fi
    done

    # Also check for .env files that shouldn't be there
    env_files=$(find /data/workspace -name '.env' -o -name '.env.*' -o -name 'credentials.json' 2>/dev/null | head -5 || true)
    if [ -n "$env_files" ]; then
        SECRETS_FOUND=$((SECRETS_FOUND + 1))
        SECRETS_DETAIL="${SECRETS_DETAIL}Sensitive files found: ${env_files}\n"
    fi
fi

if [ "$SECRETS_FOUND" -gt 0 ]; then
    add_fail "Potential exposed secrets found ($SECRETS_FOUND pattern match(es)) in workspace files"
else
    add_pass "No exposed secrets in workspace files"
fi

# ---------------------------------------------------------------------------
# 2. Check moltbot.json configuration
# ---------------------------------------------------------------------------
echo "  Checking moltbot.json configuration..."

MOLTBOT_CONFIG="/data/.clawdbot/moltbot.json"

if [ -f "$MOLTBOT_CONFIG" ]; then
    # Check for default/weak passwords in setup config
    if command -v jq &>/dev/null; then
        setup_pass=$(jq -r '.setup.password // empty' "$MOLTBOT_CONFIG" 2>/dev/null || true)
        if [ -n "$setup_pass" ]; then
            pass_len=${#setup_pass}
            if [ "$pass_len" -lt 8 ]; then
                add_warn "Setup password is short ($pass_len chars) — consider a stronger one"
            elif echo "$setup_pass" | grep -qiE '^(password|admin|123456|qwerty|changeme)$'; then
                add_fail "Setup password is a common weak password — change immediately"
            else
                add_pass "Setup password configured (${pass_len} chars)"
            fi
        else
            add_warn "No setup password found in moltbot.json"
        fi

        # Check DM policy
        dm_policy=$(jq -r '.contacts.dm // empty' "$MOLTBOT_CONFIG" 2>/dev/null || true)
        if [ "$dm_policy" = "open" ]; then
            add_warn "DM policy is 'open' — anyone can message the bot"
        else
            add_pass "DM policy: ${dm_policy:-not set}"
        fi
    else
        add_warn "jq not available — skipping moltbot.json deep checks"
    fi
else
    add_warn "moltbot.json not found at $MOLTBOT_CONFIG"
fi

# ---------------------------------------------------------------------------
# 3. Check WhatsApp session status
# ---------------------------------------------------------------------------
echo "  Checking WhatsApp session..."

WA_SESSION_DIR="/data/.clawdbot/whatsapp"

if [ -d "$WA_SESSION_DIR" ]; then
    # Check for session files (baileys stores auth in creds.json)
    if [ -f "$WA_SESSION_DIR/creds.json" ] || [ -d "$WA_SESSION_DIR/store" ]; then
        # Try to verify session is active via the API
        if [ -n "${SETUP_PASSWORD:-}" ]; then
            wa_status=$(curl -s -m 5 -u "user:${SETUP_PASSWORD}" \
                "http://localhost:8080/setup/api/exec" \
                -X POST -H "Content-Type: application/json" \
                -d '{"args": ["channels", "status"]}' 2>/dev/null || true)

            if echo "$wa_status" | grep -qi "whatsapp.*connected\|whatsapp.*ready\|whatsapp.*active"; then
                add_pass "WhatsApp session active"
            elif echo "$wa_status" | grep -qi "whatsapp"; then
                add_warn "WhatsApp session exists but may not be connected"
            else
                add_warn "Could not verify WhatsApp connection status"
            fi
        else
            add_pass "WhatsApp session files present"
        fi
    else
        add_warn "WhatsApp session directory exists but no credentials found"
    fi
else
    add_warn "WhatsApp session directory not found"
fi

# ---------------------------------------------------------------------------
# 4. Check disk usage of /data volume
# ---------------------------------------------------------------------------
echo "  Checking disk usage..."

if df /data &>/dev/null; then
    disk_info=$(df -h /data | tail -1)
    usage_pct=$(echo "$disk_info" | awk '{print $5}' | tr -d '%')
    avail=$(echo "$disk_info" | awk '{print $4}')

    if [ "$usage_pct" -ge 95 ]; then
        add_fail "Disk usage: ${usage_pct}% (${avail} free) — CRITICAL"
    elif [ "$usage_pct" -ge 85 ]; then
        add_warn "Disk usage: ${usage_pct}% (${avail} free)"
    else
        add_pass "Disk usage: ${usage_pct}% (${avail} free)"
    fi
else
    # /data might not be a separate mount
    disk_info=$(df -h / | tail -1)
    usage_pct=$(echo "$disk_info" | awk '{print $5}' | tr -d '%')
    avail=$(echo "$disk_info" | awk '{print $4}')
    add_pass "Root disk usage: ${usage_pct}% (${avail} free)"
fi

# ---------------------------------------------------------------------------
# 5. Check critical scripts exist and are executable
# ---------------------------------------------------------------------------
echo "  Checking critical scripts..."

CRITICAL_SCRIPTS=(
    "/app/scripts/etsy.sh"
    "/app/scripts/trendyol.sh"
    "/app/scripts/kolayxport.sh"
    "/app/scripts/cron-log.sh"
    "/app/scripts/entrypoint.sh"
    "/app/scripts/browser-automation.js"
    "/app/scripts/idea-machine.cjs"
    "/app/scripts/urgent-alerts.cjs"
)

missing_scripts=0
nonexec_scripts=0
scripts_detail=""

for script in "${CRITICAL_SCRIPTS[@]}"; do
    basename_s=$(basename "$script")
    if [ ! -f "$script" ]; then
        missing_scripts=$((missing_scripts + 1))
        scripts_detail="${scripts_detail}missing: ${basename_s}, "
    elif [ ! -x "$script" ] && [[ "$script" == *.sh ]]; then
        # Only .sh scripts need to be executable; .cjs and .js are run via node
        nonexec_scripts=$((nonexec_scripts + 1))
        scripts_detail="${scripts_detail}not executable: ${basename_s}, "
    fi
done

if [ "$missing_scripts" -gt 0 ]; then
    add_fail "$missing_scripts critical script(s) missing: $scripts_detail"
elif [ "$nonexec_scripts" -gt 0 ]; then
    add_warn "$nonexec_scripts script(s) not executable: $scripts_detail"
else
    add_pass "All critical scripts present and executable"
fi

# ---------------------------------------------------------------------------
# 6. Check critical environment variables
# ---------------------------------------------------------------------------
echo "  Checking environment variables..."

REQUIRED_VARS=(
    "KOLAYXPORT_API_KEY"
    "ANTHROPIC_API_KEY"
)

missing_vars=0
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        missing_vars=$((missing_vars + 1))
    fi
done

if [ "$missing_vars" -gt 0 ]; then
    add_warn "$missing_vars required env var(s) not set"
else
    add_pass "All required environment variables set"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "  Summary: $PASS passed, $WARN warnings, $FAIL failures"
echo ""

# Build JSON array of results
json_results="["
first=true
for r in "${RESULTS[@]}"; do
    if [ "$first" = true ]; then
        first=false
    else
        json_results="${json_results},"
    fi
    json_results="${json_results}${r}"
done
json_results="${json_results}]"

# Write JSONL log entry
log_entry="{\"timestamp\":\"${TIMESTAMP}\",\"pass\":${PASS},\"warn\":${WARN},\"fail\":${FAIL},\"results\":${json_results}}"
printf '%s\n' "$log_entry" >> "$LOG_FILE" 2>/dev/null || true

# Exit with non-zero if any failures
if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
