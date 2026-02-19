#!/bin/bash
# Cron health check for Clawd
# Reads cron-log.jsonl and reports on job health, failures, and staleness.
#
# Usage:
#   /app/scripts/cron-health.sh          # Print summary to stdout
#   /app/scripts/cron-health.sh --json   # Output machine-readable JSON
#
# Checks:
#   1. Jobs that failed in the last 24 hours
#   2. Jobs that haven't run within their expected schedule
#
# Expected jobs and max staleness (hours):
#   pinterest-daily    - 26h  (daily, with 2h grace)
#   heartbeat          - 2h   (hourly, with 1h grace)
#   memory-synthesis   - 170h (weekly, ~7d + 2h grace)
#   ecommerce-council  - 26h  (daily, with 2h grace)
#   backup-databases   - 26h  (daily, with 2h grace)
#
# Output: human-readable summary, plus alerts to cron-alerts.jsonl on failures.

set -o pipefail

CRON_LOG_DIR="/data/workspace/logs"
CRON_LOG_FILE="${CRON_LOG_DIR}/cron-log.jsonl"
CRON_ALERTS_FILE="${CRON_LOG_DIR}/cron-alerts.jsonl"

JSON_MODE=false
if [ "${1:-}" = "--json" ]; then
    JSON_MODE=true
fi

# ── Job definitions: name => max_stale_hours ──
declare -A JOB_MAX_STALE=(
    ["pinterest-daily"]=26
    ["heartbeat"]=2
    ["memory-synthesis"]=170
    ["ecommerce-council"]=26
    ["backup-databases"]=26
)

# ── Helpers ──

_now_epoch() {
    date +%s
}

# Parse ISO 8601 timestamp to epoch seconds.
# Handles formats: 2025-01-15T09:30:00.000Z and 2025-01-15T09:30:00Z
_iso_to_epoch() {
    local ts="$1"
    # Strip fractional seconds and trailing Z for compatibility
    ts="${ts%.000Z}"
    ts="${ts%Z}"
    # Try GNU date first, then BSD date
    date -d "${ts}Z" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "$ts" +%s 2>/dev/null || echo 0
}

# Format seconds into a human-friendly duration string
_format_duration() {
    local secs="$1"
    if [ "$secs" -lt 0 ]; then
        secs=0
    fi

    if [ "$secs" -lt 60 ]; then
        echo "${secs}s ago"
    elif [ "$secs" -lt 3600 ]; then
        echo "$(( secs / 60 ))m ago"
    elif [ "$secs" -lt 86400 ]; then
        echo "$(( secs / 3600 ))h ago"
    else
        echo "$(( secs / 86400 ))d ago"
    fi
}

# Escape string for JSON
_json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# ── Main logic ──

# Ensure log directory exists
mkdir -p "$CRON_LOG_DIR" 2>/dev/null || true

# Handle missing or empty log file
if [ ! -f "$CRON_LOG_FILE" ] || [ ! -s "$CRON_LOG_FILE" ]; then
    echo "CRON HEALTH: 0/${#JOB_MAX_STALE[@]} jobs healthy"
    for job in "${!JOB_MAX_STALE[@]}"; do
        echo "  -- $job: NO DATA - never run"
    done
    if [ "$JSON_MODE" = true ]; then
        echo "---"
        echo "{\"healthy\":0,\"total\":${#JOB_MAX_STALE[@]},\"jobs\":{}}"
    fi
    exit 0
fi

NOW_EPOCH="$(_now_epoch)"
TWENTY_FOUR_H_AGO=$(( NOW_EPOCH - 86400 ))

# For each job, find its most recent success/failure entry and check health.
# We parse the log file once and extract the data we need.

# Associative arrays to track per-job state
declare -A LAST_STATUS        # last completion status (success|failure)
declare -A LAST_TIMESTAMP     # last completion ISO timestamp
declare -A LAST_EPOCH         # last completion epoch
declare -A LAST_SUMMARY       # last completion summary
declare -A RECENT_FAILURES    # count of failures in last 24h

# Initialize
for job in "${!JOB_MAX_STALE[@]}"; do
    LAST_STATUS["$job"]=""
    LAST_TIMESTAMP["$job"]=""
    LAST_EPOCH["$job"]=0
    LAST_SUMMARY["$job"]=""
    RECENT_FAILURES["$job"]=0
done

