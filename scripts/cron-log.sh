#!/bin/bash
# Cron job logging utility for Clawd
# Source this script in cron jobs to log start/end/status to JSONL files.
#
# Usage:
#   #!/bin/bash
#   source /app/scripts/cron-log.sh
#
#   cron_start "pinterest-daily"
#   # ... do work ...
#   if [ $? -eq 0 ]; then
#       cron_end "success" "Pinned 5 listings to 3 boards"
#   else
#       cron_end "failure" "Pinterest API returned 429"
#   fi
#
# Log files:
#   /data/workspace/logs/cron-log.jsonl      - All entries (start + completion)
#   /data/workspace/logs/cron-failures.jsonl  - Failures only (for easy monitoring)

CRON_LOG_DIR="/data/workspace/logs"
CRON_LOG_FILE="${CRON_LOG_DIR}/cron-log.jsonl"
CRON_FAILURES_FILE="${CRON_LOG_DIR}/cron-failures.jsonl"

# Internal state
_CRON_JOB_NAME=""
_CRON_START_EPOCH_MS=""

# Ensure log directory exists
_cron_ensure_dir() {
    if [ ! -d "$CRON_LOG_DIR" ]; then
        mkdir -p "$CRON_LOG_DIR" 2>/dev/null || true
    fi
}

# Get current time as ISO 8601
_cron_iso_now() {
    date -u +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ"
}

# Get current epoch in milliseconds
_cron_epoch_ms() {
    # Try date with nanoseconds (GNU coreutils)
    local ms
    ms=$(date +%s%N 2>/dev/null)
    if [ ${#ms} -gt 15 ]; then
        echo "${ms:0:13}"
        return
    fi
    # Fallback: seconds * 1000
    echo "$(( $(date +%s) * 1000 ))"
}

# Escape a string for safe JSON embedding
_cron_json_escape() {
    local s="$1"
    # Escape backslashes, double quotes, and control characters
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Write a JSON line to a file (atomic append)
_cron_write_line() {
    local file="$1"
    local json="$2"
    # Use a temp file and append for atomicity
    printf '%s\n' "$json" >> "$file" 2>/dev/null
}

# Record the start of a cron job
# Usage: cron_start "job-name"
cron_start() {
    local job_name="${1:?cron_start requires a job name}"
    _CRON_JOB_NAME="$job_name"
    _CRON_START_EPOCH_MS="$(_cron_epoch_ms)"

    _cron_ensure_dir

    local ts
    ts="$(_cron_iso_now)"
    local escaped_name
    escaped_name="$(_cron_json_escape "$job_name")"

    local json="{\"job\":\"${escaped_name}\",\"status\":\"start\",\"timestamp\":\"${ts}\"}"
    _cron_write_line "$CRON_LOG_FILE" "$json"
}

# Record the end of a cron job
# Usage: cron_end "success|failure" "Human-readable summary"
cron_end() {
    local status="${1:?cron_end requires a status (success|failure)}"
    local summary="${2:-}"

    if [ -z "$_CRON_JOB_NAME" ]; then
        echo "[cron-log] WARNING: cron_end called without cron_start" >&2
        return 1
    fi

    _cron_ensure_dir

    local end_ms
    end_ms="$(_cron_epoch_ms)"
    local duration_ms=$(( end_ms - _CRON_START_EPOCH_MS ))

    # Guard against negative duration (clock issues)
    if [ "$duration_ms" -lt 0 ]; then
        duration_ms=0
    fi

    local ts
    ts="$(_cron_iso_now)"
    local escaped_name
    escaped_name="$(_cron_json_escape "$_CRON_JOB_NAME")"
    local escaped_summary
    escaped_summary="$(_cron_json_escape "$summary")"

    local json="{\"job\":\"${escaped_name}\",\"status\":\"${status}\",\"timestamp\":\"${ts}\",\"duration_ms\":${duration_ms},\"summary\":\"${escaped_summary}\"}"
    _cron_write_line "$CRON_LOG_FILE" "$json"

    # Write failures to the dedicated failures file
    if [ "$status" = "failure" ]; then
        _cron_write_line "$CRON_FAILURES_FILE" "$json"
    fi

    # Reset state so the script can be reused for multiple jobs in one session
    _CRON_JOB_NAME=""
    _CRON_START_EPOCH_MS=""
}
