#!/usr/bin/env bash
# Self-update script for OpenClaw on Railway.
# Called by Clawd (via exec API) when asked to update itself.
#
# Usage:
#   /app/scripts/self-update.sh              # update to latest stable
#   /app/scripts/self-update.sh v2026.3.8    # update to specific version
#   /app/scripts/self-update.sh --check      # only check, don't deploy
#
set -euo pipefail

RAILWAY_API="https://backboard.railway.com/graphql/v2"
PROJECT_ID="${RAILWAY_PROJECT_ID:-caf84229-f6c4-4c09-9be4-c500ce217e40}"
SERVICE_ID="${RAILWAY_SERVICE_ID:-dda20e46-0d46-4e1f-a3f4-d9f85e328f9c}"
ENV_ID="${RAILWAY_ENVIRONMENT_ID:-a9e7611f-87fc-4f74-9b9b-0b991c1832f7}"

# Require API token
if [ -z "${RAILWAY_API_TOKEN:-}" ]; then
  echo "ERROR: RAILWAY_API_TOKEN not set. Create one at https://railway.com/account/tokens"
  exit 1
fi

# Extract just the version number (e.g. "2026.3.8" from "OpenClaw 2026.3.8 (3caab92)")
current_version=$(clawdbot --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")

# Get latest version from npm
latest_version=$(npm view openclaw version 2>/dev/null || echo "unknown")

if [ "${1:-}" = "--check" ]; then
  echo "Current: $current_version"
  echo "Latest:  $latest_version"
  if [ "$current_version" = "$latest_version" ]; then
    echo "Already up to date."
  else
    echo "Update available: $current_version -> $latest_version"
  fi
  exit 0
fi

# Determine target version
if [ -n "${1:-}" ]; then
  target="$1"
else
  target="v${latest_version}"
fi

# Ensure target has 'v' prefix
[[ "$target" == v* ]] || target="v$target"

echo "Current version: $current_version"
echo "Target version:  $target"

if [ "v${current_version}" = "$target" ]; then
  echo "Already running $target — no update needed."
  exit 0
fi

# Step 1: Update the CLAWDBOT_GIT_REF build variable
echo "Updating CLAWDBOT_GIT_REF to $target ..."
response=$(curl -sf -X POST "$RAILWAY_API" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RAILWAY_API_TOKEN}" \
  -d "{
    \"query\": \"mutation { variableUpsert(input: { projectId: \\\"${PROJECT_ID}\\\", serviceId: \\\"${SERVICE_ID}\\\", environmentId: \\\"${ENV_ID}\\\", name: \\\"CLAWDBOT_GIT_REF\\\", value: \\\"${target}\\\" }) }\",
    \"variables\": {}
  }" 2>&1) || {
  echo "ERROR: Failed to update variable. Response: $response"
  exit 1
}

if echo "$response" | grep -q '"errors"'; then
  echo "ERROR: Railway API returned errors: $response"
  exit 1
fi

echo "Variable updated."

# Step 2: Trigger redeploy
echo "Triggering redeploy ..."
deploy_response=$(curl -sf -X POST "$RAILWAY_API" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RAILWAY_API_TOKEN}" \
  -d "{
    \"query\": \"mutation { serviceInstanceRedeploy(serviceId: \\\"${SERVICE_ID}\\\", environmentId: \\\"${ENV_ID}\\\") }\",
    \"variables\": {}
  }" 2>&1) || {
  echo "ERROR: Failed to trigger redeploy. Response: $deploy_response"
  exit 1
}

if echo "$deploy_response" | grep -q '"errors"'; then
  echo "ERROR: Railway API returned errors: $deploy_response"
  exit 1
fi

echo ""
echo "SUCCESS: OpenClaw update $current_version -> $target initiated!"
echo "A new build is starting on Railway. The container will restart in ~10-15 minutes."
echo "After restart, verify with: clawdbot --version"
