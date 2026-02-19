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

# Lock directory for idempotent execution
CRON_LOCK_DIR="${CRON_LOG_DIR}/locks"

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

# Acquire a lock for a cron job (prevents double-fire on restart)
# Usage: cron_acquire_lock "job-name"
# Returns 0 if acquired, 1 if already running
cron_acquire_lock() {
    local job_name="${1:?cron_acquire_lock requires a job name}"
    mkdir -p "$CRON_LOCK_DIR" 2>/dev/null || true
    local lockfile="${CRON_LOCK_DIR}/${job_name}.lock"

    if [ -f "$lockfile" ]; then
        local pid
        pid=$(cat "$lockfile" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            echo "[cron-log] Job '$job_name' already running (PID $pid), skipping" >&2
            return 1
        fi
        # Stale lock from dead process, clean up
        rm -f "$lockfile"
    fi

    echo $$ > "$lockfile"
    return 0
}

# Release the lock for the current job
cron_release_lock() {
    if [ -n "$_CRON_JOB_NAME" ]; then
        rm -f "${CRON_LOCK_DIR}/${_CRON_JOB_NAME}.lock" 2>/dev/null
    fi
}

# Check if a job should run based on last successful completion
# Usage: cron_should_run "job-name" <max_seconds>
# Returns 0 if should run (enough time elapsed), 1 if too recent
cron_should_run() {
    local job_name="${1:?cron_should_run requires a job name}"
    local max_seconds="${2:?cron_should_run requires max seconds}"

    if [ ! -f "$CRON_LOG_FILE" ]; then
        return 0  # No log = never run
    fi

    # Find last successful completion timestamp
    local last_ts
    last_ts=$(grep "\"job\":\"${job_name}\"" "$CRON_LOG_FILE" | grep '"status":"success"' | tail -1 | sed -n 's/.*"timestamp":"\([^"]*\)".*/\1/p')

    if [ -z "$last_ts" ]; then
        return 0  # Never succeeded
    fi

    # Parse ISO timestamp to epoch
    local last_epoch
    last_epoch=$(date -d "$last_ts" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${last_ts%%.*}" +%s 2>/dev/null || echo 0)

    local now_epoch
    now_epoch=$(date +%s)

    local elapsed=$(( now_epoch - last_epoch ))

    if [ "$elapsed" -lt "$max_seconds" ]; then
        echo "[cron-log] Job '$job_name' last succeeded ${elapsed}s ago (threshold: ${max_seconds}s), skipping" >&2
        return 1
    fi

    return 0
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

    # Release lock and reset state
    cron_release_lock
    _CRON_JOB_NAME=""
    _CRON_START_EPOCH_MS=""
}
