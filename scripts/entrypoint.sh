#!/bin/bash
set -e

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
# SOUL.md + AGENTS.md in root (read at session start)
# PRD.md + SUBAGENT-POLICY.md + IDENTITY.md in docs/ (read on demand only — saves context)
mkdir -p /data/workspace/.learnings /data/workspace/docs
for doc in SOUL.md AGENTS.md; do
    [ -f "/app/$doc" ] && cp "/app/$doc" "/data/workspace/$doc"
done
for doc in PRD.md SUBAGENT-POLICY.md IDENTITY.md TOOLS.md; do
    [ -f "/app/$doc" ] && cp "/app/$doc" "/data/workspace/docs/$doc"
done
[ -d "/app/.learnings" ] && cp -r /app/.learnings/* /data/workspace/.learnings/ 2>/dev/null

# Deploy hierarchical memory to workspace (always overwrite from repo — repo is source of truth)
if [ -d "/app/memory" ]; then
    mkdir -p /data/workspace/memory/people /data/workspace/memory/projects /data/workspace/memory/reference
    for f in /app/memory/*.md; do
        [ -f "$f" ] && cp "$f" "/data/workspace/memory/"
    done
    for subdir in people projects reference; do
        for f in /app/memory/$subdir/*.md; do
            [ -f "$f" ] && cp "$f" "/data/workspace/memory/$subdir/"
        done
    done
    echo "[entrypoint] Hierarchical memory deployed to workspace"
fi

echo "[entrypoint] Operational docs copied to workspace"

# Create symlinks for scripts in workspace AND /usr/local/bin so any path works
mkdir -p /data/workspace
for script in etsy.sh trendyol.sh pinterest.sh kolayxport.sh shopify.sh veeqo.sh backup-databases.sh security-review.sh test-scripts.sh cron-log.sh cron-health.sh; do
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/data/workspace/$script"
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/usr/local/bin/$script"
done
for script in erank.cjs idea-machine.cjs browser-automation.cjs shopify.cjs memory-synthesis.cjs usage-tracker.cjs urgent-alerts.cjs ecommerce-council.cjs financial-tracker.cjs saas-monitor.cjs; do
    [ -f "/app/scripts/$script" ] && ln -sf "/app/scripts/$script" "/data/workspace/$script"
done
# Deploy skills to workspace (auto-discovered by gateway)
if [ -d "/app/skills" ]; then
    mkdir -p /data/workspace/skills
    for skill_dir in /app/skills/*/; do
        skill_name=$(basename "$skill_dir")
        mkdir -p "/data/workspace/skills/$skill_name"
        for f in "$skill_dir"*.md; do
            [ -f "$f" ] && cp "$f" "/data/workspace/skills/$skill_name/"
        done
    done
    echo "[entrypoint] Skills deployed to workspace"
fi

echo "[entrypoint] Script symlinks created in workspace and PATH"

# Start the main application
exec node src/server.js
