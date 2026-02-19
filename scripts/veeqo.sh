#!/bin/bash
# Veeqo API helper for Clawd (eBay + inventory management)
# Usage: ./veeqo.sh [command] [options]
#
# Commands:
#   PRODUCTS:
#     products                  - List all products
#     products --query TERM     - Search by name/SKU
#     product ID                - Get specific product
#     create-product            - Create product (reads JSON from stdin)
#     update-product ID         - Update product (reads JSON from stdin)
#     delete-product ID         - Delete a product
#
#   INVENTORY:
#     stock SELLABLE_ID WH_ID   - Get stock level for variant in warehouse
#     set-stock SELLABLE_ID WH_ID LEVEL - Set stock level
#     low-stock                 - List all products with low stock
#
#   ORDERS:
#     orders                    - List recent orders
#     orders --status STATUS    - Filter by status
#     order ID                  - Get specific order
#     fulfill ID                - Fulfill order with tracking (reads JSON from stdin)
#
#   SHIPPING:
#     rates ALLOCATION_ID       - Get shipping rates for an allocation
#     buy-label                 - Purchase shipping label (reads JSON from stdin)
#
#   OTHER:
#     channels                  - List connected stores/channels
#     warehouses                - List warehouses
#     customers                 - List customers

set -e

API_URL="https://api.veeqo.com"
API_KEY="${VEEQO_API_KEY}"

if [ -z "$API_KEY" ]; then
    echo "Error: VEEQO_API_KEY environment variable not set"
    exit 1
fi

CMD="${1:-products}"
shift 2>/dev/null || true

# Common curl wrapper
veeqo_get() {
    curl -sf -H "x-api-key: ${API_KEY}" -H "Accept: application/json" "$1"
}

veeqo_post() {
    curl -sf -X POST -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" -H "Accept: application/json" "$1" -d "$2"
}

veeqo_put() {
    curl -sf -X PUT -H "x-api-key: ${API_KEY}" -H "Content-Type: application/json" -H "Accept: application/json" "$1" -d "$2"
}

veeqo_delete() {
    curl -sf -X DELETE -H "x-api-key: ${API_KEY}" -H "Accept: application/json" "$1"
}

