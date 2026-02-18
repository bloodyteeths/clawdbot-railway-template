#!/bin/bash
# Trendyol API helper for Clawd (via KolayXport)
# Usage: ./trendyol.sh [command] [options]
#
# Commands:
#   products                     - List products
#   product BARCODE              - Get specific product
#   create-product               - Create product (reads JSON from stdin)
#   update-product               - Update product (reads JSON from stdin)
#   update-stock-price           - Bulk update stock & price (reads JSON from stdin)
#   batch-status BATCH_ID        - Check batch request status
#   archive BARCODE              - Archive a product
#   categories                   - List all categories
#   category-attributes CAT_ID   - Get attributes for category
#   brands --name SEARCH         - Search brands
#   orders                       - List orders
#   order ORDER_NUMBER           - Get specific order
#   update-tracking              - Update cargo tracking (reads JSON from stdin)
#   shipping-label TRACKING      - Get shipping label
#   send-invoice                 - Send invoice link (reads JSON from stdin)
#   claims                       - List returns/claims
#   approve-claim                - Approve return (reads JSON from stdin)
#   questions                    - List customer questions
#   answer-question              - Answer question (reads JSON from stdin)
#   settlements                  - Get account statements
#   addresses                    - Get seller addresses
#   cargo-companies              - List cargo companies

set -e

API_URL="${KOLAYXPORT_API_URL:-https://kolayxport.com/api/clawd}"
API_KEY="${KOLAYXPORT_API_KEY}"

if [ -z "$API_KEY" ]; then
    echo "Error: KOLAYXPORT_API_KEY environment variable not set"
    exit 1
fi

CMD="${1:-products}"
shift 2>/dev/null || true

