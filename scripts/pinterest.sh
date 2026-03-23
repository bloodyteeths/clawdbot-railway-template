#!/bin/bash
# Pinterest API helper for Clawd
# Wrapper for pinterest.cjs - direct Pinterest API integration
#
# Setup:
#   1. Create Pinterest App at https://developers.pinterest.com/apps/
#   2. Set: PINTEREST_APP_ID, PINTEREST_APP_SECRET in Railway
#   3. Run: pinterest.sh auth - to connect Pinterest account
#
# Commands:
#   auth                      - Get OAuth URL / check status
#   callback <code>           - Exchange code for token
#   boards                    - List boards
#   create-board              - Create board (JSON from stdin)
#   pins <board_id>           - List pins in board
#   create-pin                - Create pin (JSON from stdin)
#   pin-from-etsy <id>        - Create pin from Etsy listing
#   analytics                 - Get analytics

SCRIPT_DIR="$(dirname "$0")"
NODE_SCRIPT="${SCRIPT_DIR}/pinterest.cjs"

# Check if node script exists
if [ ! -f "$NODE_SCRIPT" ]; then
    echo "Error: pinterest.cjs not found"
    exit 1
fi

# Pass all arguments to node script
exec node "$NODE_SCRIPT" "$@"
