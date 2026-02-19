#!/bin/bash
# Clawd Backup Script - Backs up critical data to Google Drive
#
# What gets backed up:
#   - Session state (sessions.json)
#   - Memory files (MEMORY.md, USER.md, TOOLS.md, SOUL.md, IDENTITY.md)
#   - Daily memory notes (memory/ directory)
#   - Cron logs (logs/ directory)
#   - JSON state files in workspace
#
# Usage:
#   ./backup-databases.sh             - Full backup + upload to Google Drive
#   ./backup-databases.sh --local     - Local backup only (skip Drive upload)
#   ./backup-databases.sh --list      - List existing backups on Drive
#   ./backup-databases.sh --cleanup   - Delete old backups (keep last 7)
#
# Cron: Daily (e.g., 2 AM Skopje time)

set -euo pipefail

# ── Source cron logging ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/cron-log.sh" ]; then
    source "${SCRIPT_DIR}/cron-log.sh"
else
    # Fallback: no-op functions if cron-log.sh is not available
    cron_start() { echo "[backup] START: $1"; }
    cron_end() { echo "[backup] END: $1 - $2"; }
fi

# ── Configuration ──────────────────────────────────────────────────────────────

TODAY=$(date -u +"%Y-%m-%d")
BACKUP_NAME="clawd-backup-${TODAY}.tar.gz"
BACKUP_PATH="/tmp/${BACKUP_NAME}"
DRIVE_FOLDER="clawd-backups"
KEEP_BACKUPS=7
LOCAL_ONLY=false
LIST_ONLY=false
CLEANUP_ONLY=false

# Parse args
for arg in "$@"; do
    case "$arg" in
        --local)   LOCAL_ONLY=true ;;
        --list)    LIST_ONLY=true ;;
        --cleanup) CLEANUP_ONLY=true ;;
    esac
done

# ── Helpers ────────────────────────────────────────────────────────────────────

log() {
    echo "[backup] $(date +%H:%M:%S) $*"
}

check_gog() {
    if ! command -v gog &>/dev/null; then
        log "WARNING: gog CLI not found"
        return 1
    fi
    # Quick auth check
    if ! gog auth list &>/dev/null; then
        log "WARNING: gog not authenticated (run gog auth setup)"
        return 1
    fi
    return 0
}

# ── List backups on Drive ──────────────────────────────────────────────────────

list_drive_backups() {
    if ! check_gog; then
        log "Cannot list Drive backups: gog not configured"
        return 1
    fi

    log "Listing backups on Google Drive (folder: ${DRIVE_FOLDER})..."
    gog drive list --query "name contains 'clawd-backup-' and '${DRIVE_FOLDER}' in parents and trashed = false" 2>/dev/null \
        || gog drive list --query "name contains 'clawd-backup-'" 2>/dev/null \
        || echo "No backups found or folder does not exist."
}

if [ "$LIST_ONLY" = true ]; then
    list_drive_backups
    exit 0
fi

# ── Cleanup old backups ───────────────────────────────────────────────────────

