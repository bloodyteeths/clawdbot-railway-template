#!/bin/bash
# Shopify API helper for Clawd
# Wrapper for shopify.cjs - direct Shopify Admin API integration
#
# Setup:
#   1. Create custom app in Shopify Admin > Settings > Apps > Develop apps
#   2. Set: SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN in Railway
#
# Commands:
#   status                   - Check connection and shop info
#   products                 - List products
#   product <id>             - Get product details
#   create-product           - Create product (JSON stdin)
#   update-product <id>      - Update product (JSON stdin)
#   delete-product <id>      - Delete product
#   orders                   - List orders
#   order <id>               - Order details
#   fulfill <order_id>       - Fulfill order
#   cancel <order_id>        - Cancel order
#   customers                - List customers
#   customer <id>            - Customer details
#   sales                    - Sales summary
#   sync-from-etsy <id>      - Import Etsy listing

SCRIPT_DIR="$(dirname "$0")"
NODE_SCRIPT="${SCRIPT_DIR}/shopify.cjs"

# Check if node script exists
if [ ! -f "$NODE_SCRIPT" ]; then
    echo "Error: shopify.cjs not found"
    exit 1
fi

# Pass all arguments to node script
exec node "$NODE_SCRIPT" "$@"
