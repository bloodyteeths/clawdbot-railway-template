#!/bin/bash
# eBay API helper for Clawd (via KolayXport)
# Usage: ./ebay.sh [command] [options]
#
# Three endpoints:
#   /ebay          - Core (listings, orders, taxonomy, policies, market research, analytics)
#   /ebay-research - Product tracking, seller tracking, niche analysis
#   /ebay-ai       - AI-powered optimization

set -e

API_URL="${KOLAYXPORT_API_URL:-https://kolayxport.com/api/clawd}"
API_KEY="${KOLAYXPORT_API_KEY}"
USER_ID="${EBAY_USER_ID}"

if [ -z "$API_KEY" ]; then
    echo "Error: KOLAYXPORT_API_KEY environment variable not set"
    exit 1
fi

if [ -z "$USER_ID" ]; then
    echo "Error: EBAY_USER_ID environment variable not set"
    exit 1
fi

CMD="${1:-help}"
shift 2>/dev/null || true

# Helper: build core endpoint URL
ebay_url() {
    echo "${API_URL}/ebay?apiKey=${API_KEY}&userId=${USER_ID}&action=$1"
}

# Helper: build research endpoint URL
research_url() {
    echo "${API_URL}/ebay-research?apiKey=${API_KEY}&userId=${USER_ID}&action=$1"
}

# Helper: build AI endpoint URL
ai_url() {
    echo "${API_URL}/ebay-ai?apiKey=${API_KEY}&action=$1"
}

