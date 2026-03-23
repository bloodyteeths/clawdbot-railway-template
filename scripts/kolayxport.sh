#!/bin/bash
# KolayXport Orders API helper for Clawd
# Usage: ./kolayxport.sh [command] [options]
#
# Commands:
#   orders                  - List all orders (default: limit 10)
#   orders --status X       - Filter by status (Picking, Shipped, Delivered, etc.)
#   orders --customer NAME  - Search by customer name
#   orders --limit N        - Limit results
#   order ID                - Get specific order by ID

set -e

API_URL="${KOLAYXPORT_API_URL:-https://kolayxport.com/api/clawd}"
API_KEY="${KOLAYXPORT_API_KEY}"

if [ -z "$API_KEY" ]; then
    echo "Error: KOLAYXPORT_API_KEY environment variable not set"
    exit 1
fi

# Parse command
CMD="${1:-orders}"
shift 2>/dev/null || true

# Build query params
PARAMS="apiKey=${API_KEY}"

case "$CMD" in
    orders)
        ENDPOINT="/orders"
        # Parse options
        while [[ $# -gt 0 ]]; do
            case $1 in
                --status)
                    PARAMS="${PARAMS}&status=$2"
                    shift 2
                    ;;
                --customer)
                    # URL encode the customer name
                    CUSTOMER=$(echo -n "$2" | jq -sRr @uri)
                    PARAMS="${PARAMS}&customer=${CUSTOMER}"
                    shift 2
                    ;;
                --limit)
                    PARAMS="${PARAMS}&limit=$2"
                    shift 2
                    ;;
                *)
                    shift
                    ;;
            esac
        done
        # Default limit if not specified
        if [[ ! "$PARAMS" =~ "limit=" ]]; then
            PARAMS="${PARAMS}&limit=10"
        fi
        ;;
    order)
        ORDER_ID="$1"
        if [ -z "$ORDER_ID" ]; then
            echo "Error: Order ID required"
            echo "Usage: kolayxport.sh order <order-id>"
            exit 1
        fi
        ENDPOINT="/orders"
        PARAMS="${PARAMS}&id=${ORDER_ID}"
        ;;
    *)
        echo "Unknown command: $CMD"
        echo "Usage: kolayxport.sh [orders|order] [options]"
        exit 1
        ;;
esac

# Make API request
RESPONSE=$(curl -s "${API_URL}${ENDPOINT}?${PARAMS}")

# Format output with full customer and shipping details
echo "$RESPONSE" | jq -r '
if type == "array" then
    if length == 0 then
        "No orders found."
    else
        "Found \(length) order(s):\n" +
        (to_entries | map(
            "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" +
            "\n📋 ORDER #\(.value.orderNumber // "N/A")" +
            "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +

            "Status: \(.value.status // "N/A")\n" +
            "Marketplace: \(.value.marketplace // "N/A")\n" +
            "Total: \(.value.totalPrice // 0) \(.value.currency // "TRY")\n" +
            "Order Date: \(.value.rawData.uiOrderDate // .value.createdAt // "N/A")\n" +

            "\n👤 CUSTOMER\n" +
            "   Name: \(.value.rawData.shipmentAddress.firstName // "") \(.value.rawData.shipmentAddress.lastName // "")\n" +
            "   Phone: \(.value.rawData.shipmentAddress.phone // "Not provided")\n" +

            "\n📍 SHIPPING ADDRESS\n" +
            "   \(.value.rawData.shipmentAddress.fullName // "")\n" +
            "   \(.value.rawData.shipmentAddress.address1 // "")\n" +
            "   \(.value.rawData.shipmentAddress.neighborhood // ""), \(.value.rawData.shipmentAddress.district // "")\n" +
            "   \(.value.rawData.shipmentAddress.city // "") \(.value.rawData.shipmentAddress.postalCode // "")\n" +
            "   \(.value.rawData.shipmentAddress.countryCode // "TR")\n" +

            "\n📦 SHIPPING\n" +
            "   Tracking: " + (
                if .value.rawData.cargoTrackingNumber then
                    (.value.rawData.cargoTrackingNumber | tostring)
                else
                    "Not yet assigned"
                end
            ) + "\n" +
            "   Carrier: \(.value.rawData.cargoProviderName // "N/A")\n" +
            "   Ship By: \(.value.items[0].shipBy // "N/A")\n" +

            "\n🛒 ITEMS\n" + (
                if .value.items then
                    (.value.items | map(
                        "   • \(.productName)\n" +
                        "     Variant: \(.variantInfo // "N/A")\n" +
                        "     SKU: \(.sku // "N/A")\n" +
                        "     Qty: \(.quantity) × \(.unitPrice) \(.value.currency // "TRY")"
                    ) | join("\n"))
                else
                    "   N/A"
                end
            )
        ) | join("\n\n"))
    end
else
    . | tostring
end
' 2>/dev/null || echo "$RESPONSE"