case "$CMD" in

    # ==================== PRODUCTS ====================

    products)
        PARAMS="page_size=50&page=1"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --query|-q)
                    QUERY=$(echo -n "$2" | jq -sRr @uri)
                    PARAMS="${PARAMS}&query=${QUERY}"
                    shift 2
                    ;;
                --page)
                    PARAMS=$(echo "$PARAMS" | sed "s/page=1/page=$2/")
                    shift 2
                    ;;
                --limit)
                    PARAMS=$(echo "$PARAMS" | sed "s/page_size=50/page_size=$2/")
                    shift 2
                    ;;
                *)
                    shift
                    ;;
            esac
        done
        RESPONSE=$(veeqo_get "${API_URL}/products?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then
                "No products found."
            else
                "Found \(length) product(s):\n" +
                (map(
                    "\n━━━ Product #\(.id) ━━━\n" +
                    "Title: \(.title)\n" +
                    "SKUs: \(.sellables | map(.sku_code // "N/A") | join(", "))\n" +
                    "Variants: \(.sellables | length)\n" +
                    "Stock: \(.sellables | map(
                        "\(.sku_code // "?"): \(.total_quantity_sold // 0) sold, " +
                        "\(.stock_entries | map(.physical_stock_level // 0) | add // 0) in stock" +
                        (if .stock_entries | any(.stock_running_low == true) then " ⚠️ LOW" else "" end)
                    ) | join("; "))\n" +
                    "Price: \(.sellables[0].price // "N/A")\n" +
                    "Channels: \(.channel_products | map(.channel.name // "?") | join(", "))"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    product)
        PRODUCT_ID="$1"
        if [ -z "$PRODUCT_ID" ]; then
            echo "Usage: veeqo.sh product <product_id>"
            exit 1
        fi
        RESPONSE=$(veeqo_get "${API_URL}/products/${PRODUCT_ID}")
        echo "$RESPONSE" | jq -r '
        "━━━ Product #\(.id) ━━━\n" +
        "Title: \(.title)\n" +
        "Description: \(.description // "N/A" | .[0:200])\n" +
        "Created: \(.created_at)\n" +
        "\nVariants (\(.sellables | length)):" +
        (.sellables | map(
            "\n  [\(.id)] \(.sku_code // "N/A") — $\(.price // 0)" +
            "\n    Weight: \(.weight_grams // 0)g" +
            "\n    Min reorder: \(.min_reorder_level // "N/A")" +
            "\n    Reorder qty: \(.quantity_to_reorder // "N/A")" +
            "\n    Stock:" +
            (.stock_entries | map(
                "\n      WH#\(.warehouse_id): \(.physical_stock_level // 0) physical, \(.available_stock_level // 0) available" +
                (if .stock_running_low == true then " ⚠️ LOW" else "" end) +
                " [\(.location // "no location")]"
            ) | join(""))
        ) | join("\n")) +
        "\n\nChannels:" +
        (.channel_products | map(
            "\n  \(.channel.name // "?"): remote #\(.remote_product_id // "N/A")"
        ) | join(""))
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    create-product)
        JSON_BODY=$(cat)
        RESPONSE=$(veeqo_post "${API_URL}/products" "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        "Product created!\n" +
        "ID: \(.id)\n" +
        "Title: \(.title)\n" +
        "Variants: \(.sellables | length)\n" +
        "SKUs: \(.sellables | map(.sku_code) | join(", "))"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    update-product)
        PRODUCT_ID="$1"
        if [ -z "$PRODUCT_ID" ]; then
            echo "Usage: echo '{\"product\":{\"title\":\"New\"}}' | veeqo.sh update-product <id>"
            exit 1
        fi
        JSON_BODY=$(cat)
        RESPONSE=$(veeqo_put "${API_URL}/products/${PRODUCT_ID}" "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        "Product #\(.id) updated!\n" +
        "Title: \(.title)"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    delete-product)
        PRODUCT_ID="$1"
        if [ -z "$PRODUCT_ID" ]; then
            echo "Usage: veeqo.sh delete-product <product_id>"
            exit 1
        fi
        veeqo_delete "${API_URL}/products/${PRODUCT_ID}"
        echo "Product #${PRODUCT_ID} deleted."
        ;;

    # ==================== INVENTORY ====================

    stock)
        SELLABLE_ID="$1"
        WAREHOUSE_ID="$2"
        if [ -z "$SELLABLE_ID" ] || [ -z "$WAREHOUSE_ID" ]; then
            echo "Usage: veeqo.sh stock <sellable_id> <warehouse_id>"
            echo ""
            echo "  sellable_id = variant ID (from product response)"
            echo "  warehouse_id = warehouse ID (from 'veeqo.sh warehouses')"
            exit 1
        fi
        RESPONSE=$(veeqo_get "${API_URL}/sellables/${SELLABLE_ID}/warehouses/${WAREHOUSE_ID}/stock_entry")
        echo "$RESPONSE" | jq -r '
        "Stock for variant #\(.sellable_id) in warehouse #\(.warehouse_id):\n" +
        "  Physical: \(.physical_stock_level // 0)\n" +
        "  Available: \(.available_stock_level // 0)\n" +
        "  Allocated: \(.allocated_stock_level // 0)\n" +
        "  Incoming: \(.incoming_stock_level // 0)\n" +
        "  Low stock: \(.stock_running_low // false)\n" +
        "  Infinite: \(.infinite // false)\n" +
        "  Location: \(.location // "N/A")"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    set-stock)
        SELLABLE_ID="$1"
        WAREHOUSE_ID="$2"
        LEVEL="$3"
        if [ -z "$SELLABLE_ID" ] || [ -z "$WAREHOUSE_ID" ] || [ -z "$LEVEL" ]; then
            echo "Usage: veeqo.sh set-stock <sellable_id> <warehouse_id> <level>"
            exit 1
        fi
        RESPONSE=$(veeqo_put "${API_URL}/sellables/${SELLABLE_ID}/warehouses/${WAREHOUSE_ID}/stock_entry" \
            "{\"stock_entry\":{\"physical_stock_level\":${LEVEL}}}")
        echo "$RESPONSE" | jq -r '
        "Stock updated!\n" +
        "  Variant: \(.sellable_id)\n" +
        "  Warehouse: \(.warehouse_id)\n" +
        "  Physical: \(.physical_stock_level)\n" +
        "  Available: \(.available_stock_level)"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    low-stock)
        # Fetch all products and filter for low stock
        PAGE=1
        ALL_LOW=""
        while true; do
            RESPONSE=$(veeqo_get "${API_URL}/products?page_size=100&page=${PAGE}")
            if [ -z "$RESPONSE" ] || [ "$RESPONSE" = "[]" ]; then
                break
            fi
            LOW=$(echo "$RESPONSE" | jq -r '
            [.[] | {
                id: .id,
                title: .title,
                variants: [.sellables[] | select(
                    .stock_entries | any(.stock_running_low == true)
                ) | {
                    sku: .sku_code,
                    sellable_id: .id,
                    stock: [.stock_entries[] | select(.stock_running_low == true) | {
                        warehouse_id: .warehouse_id,
                        physical: .physical_stock_level,
                        available: .available_stock_level,
                        min_reorder: .sellable.min_reorder_level
                    }]
                }]
            } | select(.variants | length > 0)]
            ')
            if [ "$LOW" != "[]" ] && [ -n "$LOW" ]; then
                ALL_LOW="${ALL_LOW}${LOW}"
            fi
            COUNT=$(echo "$RESPONSE" | jq 'length')
            if [ "$COUNT" -lt 100 ]; then
                break
            fi
            PAGE=$((PAGE + 1))
        done

        if [ -z "$ALL_LOW" ] || [ "$ALL_LOW" = "[]" ]; then
            echo "No products with low stock."
        else
            echo "$ALL_LOW" | jq -rs '
            flatten | if length == 0 then
                "No products with low stock."
            else
                "⚠️ LOW STOCK ALERT — \(length) product(s):\n" +
                (map(
                    "\n━━━ \(.title) (Product #\(.id)) ━━━" +
                    (.variants | map(
                        "\n  SKU: \(.sku) (variant #\(.sellable_id))" +
                        (.stock | map(
                            "\n    WH#\(.warehouse_id): \(.physical) physical, \(.available) available"
                        ) | join(""))
                    ) | join(""))
                ) | join("\n"))
            end
            '
        fi
        ;;

    # ==================== ORDERS ====================

    orders)
        PARAMS="page_size=25&page=1"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --status|-s)
                    PARAMS="${PARAMS}&status=$2"
                    shift 2
                    ;;
                --query|-q)
                    QUERY=$(echo -n "$2" | jq -sRr @uri)
                    PARAMS="${PARAMS}&query=${QUERY}"
                    shift 2
                    ;;
                --since)
                    SINCE=$(echo -n "$2" | jq -sRr @uri)
                    PARAMS="${PARAMS}&created_at_min=${SINCE}"
                    shift 2
                    ;;
                --limit)
                    PARAMS=$(echo "$PARAMS" | sed "s/page_size=25/page_size=$2/")
                    shift 2
                    ;;
                --page)
                    PARAMS=$(echo "$PARAMS" | sed "s/page=1/page=$2/")
                    shift 2
                    ;;
                *)
                    shift
                    ;;
            esac
        done
        RESPONSE=$(veeqo_get "${API_URL}/orders?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then
                "No orders found."
            else
                "Found \(length) order(s):\n" +
                (map(
                    "\n━━━ Order #\(.number) (ID: \(.id)) ━━━\n" +
                    "Channel: \(.channel.name // "N/A")\n" +
                    "Customer: \(.customer.full_name // "N/A")\n" +
                    "Email: \(.customer.email // "N/A")\n" +
                    "Status: \(.status)\n" +
                    "Total: \(.total_price // "N/A")\n" +
                    "Date: \(.created_at)\n" +
                    "Items: \(.line_items | map("\(.sellable.product_title // "?") x\(.quantity)") | join(", "))"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    order)
        ORDER_ID="$1"
        if [ -z "$ORDER_ID" ]; then
            echo "Usage: veeqo.sh order <order_id>"
            exit 1
        fi
        RESPONSE=$(veeqo_get "${API_URL}/orders/${ORDER_ID}")
        echo "$RESPONSE" | jq -r '
        "━━━ Order #\(.number) (ID: \(.id)) ━━━\n" +
        "Channel: \(.channel.name // "N/A")\n" +
        "Status: \(.status)\n" +
        "Created: \(.created_at)\n" +
        "\nCustomer:\n" +
        "  Name: \(.customer.full_name // "N/A")\n" +
        "  Email: \(.customer.email // "N/A")\n" +
        "  Phone: \(.customer.phone // "N/A")\n" +
        "\nShipping Address:\n" +
        "  \(.deliver_to.first_name // "") \(.deliver_to.last_name // "")\n" +
        "  \(.deliver_to.address1 // "")\n" +
        "  \(.deliver_to.city // ""), \(.deliver_to.state // "") \(.deliver_to.zip // "")\n" +
        "  \(.deliver_to.country // "")\n" +
        "\nItems:" +
        (.line_items | map(
            "\n  - \(.sellable.product_title // "?") x\(.quantity)" +
            "\n    SKU: \(.sellable.sku_code // "N/A")" +
            "\n    Price: \(.price_per_unit // "N/A")"
        ) | join("")) +
        "\n\nTotal: \(.total_price // "N/A")" +
        "\nSubtotal: \(.subtotal_price // "N/A")" +
        "\nShipping: \(.total_shipping_cost // "0")" +
        "\nTax: \(.total_tax // "0")" +
        "\n\nAllocations:" +
        (.allocations | map(
            "\n  ID: \(.id) — Warehouse: \(.warehouse.name // "?")"
        ) | join("")) +
        "\n\nShipments:" +
        (if .shipments | length > 0 then
            .shipments | map(
                "\n  Tracking: \(.tracking_number // "N/A")" +
                "\n  Carrier: \(.carrier_name // "N/A")"
            ) | join("")
        else
            "\n  None"
        end)
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    fulfill)
        ORDER_ID="$1"
        if [ -z "$ORDER_ID" ]; then
            echo "Usage: echo '{\"tracking_number\":\"...\",\"carrier_id\":0}' | veeqo.sh fulfill <order_id>"
            echo ""
            echo "This gets the first allocation and creates a shipment."
            echo "Fields: tracking_number (required), carrier_id (0 for manual), notify_customer (default: true)"
            exit 1
        fi
        # Get allocation ID from order
        ORDER_DATA=$(veeqo_get "${API_URL}/orders/${ORDER_ID}")
        ALLOCATION_ID=$(echo "$ORDER_DATA" | jq -r '.allocations[0].id // empty')
        if [ -z "$ALLOCATION_ID" ]; then
            echo "Error: No allocation found for order #${ORDER_ID}. Allocate first."
            exit 1
        fi
        JSON_INPUT=$(cat)
        TRACKING=$(echo "$JSON_INPUT" | jq -r '.tracking_number // empty')
        CARRIER_ID=$(echo "$JSON_INPUT" | jq -r '.carrier_id // 0')
        NOTIFY=$(echo "$JSON_INPUT" | jq -r '.notify_customer // true')
        SHIPMENT_JSON="{\"shipment\":{\"order_id\":${ORDER_ID},\"allocation_id\":${ALLOCATION_ID},\"carrier_id\":${CARRIER_ID},\"notify_customer\":${NOTIFY},\"update_remote_order\":true,\"tracking_number_attributes\":{\"tracking_number\":\"${TRACKING}\"}}}"
        RESPONSE=$(veeqo_post "${API_URL}/shipments" "$SHIPMENT_JSON")
        echo "$RESPONSE" | jq -r '
        "Order fulfilled!\n" +
        "Shipment ID: \(.id // "N/A")\n" +
        "Tracking: \(.tracking_number // "N/A")\n" +
        "Carrier: \(.carrier_name // "Manual")"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== SHIPPING ====================

    rates)
        ALLOCATION_ID="$1"
        if [ -z "$ALLOCATION_ID" ]; then
            echo "Usage: veeqo.sh rates <allocation_id>"
            exit 1
        fi
        RESPONSE=$(veeqo_get "${API_URL}/shipping/rates/${ALLOCATION_ID}?from_allocation_package=true")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    buy-label)
        JSON_BODY=$(cat)
        RESPONSE=$(veeqo_post "${API_URL}/shipping/shipments" "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        "Label purchased!\n" +
        "Shipment ID: \(.id // "N/A")\n" +
        "Tracking URL: \(.tracking_url // "N/A")\n" +
        "Label URL: \(.label_url // "N/A")\n" +
        "Cost: \(.outbound_label_charges // "N/A")"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== OTHER ====================

    channels)
        RESPONSE=$(veeqo_get "${API_URL}/channels")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            "Connected channels (\(length)):\n" +
            (map(
                "\n━━━ \(.name // "?") ━━━\n" +
                "  ID: \(.id)\n" +
                "  Type: \(.type_code // "N/A")\n" +
                "  Active: \(.active // false)\n" +
                "  URL: \(.url // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    warehouses)
        RESPONSE=$(veeqo_get "${API_URL}/warehouses")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            "Warehouses (\(length)):\n" +
            (map(
                "  [\(.id)] \(.name) — \(.city // "?"), \(.country // "?")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    customers)
        PARAMS="page_size=25&page=1"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --query|-q)
                    QUERY=$(echo -n "$2" | jq -sRr @uri)
                    PARAMS="${PARAMS}&query=${QUERY}"
                    shift 2
                    ;;
                *)
                    shift
                    ;;
            esac
        done
        RESPONSE=$(veeqo_get "${API_URL}/customers?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            "Customers (\(length)):\n" +
            (map(
                "  [\(.id)] \(.full_name // "N/A") — \(.email // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    help|*)
        echo "Veeqo API Helper for Clawd (eBay + Inventory)"
        echo ""
        echo "Usage: veeqo.sh [command] [options]"
        echo ""
        echo "PRODUCTS:"
        echo "  products                     - List all products"
        echo "  products --query TERM        - Search by name/SKU"
        echo "  products --limit N           - Limit results"
        echo "  product ID                   - Get specific product details"
        echo "  create-product               - Create product (JSON from stdin)"
        echo "  update-product ID            - Update product (JSON from stdin)"
        echo "  delete-product ID            - Delete a product"
        echo ""
        echo "INVENTORY:"
        echo "  stock SELLABLE_ID WH_ID      - Get stock for variant in warehouse"
        echo "  set-stock SELLABLE_ID WH_ID LEVEL - Set stock level"
        echo "  low-stock                    - List all products with low stock"
        echo ""
        echo "ORDERS:"
        echo "  orders                       - List recent orders"
        echo "  orders --status STATUS       - Filter (awaiting_fulfillment, shipped, etc.)"
        echo "  orders --query TERM          - Search orders"
        echo "  orders --since DATE          - Orders since date (YYYY-MM-DD)"
        echo "  order ID                     - Get order details"
        echo "  fulfill ID                   - Fulfill with tracking (JSON from stdin)"
        echo ""
        echo "SHIPPING:"
        echo "  rates ALLOCATION_ID          - Get shipping rates"
        echo "  buy-label                    - Purchase label (JSON from stdin)"
        echo ""
        echo "OTHER:"
        echo "  channels                     - List connected stores"
        echo "  warehouses                   - List warehouses"
        echo "  customers                    - List customers"
        echo ""
        echo "EXAMPLES:"
        echo "  veeqo.sh products --query 'gift box'"
        echo "  veeqo.sh orders --status awaiting_fulfillment"
        echo "  veeqo.sh low-stock"
        echo "  veeqo.sh set-stock 14504036 22668 50"
        echo "  echo '{\"tracking_number\":\"1Z999\"}' | veeqo.sh fulfill 12345"
        echo ""
        echo "  # Create product:"
        echo "  echo '{"
        echo "    \"product\": {"
        echo "      \"title\": \"Gift Box\","
        echo "      \"product_variants_attributes\": [{"
        echo "        \"title\": \"Default\","
        echo "        \"sku_code\": \"GB-001\","
        echo "        \"price\": 29.99,"
        echo "        \"min_reorder_level\": 5,"
        echo "        \"quantity_to_reorder\": 20"
        echo "      }]"
        echo "    }"
        echo "  }' | veeqo.sh create-product"
        ;;
esac