case "$CMD" in

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # LISTINGS
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    listings)
        URL=$(ebay_url "listings")
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                --offset) URL="${URL}&offset=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq -r '
        if type == "object" and .listings then
            "Total listings: \(.total // (.listings | length))\n" +
            (.listings | to_entries | map(
                "\n━━━ \(.value.sku // .value.listingId // "N/A") ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Price: $\(.value.price // "N/A")\n" +
                "Quantity: \(.value.quantity // 0)\n" +
                "Status: \(.value.status // "N/A")"
            ) | join("\n"))
        elif type == "array" then
            if length == 0 then "No listings found."
            else
                "Found \(length) listing(s):\n" +
                (to_entries | map(
                    "\n━━━ \(.value.sku // .value.listingId // "N/A") ━━━\n" +
                    "Title: \(.value.title // "N/A")\n" +
                    "Price: $\(.value.price // "N/A")\n" +
                    "Quantity: \(.value.quantity // 0)\n" +
                    "Status: \(.value.status // "N/A")"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    listing)
        SKU="$1"
        if [ -z "$SKU" ]; then
            echo "Usage: ebay.sh listing <sku>"
            exit 1
        fi
        SKU_ENC=$(echo -n "$SKU" | jq -sRr @uri)
        RESPONSE=$(curl -s "$(ebay_url "listing")&sku=${SKU_ENC}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    create)
        SKU="$1"
        if [ -z "$SKU" ]; then
            echo "Usage: echo '{...}' | ebay.sh create <sku>"
            exit 1
        fi
        SKU_ENC=$(echo -n "$SKU" | jq -sRr @uri)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ebay_url "create_listing")&sku=${SKU_ENC}" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Listing created!\n" +
            "SKU: \(.sku // "N/A")\n" +
            "Title: \(.title // "N/A")\n" +
            "Status: \(.status // "draft")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    update)
        SKU="$1"
        if [ -z "$SKU" ]; then
            echo "Usage: echo '{...}' | ebay.sh update <sku>"
            exit 1
        fi
        SKU_ENC=$(echo -n "$SKU" | jq -sRr @uri)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "$(ebay_url "update_listing")&sku=${SKU_ENC}" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Listing updated!\n" +
            "SKU: \(.sku // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    update-offer)
        OFFER_ID="$1"
        if [ -z "$OFFER_ID" ]; then
            echo "Usage: echo '{...}' | ebay.sh update-offer <offer_id>"
            exit 1
        fi
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PUT "$(ebay_url "update_offer")&offerId=${OFFER_ID}" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Offer updated!\n" +
            "Offer ID: \(.offerId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    delete)
        SKU="$1"
        if [ -z "$SKU" ]; then
            echo "Usage: ebay.sh delete <sku>"
            exit 1
        fi
        SKU_ENC=$(echo -n "$SKU" | jq -sRr @uri)
        RESPONSE=$(curl -s -X DELETE "$(ebay_url "delete_listing")&sku=${SKU_ENC}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Listing deleted: \(.sku // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    publish)
        OFFER_ID="$1"
        if [ -z "$OFFER_ID" ]; then
            echo "Usage: ebay.sh publish <offer_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X POST "$(ebay_url "publish")&offerId=${OFFER_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Offer published!\n" +
            "Offer ID: \(.offerId // "N/A")\n" +
            "Listing ID: \(.listingId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    withdraw)
        OFFER_ID="$1"
        if [ -z "$OFFER_ID" ]; then
            echo "Usage: ebay.sh withdraw <offer_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X POST "$(ebay_url "withdraw")&offerId=${OFFER_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Offer withdrawn!\n" +
            "Offer ID: \(.offerId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    bulk-price)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ebay_url "bulk_update_price")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Bulk price update complete!\n" +
            "Updated: \(.updated // 0) listing(s)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    inventory)
        URL=$(ebay_url "inventory_items")
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # ORDERS
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    orders)
        URL=$(ebay_url "orders")
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                --filter)
                    FILTER=$(echo -n "$2" | jq -sRr @uri)
                    URL="${URL}&filter=${FILTER}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq -r '
        if type == "object" and .orders then
            "Total orders: \(.total // (.orders | length))\n" +
            (.orders | to_entries | map(
                "\n━━━ Order #\(.value.orderId // "N/A") ━━━\n" +
                "Buyer: \(.value.buyer.username // .value.buyer // "N/A")\n" +
                "Date: \(.value.creationDate // "N/A")\n" +
                "Total: $\(.value.pricingSummary.total.value // .value.total // "N/A")\n" +
                "Status: \(.value.orderFulfillmentStatus // .value.status // "N/A")\n" +
                "Items: \(.value.lineItems | length // 0)"
            ) | join("\n"))
        elif type == "array" then
            if length == 0 then "No orders found."
            else
                "Found \(length) order(s):\n" +
                (to_entries | map(
                    "\n━━━ Order #\(.value.orderId // "N/A") ━━━\n" +
                    "Buyer: \(.value.buyer.username // .value.buyer // "N/A")\n" +
                    "Date: \(.value.creationDate // "N/A")\n" +
                    "Total: $\(.value.pricingSummary.total.value // .value.total // "N/A")\n" +
                    "Status: \(.value.orderFulfillmentStatus // .value.status // "N/A")"
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
            echo "Usage: ebay.sh order <order_id>"
            exit 1
        fi
        ORDER_ENC=$(echo -n "$ORDER_ID" | jq -sRr @uri)
        RESPONSE=$(curl -s "$(ebay_url "order")&orderId=${ORDER_ENC}")
        echo "$RESPONSE" | jq -r '
        "━━━ Order #\(.orderId // "N/A") ━━━\n" +
        "Buyer: \(.buyer.username // "N/A")\n" +
        "Date: \(.creationDate // "N/A")\n" +
        "Status: \(.orderFulfillmentStatus // "N/A")\n" +
        "Payment: \(.orderPaymentStatus // "N/A")\n" +
        "Total: $\(.pricingSummary.total.value // "N/A")\n" +
        "\nItems:\n" +
        (.lineItems | map(
            "  - \(.title // "N/A") x\(.quantity // 1) - $\(.lineItemCost.value // "N/A")"
        ) | join("\n"))
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # POLICIES
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    fulfillment-policies)
        RESPONSE=$(curl -s "$(ebay_url "fulfillment_policies")")
        echo "$RESPONSE" | jq -r '
        if .fulfillmentPolicies then
            "Fulfillment Policies (\(.total // (.fulfillmentPolicies | length))):\n" +
            (.fulfillmentPolicies | map(
                "\n━━━ \(.fulfillmentPolicyId) ━━━\n" +
                "Name: \(.name // "N/A")\n" +
                "Type: \(.marketplaceId // "N/A")\n" +
                "Handling: \(.handlingTime.value // "?") \(.handlingTime.unit // "days")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    return-policies)
        RESPONSE=$(curl -s "$(ebay_url "return_policies")")
        echo "$RESPONSE" | jq -r '
        if .returnPolicies then
            "Return Policies (\(.total // (.returnPolicies | length))):\n" +
            (.returnPolicies | map(
                "\n━━━ \(.returnPolicyId) ━━━\n" +
                "Name: \(.name // "N/A")\n" +
                "Returns Accepted: \(.returnsAccepted // false)\n" +
                "Period: \(.returnPeriod.value // "?") \(.returnPeriod.unit // "days")\n" +
                "Refund: \(.refundMethod // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    payment-policies)
        RESPONSE=$(curl -s "$(ebay_url "payment_policies")")
        echo "$RESPONSE" | jq -r '
        if .paymentPolicies then
            "Payment Policies (\(.total // (.paymentPolicies | length))):\n" +
            (.paymentPolicies | map(
                "\n━━━ \(.paymentPolicyId) ━━━\n" +
                "Name: \(.name // "N/A")\n" +
                "Marketplace: \(.marketplaceId // "N/A")\n" +
                "Immediate Pay: \(.immediatePay // false)"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # TAXONOMY
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    categories)
        RESPONSE=$(curl -s "$(ebay_url "top_categories")")
        echo "$RESPONSE" | jq -r '
        if .categories then
            "Top Categories:\n" +
            (.categories | map(
                "  \(.categoryId): \(.categoryName // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    category-suggestions)
        QUERY="$1"
        if [ -z "$QUERY" ]; then
            echo "Usage: ebay.sh category-suggestions <query>"
            exit 1
        fi
        QUERY_ENC=$(echo -n "$QUERY" | jq -sRr @uri)
        RESPONSE=$(curl -s "$(ebay_url "category_suggestions")&q=${QUERY_ENC}")
        echo "$RESPONSE" | jq -r '
        if .categorySuggestions then
            "Category suggestions for query:\n" +
            (.categorySuggestions | map(
                "\n━━━ \(.category.categoryId) ━━━\n" +
                "Name: \(.category.categoryName // "N/A")\n" +
                "Path: \(.categoryTreeNodeAncestors | map(.categoryName) | join(" > "))"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    aspects)
        CATEGORY_ID="$1"
        if [ -z "$CATEGORY_ID" ]; then
            echo "Usage: ebay.sh aspects <category_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "$(ebay_url "item_aspects")&categoryId=${CATEGORY_ID}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # MARKET RESEARCH
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    search)
        QUERY="$1"
        if [ -z "$QUERY" ]; then
            echo "Usage: ebay.sh search <query> [--limit N] [--sort SORT]"
            exit 1
        fi
        shift
        QUERY_ENC=$(echo -n "$QUERY" | jq -sRr @uri)
        URL="$(ebay_url "search_market")&q=${QUERY_ENC}"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                --sort)
                    SORT_ENC=$(echo -n "$2" | jq -sRr @uri)
                    URL="${URL}&sort=${SORT_ENC}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq -r '
        if .itemSummaries then
            "Results: \(.total // (.itemSummaries | length))\n" +
            (.itemSummaries | to_entries | map(
                "\n━━━ #\(.key + 1) ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Price: $\(.value.price.value // "N/A") \(.value.price.currency // "")\n" +
                "Seller: \(.value.seller.username // "N/A") (\(.value.seller.feedbackPercentage // "?")%)\n" +
                "Item ID: \(.value.itemId // .value.legacyItemId // "N/A")\n" +
                "Condition: \(.value.condition // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    search-seller)
        SELLER="$1"
        if [ -z "$SELLER" ]; then
            echo "Usage: ebay.sh search-seller <seller_username> [--limit N]"
            exit 1
        fi
        shift
        SELLER_ENC=$(echo -n "$SELLER" | jq -sRr @uri)
        URL="$(ebay_url "search_seller")&seller=${SELLER_ENC}"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq -r '
        if .itemSummaries then
            "Seller listings: \(.total // (.itemSummaries | length))\n" +
            (.itemSummaries | to_entries | map(
                "\n━━━ #\(.key + 1) ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Price: $\(.value.price.value // "N/A")\n" +
                "Item ID: \(.value.itemId // .value.legacyItemId // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    bestsellers)
        CATEGORY_ID="$1"
        if [ -z "$CATEGORY_ID" ]; then
            echo "Usage: ebay.sh bestsellers <category_id> [--limit N]"
            exit 1
        fi
        shift
        URL="$(ebay_url "category_bestsellers")&categoryId=${CATEGORY_ID}"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq -r '
        if type == "array" or (type == "object" and .items) then
            (if type == "object" then .items else . end) |
            to_entries | map(
                "\n━━━ #\(.key + 1) ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Price: $\(.value.price.value // .value.price // "N/A")\n" +
                "Sold: \(.value.soldQuantity // .value.sold // "N/A")"
            ) | join("\n")
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    analyze-seo)
        QUERY="$1"
        if [ -z "$QUERY" ]; then
            echo "Usage: ebay.sh analyze-seo <query> [--my-title TITLE]"
            exit 1
        fi
        shift
        QUERY_ENC=$(echo -n "$QUERY" | jq -sRr @uri)
        URL="$(ebay_url "analyze_seo")&q=${QUERY_ENC}"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --my-title)
                    TITLE_ENC=$(echo -n "$2" | jq -sRr @uri)
                    URL="${URL}&myTitle=${TITLE_ENC}"
                    shift 2
                    ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    item-details)
        LEGACY_ITEM_ID="$1"
        if [ -z "$LEGACY_ITEM_ID" ]; then
            echo "Usage: ebay.sh item-details <legacy_item_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "$(ebay_url "get_item_details")&legacyItemId=${LEGACY_ITEM_ID}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    analytics)
        URL=$(ebay_url "analytics")
        while [[ $# -gt 0 ]]; do
            case $1 in
                --days) URL="${URL}&days=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    my-listings)
        RESPONSE=$(curl -s "$(ebay_url "my_legacy_listings")")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then "No legacy listings found."
            else
                "Found \(length) listing(s):\n" +
                (to_entries | map(
                    "\n━━━ #\(.key + 1) ━━━\n" +
                    "Title: \(.value.title // "N/A")\n" +
                    "Item ID: \(.value.itemId // .value.legacyItemId // "N/A")\n" +
                    "Price: $\(.value.price // "N/A")"
                ) | join("\n"))
            end
        elif type == "object" and .items then
            "Found \(.items | length) listing(s):\n" +
            (.items | to_entries | map(
                "\n━━━ #\(.key + 1) ━━━\n" +
                "Title: \(.value.title // "N/A")\n" +
                "Item ID: \(.value.itemId // .value.legacyItemId // "N/A")\n" +
                "Price: $\(.value.price // "N/A")"
            ) | join("\n"))
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # RESEARCH (ebay-research endpoint)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    tracked-products)
        RESPONSE=$(curl -s "$(research_url "tracked_products")")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then "No tracked products."
            else
                "Tracked Products (\(length)):\n" +
                (to_entries | map(
                    "\n━━━ \(.value.id // .value.productId // "N/A") ━━━\n" +
                    "Title: \(.value.title // "N/A")\n" +
                    "Price: $\(.value.currentPrice // .value.price // "N/A")\n" +
                    "Notes: \(.value.notes // "—")"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    track-product)
        LEGACY_ITEM_ID="$1"
        if [ -z "$LEGACY_ITEM_ID" ]; then
            echo "Usage: ebay.sh track-product <legacy_item_id> [--notes NOTES]"
            exit 1
        fi
        shift
        NOTES=""
        while [[ $# -gt 0 ]]; do
            case $1 in
                --notes) NOTES="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s -X POST "$(research_url "track_product")&legacyItemId=${LEGACY_ITEM_ID}" \
            -H "Content-Type: application/json" \
            -d "{\"notes\":\"${NOTES}\"}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Product tracked!\n" +
            "Item ID: \(.legacyItemId // "N/A")\n" +
            "Title: \(.title // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    untrack-product)
        PRODUCT_ID="$1"
        if [ -z "$PRODUCT_ID" ]; then
            echo "Usage: ebay.sh untrack-product <product_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X DELETE "$(research_url "untrack_product")&productId=${PRODUCT_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Product untracked: \(.productId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    price-history)
        PRODUCT_ID="$1"
        if [ -z "$PRODUCT_ID" ]; then
            echo "Usage: ebay.sh price-history <product_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "$(research_url "price_history")&productId=${PRODUCT_ID}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then "No price history."
            else
                "Price History (\(length) entries):\n" +
                (map("  \(.date // .timestamp // "?"): $\(.price // "N/A")") | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    refresh-tracked)
        RESPONSE=$(curl -s -X POST "$(research_url "refresh_tracked")")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Tracked products refreshed!\n" +
            "Updated: \(.updated // 0) product(s)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    tracked-sellers)
        RESPONSE=$(curl -s "$(research_url "tracked_sellers")")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then "No tracked sellers."
            else
                "Tracked Sellers (\(length)):\n" +
                (to_entries | map(
                    "\n━━━ \(.value.id // .value.sellerId // "N/A") ━━━\n" +
                    "Username: \(.value.username // "N/A")\n" +
                    "Listings: \(.value.listingCount // "?")\n" +
                    "Notes: \(.value.notes // "—")"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    track-seller)
        USERNAME="$1"
        if [ -z "$USERNAME" ]; then
            echo "Usage: ebay.sh track-seller <username> [--notes NOTES]"
            exit 1
        fi
        shift
        USERNAME_ENC=$(echo -n "$USERNAME" | jq -sRr @uri)
        NOTES=""
        while [[ $# -gt 0 ]]; do
            case $1 in
                --notes) NOTES="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s -X POST "$(research_url "track_seller")&username=${USERNAME_ENC}" \
            -H "Content-Type: application/json" \
            -d "{\"notes\":\"${NOTES}\"}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Seller tracked!\n" +
            "Username: \(.username // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    untrack-seller)
        SELLER_ID="$1"
        if [ -z "$SELLER_ID" ]; then
            echo "Usage: ebay.sh untrack-seller <seller_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X DELETE "$(research_url "untrack_seller")&sellerId=${SELLER_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Seller untracked: \(.sellerId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    saved-niches)
        RESPONSE=$(curl -s "$(research_url "saved_niches")")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then "No saved niches."
            else
                "Saved Niches (\(length)):\n" +
                (to_entries | map(
                    "\n━━━ \(.value.id // .value.nicheId // "N/A") ━━━\n" +
                    "Name: \(.value.name // .value.query // "N/A")\n" +
                    "Avg Price: $\(.value.avgPrice // "?")\n" +
                    "Competition: \(.value.competition // "?")"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    save-niche)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(research_url "save_niche")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Niche saved!\n" +
            "ID: \(.id // .nicheId // "N/A")\n" +
            "Name: \(.name // .query // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    delete-niche)
        NICHE_ID="$1"
        if [ -z "$NICHE_ID" ]; then
            echo "Usage: ebay.sh delete-niche <niche_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X DELETE "$(research_url "delete_niche")&nicheId=${NICHE_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Niche deleted: \(.nicheId // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    product-db)
        QUERY="$1"
        if [ -z "$QUERY" ]; then
            echo "Usage: ebay.sh product-db <query> [--min-price N] [--max-price N] [--limit N]"
            exit 1
        fi
        shift
        QUERY_ENC=$(echo -n "$QUERY" | jq -sRr @uri)
        URL="$(research_url "product_database")&q=${QUERY_ENC}"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --min-price) URL="${URL}&minPrice=$2"; shift 2 ;;
                --max-price) URL="${URL}&maxPrice=$2"; shift 2 ;;
                --limit) URL="${URL}&limit=$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        RESPONSE=$(curl -s "$URL")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    niche-analyze)
        QUERY="$1"
        if [ -z "$QUERY" ]; then
            echo "Usage: ebay.sh niche-analyze <query>"
            exit 1
        fi
        QUERY_ENC=$(echo -n "$QUERY" | jq -sRr @uri)
        RESPONSE=$(curl -s "$(research_url "niche_analyze")&q=${QUERY_ENC}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # AI (ebay-ai endpoint)
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    ai-title)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ai_url "optimize_title")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .optimizedTitle then
            "━━━ Title Optimization ━━━\n" +
            "Original: \(.originalTitle // "N/A")\n" +
            "Optimized: \(.optimizedTitle)\n" +
            "Score: \(.score // "N/A")\n" +
            (if .suggestions then
                "\nSuggestions:\n" + (.suggestions | map("  - \(.)") | join("\n"))
            else "" end)
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    ai-description)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ai_url "generate_description")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .description then
            "━━━ Generated Description ━━━\n\n\(.description)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    ai-analyze)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ai_url "analyze_listing")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    ai-price)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ai_url "suggest_price")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .suggestedPrice then
            "━━━ Price Suggestion ━━━\n" +
            "Suggested: $\(.suggestedPrice)\n" +
            "Range: $\(.minPrice // "?") - $\(.maxPrice // "?")\n" +
            "Confidence: \(.confidence // "N/A")\n" +
            (if .reasoning then "\nReasoning: \(.reasoning)" else "" end)
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    ai-bulk-titles)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "$(ai_url "bulk_optimize_titles")" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # HELP
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    help|*)
        echo "eBay API Helper for Clawd (via KolayXport)"
        echo ""
        echo "Usage: ebay.sh [command] [options]"
        echo ""
        echo "LISTINGS:"
        echo "  listings [--limit N] [--offset N]  - List all listings"
        echo "  listing SKU                        - Get single listing by SKU"
        echo "  create SKU                         - Create listing (JSON from stdin)"
        echo "  update SKU                         - Update listing (JSON from stdin)"
        echo "  update-offer OFFER_ID              - Update offer (JSON from stdin)"
        echo "  delete SKU                         - Delete listing"
        echo "  publish OFFER_ID                   - Publish offer"
        echo "  withdraw OFFER_ID                  - Withdraw/end listing"
        echo "  bulk-price                         - Bulk update prices (JSON from stdin)"
        echo "  inventory [--limit N]              - Raw inventory items"
        echo ""
        echo "ORDERS:"
        echo "  orders [--limit N] [--filter F]    - List orders"
        echo "  order ORDER_ID                     - Get single order"
        echo ""
        echo "POLICIES:"
        echo "  fulfillment-policies               - List fulfillment/shipping policies"
        echo "  return-policies                    - List return policies"
        echo "  payment-policies                   - List payment policies"
        echo ""
        echo "TAXONOMY:"
        echo "  categories                         - Top categories"
        echo "  category-suggestions QUERY         - Suggest categories"
        echo "  aspects CATEGORY_ID                - Item aspects for category"
        echo ""
        echo "MARKET RESEARCH:"
        echo "  search QUERY [--limit N] [--sort S]  - Search market"
        echo "  search-seller SELLER [--limit N]     - Search seller's listings"
        echo "  bestsellers CAT_ID [--limit N]       - Category bestsellers"
        echo "  analyze-seo QUERY [--my-title T]     - SEO analysis"
        echo "  item-details LEGACY_ITEM_ID          - Get item details"
        echo "  analytics [--days N]                 - Store analytics"
        echo "  my-listings                          - My legacy listings"
        echo ""
        echo "RESEARCH (product/seller tracking):"
        echo "  tracked-products                   - List tracked products"
        echo "  track-product ID [--notes N]       - Track a product"
        echo "  untrack-product PRODUCT_ID         - Untrack product"
        echo "  price-history PRODUCT_ID           - Price history"
        echo "  refresh-tracked                    - Refresh all tracked products"
        echo "  tracked-sellers                    - List tracked sellers"
        echo "  track-seller USERNAME [--notes N]  - Track seller"
        echo "  untrack-seller SELLER_ID           - Untrack seller"
        echo "  saved-niches                       - List saved niches"
        echo "  save-niche                         - Save niche (JSON from stdin)"
        echo "  delete-niche NICHE_ID              - Delete niche"
        echo "  product-db QUERY [--min-price N] [--max-price N] [--limit N]"
        echo "                                     - Product database search"
        echo "  niche-analyze QUERY                - Niche analysis"
        echo ""
        echo "AI OPTIMIZATION:"
        echo "  ai-title                           - Optimize title (JSON from stdin)"
        echo "  ai-description                     - Generate description (JSON from stdin)"
        echo "  ai-analyze                         - Analyze listing (JSON from stdin)"
        echo "  ai-price                           - Suggest price (JSON from stdin)"
        echo "  ai-bulk-titles                     - Bulk optimize titles (JSON from stdin)"
        echo ""
        echo "ENV VARS:"
        echo "  KOLAYXPORT_API_KEY   - API key (required)"
        echo "  KOLAYXPORT_API_URL   - API base URL (default: https://kolayxport.com/api/clawd)"
        echo "  EBAY_USER_ID         - eBay user ID (required)"
        echo ""
        echo "EXAMPLES:"
        echo "  ebay.sh listings --limit 10"
        echo "  ebay.sh search 'gift box' --limit 5 --sort price"
        echo "  ebay.sh track-product 123456789 --notes 'competitor product'"
        echo "  echo '{\"title\":\"...\",\"keywords\":[\"...\"]}' | ebay.sh ai-title"
        echo "  echo '{\"price\":29.99}' | ebay.sh update SKU123"
        ;;
esac
