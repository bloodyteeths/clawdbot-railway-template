#!/bin/bash
set -e

# v2026.4.x compat: OpenClaw renamed CLAWDBOT_* env vars to OPENCLAW_*.
# The legacy names still exist on Railway but are ignored by the new gateway.
# Map forward so one set of vars works across versions.
export OPENCLAW_STATE_DIR="${OPENCLAW_STATE_DIR:-${CLAWDBOT_STATE_DIR:-/data/.clawdbot}}"
export OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${CLAWDBOT_CONFIG_PATH:-/data/.clawdbot/moltbot.json}}"
export OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-${CLAWDBOT_WORKSPACE_DIR:-/data/workspace}}"
export OPENCLAW_PUBLIC_PORT="${OPENCLAW_PUBLIC_PORT:-${CLAWDBOT_PUBLIC_PORT:-8080}}"
export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-${CLAWDBOT_GATEWAY_TOKEN:-}}"
echo "[entrypoint] OPENCLAW_CONFIG_PATH=$OPENCLAW_CONFIG_PATH"
echo "[entrypoint] OPENCLAW_STATE_DIR=$OPENCLAW_STATE_DIR"

# Set up gog CLI credentials if provided via environment variables
GOG_CONFIG_DIR="${HOME}/.config/gog"
GOG_DATA_DIR="${HOME}/.local/share/gogcli"

mkdir -p "$GOG_CONFIG_DIR"
mkdir -p "$GOG_DATA_DIR"

# Use file-based keyring (no macOS Keychain in Linux containers)
echo "[entrypoint] Setting gog keyring to file backend..."
gog auth keyring file 2>&1 || echo "[entrypoint] keyring set failed"

# Write credentials JSON if provided
if [ -n "$GOG_CREDENTIALS_JSON" ]; then
    echo "$GOG_CREDENTIALS_JSON" > "$GOG_CONFIG_DIR/client_secret.json"
    gog auth credentials "$GOG_CONFIG_DIR/client_secret.json" 2>&1 || echo "[entrypoint] credentials failed"
    echo "[entrypoint] gog credentials configured"
fi

# Import token if provided
if [ -n "$GOG_TOKEN_JSON" ]; then
    echo "$GOG_TOKEN_JSON" > /tmp/gog_token_import.json
    echo "[entrypoint] Importing gog token..."
    gog auth tokens import /tmp/gog_token_import.json 2>&1 || echo "[entrypoint] token import failed"
    rm -f /tmp/gog_token_import.json
    # Verify import
    echo "[entrypoint] Verifying gog auth..."
    gog auth list 2>&1 || echo "[entrypoint] auth list failed"
fi

# Copy tools prompt to workspace so Clawd can read it
if [ -f /app/CLAWD_TOOLS_PROMPT.md ]; then
    mkdir -p /data/workspace
    cp /app/CLAWD_TOOLS_PROMPT.md /data/workspace/CLAUDE.md
    echo "[entrypoint] Copied CLAWD_TOOLS_PROMPT.md to workspace"
fi

# Copy operational docs to workspace
# SOUL.md + AGENTS.md + IDENTITY.md + TOOLS.md in root (auto-injected at bootstrap)
# PRD.md + SUBAGENT-POLICY.md in docs/ (read on demand only — saves context)
mkdir -p /data/workspace/.learnings /data/workspace/docs
for doc in SOUL.md AGENTS.md IDENTITY.md TOOLS.md BOOT.md; do
    [ -f "/app/$doc" ] && cp "/app/$doc" "/data/workspace/$doc"
done
for doc in PRD.md SUBAGENT-POLICY.md; do
    [ -f "/app/$doc" ] && cp "/app/$doc" "/data/workspace/docs/$doc"
done
# Keep copies in docs/ for backward compatibility (CLAWD_TOOLS_PROMPT.md references docs/TOOLS.md)
[ -f "/app/IDENTITY.md" ] && cp "/app/IDENTITY.md" "/data/workspace/docs/IDENTITY.md"
[ -f "/app/TOOLS.md" ] && cp "/app/TOOLS.md" "/data/workspace/docs/TOOLS.md"
# Copy e-commerce tools prompts to docs/ (read on demand, not at bootstrap)
for doc in CLAWD_ETSY_TOOLS_PROMPT.md EBAY_CLAWD_TOOLS_PROMPT.md; do
    [ -f "/app/$doc" ] && cp "/app/$doc" "/data/workspace/docs/$doc"