case "$CMD" in

    # ==================== PRODUCTS ====================

    products)
        PARAMS="apiKey=${API_KEY}&action=products"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                --size) PARAMS="${PARAMS}&size=$2"; shift 2 ;;
                --approved) PARAMS="${PARAMS}&approved=$2"; shift 2 ;;
                --onSale|--on-sale) PARAMS="${PARAMS}&onSale=$2"; shift 2 ;;
                --rejected) PARAMS="${PARAMS}&rejected=$2"; shift 2 ;;
                --barcode) PARAMS="${PARAMS}&barcode=$2"; shift 2 ;;
                --stockCode|--sku) PARAMS="${PARAMS}&stockCode=$2"; shift 2 ;;
                --brandId) PARAMS="${PARAMS}&brandId=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if .content then
            "Total: \(.totalElements // "?") products (page \(.page // 0)+1 of \(.totalPages // "?"))\n" +
            (.content | to_entries | map(
                "\n━━━ \(.value.stockCode // .value.barcode) ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Barcode: \(.value.barcode // "N/A")\n" +
                "Brand: \(.value.brandName // "N/A")\n" +
                "Category: \(.value.categoryName // "N/A")\n" +
                "Sale Price: \(.value.salePrice // 0) TRY\n" +
                "List Price: \(.value.listPrice // 0) TRY\n" +
                "Stock: \(.value.quantity // 0)\n" +
                "Status: " + (
                    if .value.onSale then "On Sale"
                    elif .value.approved then "Approved"
                    elif .value.rejected then "Rejected"
                    elif .value.blacklisted then "Blacklisted"
                    else "Pending"
                    end
                )
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    product)
        BARCODE="$1"
        if [ -z "$BARCODE" ]; then
            echo "Usage: trendyol.sh product <barcode_or_stockCode>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=product&barcode=${BARCODE}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    create-product)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/trendyol?apiKey=${API_KEY}&action=create_products" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .batchRequestId then
            "Product creation submitted!\n" +
            "Batch ID: \(.batchRequestId)\n" +
            "\nCheck status with: trendyol.sh batch-status \(.batchRequestId)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    update-product)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "${API_URL}/trendyol?apiKey=${API_KEY}&action=update_product" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .batchRequestId then
            "Product update submitted!\n" +
            "Batch ID: \(.batchRequestId)\n" +
            "\nCheck status with: trendyol.sh batch-status \(.batchRequestId)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    update-stock-price)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "${API_URL}/trendyol?apiKey=${API_KEY}&action=update_price_and_inventory" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .batchRequestId then
            "Stock & price update submitted!\n" +
            "Batch ID: \(.batchRequestId)\n" +
            "\nCheck status with: trendyol.sh batch-status \(.batchRequestId)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    batch-status)
        BATCH_ID="$1"
        if [ -z "$BATCH_ID" ]; then
            echo "Usage: trendyol.sh batch-status <batch_request_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=batch_status&batchRequestId=${BATCH_ID}")
        echo "$RESPONSE" | jq -r '
        "Batch: \(.batchRequestId // "N/A")\n" +
        "Status: \(.status // "N/A")\n" +
        "Total: \(.itemCount // 0) items\n" +
        "Failed: \(.failedItemCount // 0)\n" +
        if (.failedReasons | length) > 0 then
            "\nErrors:\n" + (.failedReasons | map("  - \(.reason // "unknown")") | join("\n"))
        else "" end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    archive)
        BARCODE="$1"
        if [ -z "$BARCODE" ]; then
            echo "Usage: trendyol.sh archive <barcode>"
            exit 1
        fi
        RESPONSE=$(curl -s -X PUT "${API_URL}/trendyol?apiKey=${API_KEY}&action=archive_product" \
            -H "Content-Type: application/json" \
            -d "{\"items\":[{\"barcode\":\"${BARCODE}\"}]}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== CATEGORIES & BRANDS ====================

    categories)
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=categories")
        echo "$RESPONSE" | jq -r '
        def fmt_cats:
            map(
                "\(.id): \(.name)" +
                if .subCategories and (.subCategories | length) > 0 then
                    "\n" + (.subCategories | map("  \(.id): \(.name)") | join("\n"))
                else "" end
            ) | join("\n");
        if type == "array" then fmt_cats
        elif .categories then .categories | fmt_cats
        elif .content then .content | fmt_cats
        else . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    category-attributes)
        CAT_ID="$1"
        if [ -z "$CAT_ID" ]; then
            echo "Usage: trendyol.sh category-attributes <category_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=category_attributes&categoryId=${CAT_ID}")
        echo "$RESPONSE" | jq -r '
        def fmt_attrs:
            "Category Attributes:\n" +
            (map(
                "\n  \(.attribute.id): \(.attribute.name)" +
                " [" + (if .required then "REQUIRED" else "optional" end) + "]" +
                if .attributeValues and (.attributeValues | length) > 0 then
                    "\n    Values: " + (.attributeValues[:10] | map("\(.id)=\(.name)") | join(", ")) +
                    if (.attributeValues | length) > 10 then " ... +\((.attributeValues | length) - 10) more" else "" end
                else "" end
            ) | join("\n"));
        if .categoryAttributes then .categoryAttributes | fmt_attrs
        elif .content then .content | fmt_attrs
        else . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    brands)
        PARAMS="apiKey=${API_KEY}&action=brands"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --name) BRAND_NAME=$(echo -n "$2" | jq -sRr @uri); PARAMS="${PARAMS}&name=${BRAND_NAME}"; shift 2 ;;
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            map("\(.id): \(.name)") | join("\n")
        elif .brands then
            (.brands | map("\(.id): \(.name)") | join("\n"))
        elif .content then
            (.content | map("\(.id): \(.name)") | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== ORDERS ====================

    orders)
        PARAMS="apiKey=${API_KEY}&action=orders"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                --size) PARAMS="${PARAMS}&size=$2"; shift 2 ;;
                --startDate) PARAMS="${PARAMS}&startDate=$2"; shift 2 ;;
                --endDate) PARAMS="${PARAMS}&endDate=$2"; shift 2 ;;
                --orderNumber) PARAMS="${PARAMS}&orderNumber=$2"; shift 2 ;;
                --days)
                    # Convert --days N to startDate epoch ms
                    DAYS_AGO="$2"
                    START_EPOCH=$(( ($(date +%s) - DAYS_AGO * 86400) * 1000 ))
                    PARAMS="${PARAMS}&startDate=${START_EPOCH}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if .content then
            "Total: \(.totalElements // "?") orders (page \(.page // 0)+1 of \(.totalPages // "?"))\n" +
            (.content | to_entries | map(
                "\n━━━ Order #\(.value.orderNumber) ━━━\n" +
                "Status: \(.value.status // "N/A")\n" +
                "Date: \((.value.orderDate // 0) / 1000 | strftime("%Y-%m-%d %H:%M"))\n" +
                "Customer: \(.value.customerFirstName // "") \(.value.customerLastName // "")\n" +
                "Tracking: \(.value.cargoTrackingNumber // "Not assigned")\n" +
                "Cargo: \(.value.cargoProviderName // "N/A")\n" +
                "Items:\n" + (
                    .value.lines | map(
                        "  - \(.productName // "N/A") x\(.quantity // 1)" +
                        " (\(.amount // 0) TRY) [SKU: \(.stockCode // "N/A")]"
                    ) | join("\n")
                )
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    order)
        ORDER_NUM="$1"
        if [ -z "$ORDER_NUM" ]; then
            echo "Usage: trendyol.sh order <order_number>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=order&orderNumber=${ORDER_NUM}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== SHIPMENT ====================

    update-tracking)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "${API_URL}/trendyol?apiKey=${API_KEY}&action=update_tracking" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    shipping-label)
        TRACKING="$1"
        if [ -z "$TRACKING" ]; then
            echo "Usage: trendyol.sh shipping-label <tracking_number>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=shipping_label&trackingNumber=${TRACKING}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    cargo-companies)
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=cargo_companies")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            map("\(.id): \(.name) (\(.code // ""))") | join("\n")
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== INVOICE ====================

    send-invoice)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/trendyol?apiKey=${API_KEY}&action=send_invoice" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== RETURNS / CLAIMS ====================

    claims)
        PARAMS="apiKey=${API_KEY}&action=claims"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                --size) PARAMS="${PARAMS}&size=$2"; shift 2 ;;
                --days)
                    DAYS_AGO="$2"
                    START_EPOCH=$(( ($(date +%s) - DAYS_AGO * 86400) * 1000 ))
                    PARAMS="${PARAMS}&startDate=${START_EPOCH}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if (.content // .claims) then
            "Returns/Claims (\(.totalElements // "?") total):\n" +
            ((.content // .claims) | to_entries | map(
                "\n━━━ Claim #\(.value.claimId // .value.id // "N/A") ━━━\n" +
                "Order: \(.value.orderNumber // "N/A")\n" +
                "Date: \((.value.claimDate // 0) / 1000 | strftime("%Y-%m-%d"))\n" +
                "Customer: \(.value.customerFirstName // "") \(.value.customerLastName // "")\n" +
                "Items:\n" + (
                    (.value.items // []) | map(
                        "  - \(.orderLine.productName // "N/A") (\(.orderLine.price // 0) TRY)\n" +
                        "    Reason: \((.claimItems[0].customerClaimItemReason.name // "N/A"))\n" +
                        "    Status: \((.claimItems[0].claimItemStatus.name // "N/A"))\n" +
                        if (.claimItems[0].customerNote // "") != "" then
                            "    Note: \(.claimItems[0].customerNote)"
                        else "" end
                    ) | join("\n")
                )
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    approve-claim)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "${API_URL}/trendyol?apiKey=${API_KEY}&action=approve_claim" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== CUSTOMER Q&A ====================

    questions)
        PARAMS="apiKey=${API_KEY}&action=questions"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --status) PARAMS="${PARAMS}&status=$2"; shift 2 ;;
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                --size) PARAMS="${PARAMS}&size=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if (.content // .questions) then
            "Customer Questions (\(.totalElements // "?") total):\n" +
            ((.content // .questions) | to_entries | map(
                "\n━━━ Q#\(.value.id // "N/A") ━━━\n" +
                "Product: \(.value.productName // "N/A")\n" +
                "Question: \(.value.text // "N/A")\n" +
                "Status: \(.value.status // "N/A")\n" +
                "Date: \(.value.creationDate // "N/A")\n" +
                if .value.answer then
                    "Answer: \(.value.answer.text // "N/A")"
                else
                    "Answer: [WAITING]"
                end
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    answer-question)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/trendyol?apiKey=${API_KEY}&action=answer_question" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== FINANCE ====================

    settlements)
        PARAMS="apiKey=${API_KEY}&action=settlements"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --startDate) PARAMS="${PARAMS}&startDate=$2"; shift 2 ;;
                --endDate) PARAMS="${PARAMS}&endDate=$2"; shift 2 ;;
                --page) PARAMS="${PARAMS}&page=$2"; shift 2 ;;
                --days)
                    DAYS_AGO="$2"
                    START_EPOCH=$(( ($(date +%s) - DAYS_AGO * 86400) * 1000 ))
                    PARAMS="${PARAMS}&startDate=${START_EPOCH}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/trendyol?${PARAMS}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== SELLER INFO ====================

    addresses)
        RESPONSE=$(curl -s "${API_URL}/trendyol?apiKey=${API_KEY}&action=addresses")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ==================== HELP ====================

    help|*)
        echo "Trendyol API Helper for Clawd (via KolayXport)"
        echo ""
        echo "Usage: trendyol.sh [command] [options]"
        echo ""
        echo "PRODUCTS:"
        echo "  products                        - List products"
        echo "  products --approved true         - Filter approved only"
        echo "  products --onSale true            - Filter on-sale only"
        echo "  products --barcode BARCODE        - Find by barcode"
        echo "  products --sku STOCKCODE          - Find by SKU"
        echo "  products --size 20 --page 0       - Pagination"
        echo "  product BARCODE                   - Get specific product"
        echo "  create-product                    - Create product (JSON from stdin)"
        echo "  update-product                    - Update product (JSON from stdin)"
        echo "  update-stock-price                - Bulk stock & price update (JSON from stdin)"
        echo "  batch-status BATCH_ID             - Check batch request status"
        echo "  archive BARCODE                   - Archive a product"
        echo ""
        echo "CATEGORIES & BRANDS:"
        echo "  categories                        - List all categories"
        echo "  category-attributes CAT_ID        - Get category attributes"
        echo "  brands --name SEARCH              - Search brands"
        echo ""
        echo "ORDERS:"
        echo "  orders                            - List orders"
        echo "  orders --status Created            - Filter by status"
        echo "  orders --days 7                    - Orders from last N days"
        echo "  orders --size 20 --page 0          - Pagination"
        echo "  order ORDER_NUMBER                 - Get specific order"
        echo ""
        echo "SHIPMENT:"
        echo "  update-tracking                   - Update tracking (JSON from stdin)"
        echo "  shipping-label TRACKING_NUM        - Get shipping label"
        echo "  cargo-companies                   - List cargo companies"
        echo ""
        echo "INVOICE:"
        echo "  send-invoice                      - Send invoice link (JSON from stdin)"
        echo ""
        echo "RETURNS:"
        echo "  claims                            - List returns/claims"
        echo "  claims --status WAITING            - Filter by status"
        echo "  claims --days 7                    - Claims from last N days"
        echo "  approve-claim                     - Approve return (JSON from stdin)"
        echo ""
        echo "CUSTOMER Q&A:"
        echo "  questions                         - List customer questions"
        echo "  questions --status WAITING_FOR_ANSWER"
        echo "  answer-question                   - Answer question (JSON from stdin)"
        echo ""
        echo "FINANCE:"
        echo "  settlements                       - Account statements"
        echo "  settlements --days 30              - Last 30 days"
        echo ""
        echo "SELLER:"
        echo "  addresses                         - Seller addresses"
        echo ""
        echo "ORDER STATUSES: Created, Picking, Invoiced, Shipped, Delivered,"
        echo "                Cancelled, UnDelivered, Returned, Repack, UnSupplied"
        ;;
esac
