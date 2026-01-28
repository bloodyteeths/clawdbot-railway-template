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

# Start the main application
exec node src/server.js