done
[ -d "/app/.learnings" ] && cp -r /app/.learnings/* /data/workspace/.learnings/ 2>/dev/null

# Deploy hierarchical memory to workspace
# SEED-ONLY: Copy from repo only if file doesn't already exist on volume.
# The bot owns these files — it updates them at runtime. Overwriting on deploy
# destroys learned rules, preferences, and self-corrections.
# Source-controlled files (CLAUDE.md, SOUL.md, AGENTS.md, skills/, hooks/) are
# still overwritten above — those are developer-owned.
if [ -d "/app/memory" ]; then
    mkdir -p /data/workspace/memory/people /data/workspace/memory/projects /data/workspace/memory/reference /data/workspace/memory/daily /data/workspace/memory/chat-logs /data/workspace/memory/chat-summaries
    # Seed-only: copy from repo only if not already present on volume
    [ -f "/app/memory/MEMORY.md" ] && [ ! -f "/data/workspace/memory/MEMORY.md" ] && cp "/app/memory/MEMORY.md" "/data/workspace/memory/MEMORY.md"
    [ -f "/app/memory/learned-rules.md" ] && [ ! -f "/data/workspace/memory/learned-rules.md" ] && cp "/app/memory/learned-rules.md" "/data/workspace/memory/learned-rules.md"
    for subdir in people projects reference; do
        for f in /app/memory/$subdir/*.md; do
            [ -f "$f" ] && [ ! -f "/data/workspace/memory/$subdir/$(basename "$f")" ] && cp "$f" "/data/workspace/memory/$subdir/"
        done
    done
    # tasks.md: only copy from repo if it doesn't exist yet (preserve runtime data)
    [ ! -f "/data/workspace/memory/tasks.md" ] && [ -f "/app/memory/tasks.md" ] && cp "/app/memory/tasks.md" "/data/workspace/memory/tasks.md"
    # daily/ notes: never overwrite (these are runtime-written by the bot)
    echo "[entrypoint] Hierarchical memory deployed to workspace (seed-only)"
fi

# Clean workspace root: move bot-generated .md files to generated/ subdirectory
# Known root files (CLAUDE.md, SOUL.md, AGENTS.md, HEARTBEAT.md) stay; everything else moves
mkdir -p /data/workspace/generated
for f in /data/workspace/*.md; do
    [ -f "$f" ] || continue
    fname=$(basename "$f")
    case "$fname" in
        CLAUDE.md|SOUL.md|AGENTS.md|HEARTBEAT.md|IDENTITY.md|TOOLS.md|BOOT.md) ;; # keep known root files
        *) mv "$f" /data/workspace/generated/ 2>/dev/null || true ;;
    esac
done
echo "[entrypoint] Workspace root cleaned (bot-generated .md moved to generated/)"

echo "[entrypoint] Operational docs copied to workspace"

# Create symlinks for scripts in workspace AND /usr/local/bin so any path works
mkdir -p /data/workspace
for script in etsy.sh ebay.sh trendyol.sh pinterest.sh kolayxport.sh shopify.sh veeqo.sh backup-databases.sh security-review.sh test-scripts.sh cron-log.sh cron-health.sh ec2-report.sh; do
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/data/workspace/$script"
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/usr/local/bin/$script"
done
for script in erank.cjs idea-machine.cjs browser-automation.cjs shopify.cjs memory-synthesis.cjs usage-tracker.cjs urgent-alerts.cjs ecommerce-council.cjs financial-tracker.cjs saas-monitor.cjs nabavkidata-monitor.cjs ec2-cron-watchdog.cjs chat-history-export.cjs token-refresh.cjs; do
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/data/workspace/$script"
done
# Deploy skills to workspace (auto-discovered by gateway)
if [ -d "/app/skills" ]; then
    mkdir -p /data/workspace/skills
    for skill_dir in /app/skills/*/; do
        skill_name=$(basename "$skill_dir")
        # Recursively copy entire skill directory (md, references, scripts, etc.)
        cp -r "$skill_dir" "/data/workspace/skills/"
    done
    echo "[entrypoint] Skills deployed to workspace"
fi

# Deploy and install hooks (must use `clawdbot hooks install` for discovery)
if [ -d "/app/hooks" ]; then
    mkdir -p /data/workspace/hooks
    for hook_dir in /app/hooks/*/; do
        hook_name=$(basename "$hook_dir")
        # Copy to workspace for reference
        mkdir -p "/data/workspace/hooks/$hook_name"
        for f in "$hook_dir"*; do
            [ -f "$f" ] && cp "$f" "/data/workspace/hooks/$hook_name/"
        done
        # Install via clawdbot CLI (copies to /data/.clawdbot/hooks/)
        clawdbot hooks install "/data/workspace/hooks/$hook_name" 2>&1 || echo "[entrypoint] hook install failed: $hook_name"
        clawdbot hooks enable "$hook_name" 2>&1 || echo "[entrypoint] hook enable failed: $hook_name"
    done
    echo "[entrypoint] Hooks deployed and installed"
fi

echo "[entrypoint] Script symlinks created in workspace and PATH"

# Clean stale browser locks from dead containers (SingletonLock is a symlink, not a file!)
rm -f /data/.clawdbot/browser/*/user-data/SingletonLock /data/.clawdbot/browser/*/user-data/SingletonCookie /data/.clawdbot/browser/*/user-data/SingletonSocket 2>/dev/null && echo "[entrypoint] Cleaned stale browser locks" || true

# Pre-start Chrome for OpenClaw attachOnly mode (bypasses 15s hardcoded launch timeout)
CHROME_BIN="/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome"
CHROME_USER_DATA="/data/.clawdbot/browser/openclaw/user-data"
CHROME_CDP_PORT=18800
mkdir -p "$CHROME_USER_DATA"
echo "[entrypoint] Starting Chrome (CDP port $CHROME_CDP_PORT)..."
$CHROME_BIN \
    --headless --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --disable-background-networking --disable-extensions --disable-sync --no-first-run \
    --remote-debugging-port=$CHROME_CDP_PORT \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir="$CHROME_USER_DATA" \
    &>/tmp/chrome-startup.log &
CHROME_PID=$!

# Wait for Chrome CDP to be ready (up to 30s)
for i in $(seq 1 60); do
    if curl -s "http://127.0.0.1:$CHROME_CDP_PORT/json/version" >/dev/null 2>&1; then
        echo "[entrypoint] Chrome ready (PID $CHROME_PID, took $((i/2))s)"
        break
    fi
    sleep 0.5
done
if ! curl -s "http://127.0.0.1:$CHROME_CDP_PORT/json/version" >/dev/null 2>&1; then
    echo "[entrypoint] WARNING: Chrome did not become ready in 30s"
    cat /tmp/chrome-startup.log 2>/dev/null || true
fi

# Start the main application
exec node src/server.js