# Parse the log file line by line.
# We only care about "success" and "failure" entries (not "start").
while IFS= read -r line; do
    # Skip empty lines
    [ -z "$line" ] && continue

    # Extract fields using lightweight parsing (no jq dependency)
    # Extract job name
    local_job=""
    local_status=""
    local_ts=""
    local_summary=""

    # Parse "job":"value"
    if [[ "$line" =~ \"job\":\"([^\"]+)\" ]]; then
        local_job="${BASH_REMATCH[1]}"
    fi
    # Parse "status":"value"
    if [[ "$line" =~ \"status\":\"([^\"]+)\" ]]; then
        local_status="${BASH_REMATCH[1]}"
    fi
    # Parse "timestamp":"value"
    if [[ "$line" =~ \"timestamp\":\"([^\"]+)\" ]]; then
        local_ts="${BASH_REMATCH[1]}"
    fi
    # Parse "summary":"value" - grab everything between the quotes after summary
    if [[ "$line" =~ \"summary\":\"([^\"]*) ]]; then
        local_summary="${BASH_REMATCH[1]}"
    fi

    # Skip start entries and unknown jobs
    [ "$local_status" = "start" ] && continue
    [ -z "$local_job" ] && continue

    # Only track jobs we're monitoring
    if [ -z "${JOB_MAX_STALE[$local_job]+x}" ]; then
        continue
    fi

    local_epoch="$(_iso_to_epoch "$local_ts")"

    # Update last-seen data if this is more recent
    if [ "$local_epoch" -gt "${LAST_EPOCH[$local_job]}" ]; then
        LAST_STATUS["$local_job"]="$local_status"
        LAST_TIMESTAMP["$local_job"]="$local_ts"
        LAST_EPOCH["$local_job"]="$local_epoch"
        LAST_SUMMARY["$local_job"]="$local_summary"
    fi

    # Count recent failures
    if [ "$local_status" = "failure" ] && [ "$local_epoch" -ge "$TWENTY_FOUR_H_AGO" ]; then
        RECENT_FAILURES["$local_job"]=$(( ${RECENT_FAILURES[$local_job]} + 1 ))
    fi

done < "$CRON_LOG_FILE"

# ── Build the report ──

healthy_count=0
total_count=${#JOB_MAX_STALE[@]}
report_lines=()
alert_lines=()
json_jobs="{"
json_first=true

for job in $(echo "${!JOB_MAX_STALE[@]}" | tr ' ' '\n' | sort); do
    max_stale_hours="${JOB_MAX_STALE[$job]}"
    max_stale_secs=$(( max_stale_hours * 3600 ))
    last_epoch="${LAST_EPOCH[$job]}"
    last_status="${LAST_STATUS[$job]}"
    last_summary="${LAST_SUMMARY[$job]}"
    age_secs=$(( NOW_EPOCH - last_epoch ))
    age_human="$(_format_duration "$age_secs")"

    job_state="ok"
    job_detail=""

    if [ "$last_epoch" -eq 0 ]; then
        # Never run
        job_state="nodata"
        job_detail="never run"
    elif [ "$last_status" = "failure" ] && [ "$age_secs" -lt "$max_stale_secs" ]; then
        # Most recent run was a failure and it's the latest
        job_state="failed"
        job_detail="FAILED ${age_human} - \"${last_summary}\""
    elif [ "$age_secs" -gt "$max_stale_secs" ]; then
        # Stale - hasn't run within expected window
        job_state="stale"
        job_detail="STALE - last run ${age_human}"
    else
        # Healthy
        job_state="ok"
        job_detail="OK - last run ${age_human}"
    fi

    # Build display line
    case "$job_state" in
        ok)
            report_lines+=("  OK $job: ${job_detail}")
            healthy_count=$(( healthy_count + 1 ))
            ;;
        failed)
            report_lines+=("  !! $job: ${job_detail}")
            ;;
        stale)
            report_lines+=("  !! $job: ${job_detail}")
            ;;
        nodata)
            report_lines+=("  -- $job: NO DATA - ${job_detail}")
            ;;
    esac

    # Build alert entries for problems
    if [ "$job_state" = "failed" ] || [ "$job_state" = "stale" ]; then
        alert_ts="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")"
        escaped_detail="$(_json_escape "$job_detail")"
        alert_lines+=("{\"job\":\"${job}\",\"state\":\"${job_state}\",\"timestamp\":\"${alert_ts}\",\"detail\":\"${escaped_detail}\"}")
    fi

    # Build JSON output
    if [ "$json_first" = true ]; then
        json_first=false
    else
        json_jobs+=","
    fi
    escaped_summary="$(_json_escape "$last_summary")"
    json_jobs+="\"${job}\":{\"state\":\"${job_state}\",\"last_epoch\":${last_epoch},\"age_secs\":${age_secs},\"last_status\":\"${last_status}\",\"summary\":\"${escaped_summary}\",\"recent_failures\":${RECENT_FAILURES[$job]}}"
done

json_jobs+="}"

# ── Output ──

echo "CRON HEALTH: ${healthy_count}/${total_count} jobs healthy"
for line in "${report_lines[@]}"; do
    echo "$line"
done

# Write alerts if there were problems
if [ ${#alert_lines[@]} -gt 0 ]; then
    for alert in "${alert_lines[@]}"; do
        printf '%s\n' "$alert" >> "$CRON_ALERTS_FILE" 2>/dev/null
    done
fi

if [ "$JSON_MODE" = true ]; then
    echo "---"
    echo "{\"healthy\":${healthy_count},\"total\":${total_count},\"jobs\":${json_jobs}}"
fi

# Exit code: 0 if all healthy, 1 if any problems
if [ "$healthy_count" -lt "$total_count" ]; then
    exit 1
fi
exit 0