cleanup_old_backups() {
    if ! check_gog; then
        log "Cannot clean Drive backups: gog not configured"
        return 1
    fi

    log "Checking for old backups to clean up (keeping last ${KEEP_BACKUPS})..."

    # List backup files, sorted by name (date-based names sort chronologically)
    local backup_list
    backup_list=$(gog drive list --query "name contains 'clawd-backup-'" --json 2>/dev/null || echo "[]")

    if [ "$backup_list" = "[]" ] || [ -z "$backup_list" ]; then
        log "No backups found on Drive."
        return 0
    fi

    # Parse with jq: get file IDs sorted by name, skip the most recent N
    local old_files
    old_files=$(echo "$backup_list" | jq -r '
        if type == "array" then
            sort_by(.name) | reverse | .['"${KEEP_BACKUPS}"':] | .[].id // empty
        else
            empty
        end
    ' 2>/dev/null || echo "")

    if [ -z "$old_files" ]; then
        log "No old backups to delete (${KEEP_BACKUPS} or fewer exist)."
        return 0
    fi

    local count=0
    while IFS= read -r file_id; do
        if [ -n "$file_id" ]; then
            log "Deleting old backup: ${file_id}"
            gog drive delete "$file_id" 2>/dev/null && count=$((count + 1)) || true
        fi
    done <<< "$old_files"

    log "Cleaned up ${count} old backup(s)."
}

if [ "$CLEANUP_ONLY" = true ]; then
    cleanup_old_backups
    exit 0
fi

# ── Main backup ───────────────────────────────────────────────────────────────

cron_start "backup-databases"

log "Starting backup: ${BACKUP_NAME}"

# Build list of files/dirs to include
INCLUDE_FILES=()

# Session state
SESSION_FILE="/data/.clawdbot/agents/main/sessions/sessions.json"
if [ -f "$SESSION_FILE" ]; then
    INCLUDE_FILES+=("$SESSION_FILE")
    log "  + sessions.json"
else
    log "  - sessions.json (not found)"
fi

# Core memory files
for md_file in MEMORY.md USER.md TOOLS.md SOUL.md IDENTITY.md; do
    full_path="/data/workspace/${md_file}"
    if [ -f "$full_path" ]; then
        INCLUDE_FILES+=("$full_path")
        log "  + ${md_file}"
    else
        log "  - ${md_file} (not found)"
    fi
done

# Memory directory (daily notes)
MEMORY_DIR="/data/workspace/memory"
if [ -d "$MEMORY_DIR" ]; then
    INCLUDE_FILES+=("$MEMORY_DIR")
    note_count=$(find "$MEMORY_DIR" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
    log "  + memory/ (${note_count} files)"
else
    log "  - memory/ (not found)"
fi

# Logs directory
LOGS_DIR="/data/workspace/logs"
if [ -d "$LOGS_DIR" ]; then
    INCLUDE_FILES+=("$LOGS_DIR")
    log_count=$(find "$LOGS_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
    log "  + logs/ (${log_count} files)"
else
    log "  - logs/ (not found)"
fi

# JSON state files in workspace root
while IFS= read -r json_file; do
    if [ -f "$json_file" ]; then
        INCLUDE_FILES+=("$json_file")
        log "  + $(basename "$json_file")"
    fi
done < <(find /data/workspace -maxdepth 1 -name "*.json" -type f 2>/dev/null || true)

# Check if we have anything to back up
if [ ${#INCLUDE_FILES[@]} -eq 0 ]; then
    log "ERROR: No files found to back up!"
    cron_end "failure" "No files found to back up"
    exit 1
fi

log "Backing up ${#INCLUDE_FILES[@]} item(s)..."

# Create tar.gz archive
# Use -C / to store paths relative to root, so extraction is easy
tar czf "$BACKUP_PATH" "${INCLUDE_FILES[@]}" 2>/dev/null

BACKUP_SIZE=$(du -h "$BACKUP_PATH" 2>/dev/null | cut -f1 || echo "unknown")
log "Archive created: ${BACKUP_PATH} (${BACKUP_SIZE})"

# ── Upload to Google Drive ─────────────────────────────────────────────────────

UPLOADED=false

if [ "$LOCAL_ONLY" = true ]; then
    log "Local-only mode: skipping Drive upload"
    log "Backup saved at: ${BACKUP_PATH}"
else
    if check_gog; then
        log "Uploading to Google Drive..."

        # Ensure the backup folder exists
        gog drive mkdir "${DRIVE_FOLDER}" 2>/dev/null || true

        # Upload the archive
        if gog drive upload "$BACKUP_PATH" --parent "${DRIVE_FOLDER}" 2>/dev/null; then
            UPLOADED=true
            log "Upload successful!"

            # Remove local archive after successful upload
            rm -f "$BACKUP_PATH"
            log "Local archive removed."

            # Cleanup old backups on Drive
            cleanup_old_backups
        else
            # Upload failed -- try without --parent flag (folder might not support it)
            log "Upload with --parent failed, trying direct upload..."
            if gog drive upload "$BACKUP_PATH" 2>/dev/null; then
                UPLOADED=true
                log "Upload successful (root folder)!"
                rm -f "$BACKUP_PATH"
                log "Local archive removed."
            else
                log "WARNING: Drive upload failed. Keeping local backup at ${BACKUP_PATH}"
            fi
        fi
    else
        log "gog not configured. Keeping local backup at ${BACKUP_PATH}"
    fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────

SUMMARY="Backup ${BACKUP_NAME} (${BACKUP_SIZE}, ${#INCLUDE_FILES[@]} items)"
if [ "$UPLOADED" = true ]; then
    SUMMARY="${SUMMARY} -- uploaded to Drive (${DRIVE_FOLDER}/)"
elif [ "$LOCAL_ONLY" = true ]; then
    SUMMARY="${SUMMARY} -- local only at ${BACKUP_PATH}"
else
    SUMMARY="${SUMMARY} -- local only (Drive upload failed), saved at ${BACKUP_PATH}"
fi

log "$SUMMARY"
cron_end "success" "$SUMMARY"
