#!/bin/bash
# Etsy API helper for Clawd (via KolayXport)
# Usage: ./etsy.sh [command] [options]
#
# Commands:
#   orders                    - List recent orders
#   orders --customer NAME    - Search by customer name
#   order RECEIPT_ID          - Get specific order
#   listings                  - List active listings
#   listing LISTING_ID        - Get specific listing
#   update LISTING_ID         - Update listing (reads JSON from stdin)
#   create-draft              - Create draft listing (reads JSON from stdin)
#   delete LISTING_ID         - Delete a listing
#   shipping-profiles         - List shipping profiles
#   return-policies           - List return policies
#   shop-sections             - List shop sections
#   readiness-states          - List processing profiles (readiness states)
#   get-personalization ID    - Get personalization questions for a listing
#   set-personalization ID    - Set personalization questions (reads JSON from stdin)
#   simple-personalization ID - Set simple personalization (reads JSON from stdin)
#   remove-personalization ID - Remove all personalization from a listing

set -e

API_URL="${KOLAYXPORT_API_URL:-https://kolayxport.com/api/clawd}"
API_KEY="${KOLAYXPORT_API_KEY}"

if [ -z "$API_KEY" ]; then
    echo "Error: KOLAYXPORT_API_KEY environment variable not set"
    exit 1
fi

CMD="${1:-orders}"
shift 2>/dev/null || true

case "$CMD" in
    orders)
        PARAMS="apiKey=${API_KEY}&action=receipts"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --customer)
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
        RESPONSE=$(curl -s "${API_URL}/etsy?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        if type == "array" then
            if length == 0 then
                "No orders found."
            else
                "Found \(length) order(s):\n" +
                (to_entries | map(
                    "\n━━━ Order #\(.value.receipt_id) ━━━\n" +
                    "Customer: \(.value.customer.name // "N/A")\n" +
                    "Date: \(.value.order_date | todate)\n" +
                    "Total: $\((.value.total_price.amount // 0) / (.value.total_price.divisor // 100))\n" +
                    "Items: \(.value.items | length // 0)"
                ) | join("\n"))
            end
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    order)
        RECEIPT_ID="$1"
        if [ -z "$RECEIPT_ID" ]; then
            echo "Usage: etsy.sh order <receipt_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=receipt&receipt_id=${RECEIPT_ID}")
        echo "$RESPONSE" | jq -r '
        "━━━ Order #\(.receipt_id) ━━━\n" +
        "Customer: \(.customer.name // "N/A")\n" +
        "\n Items:\n" +
        (.items | map("  - \(.title) x\(.quantity) - $\(.price / 100)") | join("\n")) +
        "\n\n Tracking: \(.tracking.tracking_code // "Not set")" +
        "\n   Carrier: \(.tracking.carrier_name // "N/A")"
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    listings)
        PARAMS="apiKey=${API_KEY}&action=listings"
        while [[ $# -gt 0 ]]; do
            case $1 in
                --limit)
                    PARAMS="${PARAMS}&limit=$2"
                    shift 2
                    ;;
                *)
                    shift
                    ;;
            esac
        done
        RESPONSE=$(curl -s "${API_URL}/etsy?${PARAMS}")
        echo "$RESPONSE" | jq -r '
        "Total listings: \(.count)\n" +
        (.listings | to_entries | map(
            "\n━━━ \(.value.listing_id) ━━━\n" +
            "Title: \(.value.title)\n" +
            "Price: $\((.value.price.amount // 0) / (.value.price.divisor // 100))\n" +
            "Views: \(.value.views // 0) | Favorites: \(.value.num_favorers // 0)\n" +
            "Tags: \(.value.tags | join(", "))"
        ) | join("\n"))
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    listing)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh listing <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=listing&listing_id=${LISTING_ID}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    update)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: echo '{\"title\":\"...\"}' | etsy.sh update <listing_id>"
            exit 1
        fi
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X PATCH "${API_URL}/etsy?apiKey=${API_KEY}&action=update_listing&listing_id=${LISTING_ID}" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    create-draft)
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=create_listing" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Draft created successfully!\n" +
            "Listing ID: \(.listing_id)\n" +
            "Title: \(.title)\n" +
            "State: \(.state)\n" +
            "URL: \(.url)\n" +
            "\nNext: Add images, then publish"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    delete)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh delete <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X DELETE "${API_URL}/etsy?apiKey=${API_KEY}&action=delete_listing&listing_id=${LISTING_ID}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    copy)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh copy <listing_id> [title_prefix]"
            echo "Example: etsy.sh copy 4448583799"
            echo "Example: etsy.sh copy 4448583799 'NEW - '"
            exit 1
        fi
        PREFIX="${2:-COPY - }"
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=copy_listing" \
            -H "Content-Type: application/json" \
            -d "{\"source_listing_id\":${LISTING_ID},\"title_prefix\":\"${PREFIX}\"}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Listing copied successfully!\n" +
            "\nSource: \(.source_listing_id)" +
            "\nNew ID: \(.new_listing_id)" +
            "\nTitle: \(.title)" +
            "\nState: \(.state)" +
            "\nURL: \(.url)" +
            "\n\nSource images (\(.source_images | length)):" +
            (.source_images | map("\n  - Rank \(.rank): \(.url_fullxfull)") | join("")) +
            "\n\nNext steps:" +
            "\n  1. etsy.sh upload-image \(.new_listing_id) <image_url>" +
            "\n  2. etsy.sh update \(.new_listing_id) with new title/price" +
            "\n  3. etsy.sh publish \(.new_listing_id)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    upload-image)
        LISTING_ID="$1"
        IMAGE_URL="$2"
        RANK="${3:-1}"
        ALT_TEXT="$4"
        if [ -z "$LISTING_ID" ] || [ -z "$IMAGE_URL" ]; then
            echo "Usage: etsy.sh upload-image <listing_id> <image_url> [rank] [alt_text]"
            echo ""
            echo "Arguments:"
            echo "  listing_id  - The listing to add image to"
            echo "  image_url   - URL of image to upload"
            echo "  rank        - Position in gallery (1=main image, default: 1)"
            echo "  alt_text    - SEO alt text describing the image"
            echo ""
            echo "Examples:"
            echo "  etsy.sh upload-image 4450075346 'https://...jpg' 1 'Pink gift box with ribbon'"
            echo "  etsy.sh upload-image 4450075346 'https://...jpg' 2 'Inside view of pamper box'"
            exit 1
        fi
        # Build JSON with optional alt_text
        if [ -n "$ALT_TEXT" ]; then
            JSON_DATA="{\"image_url\":\"${IMAGE_URL}\",\"rank\":${RANK},\"alt_text\":\"${ALT_TEXT}\"}"
        else
            JSON_DATA="{\"image_url\":\"${IMAGE_URL}\",\"rank\":${RANK}}"
        fi
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=upload_image&listing_id=${LISTING_ID}" \
            -H "Content-Type: application/json" \
            -d "$JSON_DATA")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Image uploaded successfully!\n" +
            "Listing: \(.listing_id)\n" +
            "Image ID: \(.listing_image_id)\n" +
            "Rank: \(.rank)\n" +
            "Alt Text: \(.alt_text // "Not set")\n" +
            "URL: \(.url_fullxfull)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    publish)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh publish <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=publish&listing_id=${LISTING_ID}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Listing published!\n" +
            "ID: \(.listing_id)\n" +
            "State: \(.state)\n" +
            "URL: \(.url)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    upload-video)
        LISTING_ID="$1"
        VIDEO_URL="$2"
        VIDEO_NAME="$3"
        if [ -z "$LISTING_ID" ] || [ -z "$VIDEO_URL" ]; then
            echo "Usage: etsy.sh upload-video <listing_id> <video_url> [video_name]"
            echo ""
            echo "Arguments:"
            echo "  listing_id  - The listing to add video to"
            echo "  video_url   - URL of video file to upload"
            echo "  video_name  - Name for the video (required by Etsy API)"
            echo ""
            echo "Video Requirements:"
            echo "  - Duration: 5-60 seconds"
            echo "  - Max size: 100MB"
            echo "  - Formats: MP4, MOV, MPEG, FLV, AVI"
            echo "  - Audio: Automatically stripped by Etsy"
            echo ""
            echo "Example:"
            echo "  etsy.sh upload-video 4450075346 'https://example.com/demo.mp4' 'Product Demo'"
            exit 1
        fi
        # Extract filename from URL if name not provided
        if [ -z "$VIDEO_NAME" ]; then
            VIDEO_NAME=$(basename "$VIDEO_URL" | sed 's/\.[^.]*$//')
        fi
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=upload_video&listing_id=${LISTING_ID}" \
            -H "Content-Type: application/json" \
            -d "{\"video_url\":\"${VIDEO_URL}\",\"name\":\"${VIDEO_NAME}\"}")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Video uploaded successfully!\n" +
            "Listing: \(.listing_id)\n" +
            "Video ID: \(.video_id)\n" +
            "State: \(.video_state // "processing")\n" +
            "\nNote: Etsy processes videos - may take a few minutes to appear."
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    get-video)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh get-video <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_listing_videos&listing_id=${LISTING_ID}")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    shipping-profiles)
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_shipping_profiles")
        echo "$RESPONSE" | jq -r '
        "Shipping Profiles (\(.count)):\n" +
        (.shipping_profiles | map(
            "\n━━━ \(.shipping_profile_id) ━━━\n" +
            "Title: \(.title)\n" +
            "Processing: \(.min_processing_days // "?") - \(.max_processing_days // "?") days\n" +
            "Origin: \(.origin_country_iso)"
        ) | join("\n"))
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    return-policies)
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_return_policies")
        echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
        ;;

    shop-sections)
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_shop_sections")
        echo "$RESPONSE" | jq -r '
        "Shop Sections (\(.count)):\n" +
        (.sections | map(
            "  - \(.shop_section_id): \(.title) (\(.active_listing_count) listings)"
        ) | join("\n"))
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    readiness-states)
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_readiness_states")
        echo "$RESPONSE" | jq -r '
        "Processing Profiles / Readiness States (\(.count)):\n" +
        (.readiness_states | map(
            "  - \(.readiness_state_id): \(.readiness_state)"
        ) | join("\n")) +
        "\n\nUse readiness_state_id when creating listings."
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    get-personalization)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh get-personalization <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s "${API_URL}/etsy?apiKey=${API_KEY}&action=get_personalization&listing_id=${LISTING_ID}&supports_multiple_personalization_questions=true")
        echo "$RESPONSE" | jq -r '
        if .personalization_questions then
            "Personalization for listing \(.listing_id // "N/A"):\n" +
            "Personalizable: \(.is_personalizable // false)\n" +
            "Questions (\(.personalization_questions | length)):\n" +
            (.personalization_questions | to_entries | map(
                "\n━━━ Question #\(.key + 1) ━━━\n" +
                "  ID: \(.value.question_id // "N/A")\n" +
                "  Type: \(.value.question_type // "N/A")\n" +
                "  Text: \(.value.question_text // "N/A")\n" +
                "  Required: \(.value.required // false)\n" +
                "  Instructions: \(.value.instructions // "None")\n" +
                "  Max Chars: \(.value.max_allowed_characters // "N/A")" +
                (if .value.options then
                    "\n  Options: " + (.value.options | map(.label // .value) | join(", "))
                else "" end)
            ) | join("\n"))
        elif .error then
            "Error: \(.error)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    set-personalization)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: echo '[{\"question_type\":\"text_input\",\"question_text\":\"Personalization\",\"instructions\":\"Enter name\",\"required\":true,\"max_allowed_characters\":50}]' | etsy.sh set-personalization <listing_id>"
            echo ""
            echo "Question types: text_input"
            echo ""
            echo "Fields:"
            echo "  question_type, question_text, instructions, required, max_allowed_characters"
            echo "  Optional: max_allowed_files, options, question_id"
            exit 1
        fi
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=set_personalization&listing_id=${LISTING_ID}&supports_multiple_personalization_questions=true" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Personalization set successfully!\n" +
            "Listing: \(.listing_id // "N/A")\n" +
            "Questions set: \(.personalization_questions | length // 0)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    simple-personalization)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: echo '{\"instructions\":\"Enter your name\",\"required\":true}' | etsy.sh simple-personalization <listing_id>"
            echo ""
            echo "Sets a single text_input personalization question."
            echo "Fields: instructions, required (default: true), max_allowed_characters (optional)"
            exit 1
        fi
        JSON_BODY=$(cat)
        RESPONSE=$(curl -s -X POST "${API_URL}/etsy?apiKey=${API_KEY}&action=set_simple_personalization&listing_id=${LISTING_ID}&supports_multiple_personalization_questions=true" \
            -H "Content-Type: application/json" \
            -d "$JSON_BODY")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Simple personalization set!\n" +
            "Listing: \(.listing_id // "N/A")\n" +
            "Instructions: \(.instructions // "N/A")\n" +
            "Required: \(.required // true)"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    remove-personalization)
        LISTING_ID="$1"
        if [ -z "$LISTING_ID" ]; then
            echo "Usage: etsy.sh remove-personalization <listing_id>"
            exit 1
        fi
        RESPONSE=$(curl -s -X DELETE "${API_URL}/etsy?apiKey=${API_KEY}&action=remove_personalization&listing_id=${LISTING_ID}&supports_multiple_personalization_questions=true")
        echo "$RESPONSE" | jq -r '
        if .success then
            "Personalization removed from listing \(.listing_id // "N/A")"
        else
            . | tostring
        end
        ' 2>/dev/null || echo "$RESPONSE"
        ;;

    help|*)
        echo "Etsy API Helper for Clawd (BelleCoutureGifts)"
        echo ""
        echo "Usage: etsy.sh [command] [options]"
        echo ""
        echo "ORDERS:"
        echo "  orders                    - List recent orders"
        echo "  orders --customer NAME    - Search by customer name"
        echo "  orders --limit N          - Limit results"
        echo "  order RECEIPT_ID          - Get specific order details"
        echo ""
        echo "LISTINGS:"
        echo "  listings                  - List active listings"
        echo "  listings --limit N        - Limit results"
        echo "  listing LISTING_ID        - Get specific listing"
        echo "  copy LISTING_ID           - Copy listing as new draft (keeps all settings)"
        echo "  upload-image ID URL [RANK] [ALT] - Upload image with SEO alt text"
        echo "  upload-video ID URL       - Upload video to listing"
        echo "  get-video LISTING_ID      - Get video info for listing"
        echo "  publish LISTING_ID        - Publish draft listing"
        echo "  update LISTING_ID         - Update listing (JSON from stdin)"
        echo "  create-draft              - Create draft listing (JSON from stdin)"
        echo "  delete LISTING_ID         - Delete a listing"
        echo ""
        echo "PERSONALIZATION:"
        echo "  get-personalization ID    - Get personalization questions"
        echo "  set-personalization ID    - Set personalization (JSON array from stdin)"
        echo "  simple-personalization ID - Set simple text personalization (JSON from stdin)"
        echo "  remove-personalization ID - Remove all personalization"
        echo ""
        echo "SHOP CONFIG:"
        echo "  shipping-profiles         - List shipping profiles"
        echo "  return-policies           - List return policies"
        echo "  shop-sections             - List shop sections/categories"
        echo "  readiness-states          - List processing profiles"
        echo ""
        echo "EXAMPLES:"
        echo "  etsy.sh orders --customer Sarah"
        echo "  etsy.sh listing 4448583799"
        echo "  echo '{\"title\":\"New Title\"}' | etsy.sh update 4448583799"
        echo ""
        echo "  # Create draft listing:"
        echo "  echo '{"
        echo "    \"title\": \"Product Name\","
        echo "    \"description\": \"Product description...\","
        echo "    \"price\": 29.99,"
        echo "    \"quantity\": 10,"
        echo "    \"taxonomy_id\": 1257,"
        echo "    \"shipping_profile_id\": 246183515269,"
        echo "    \"readiness_state_id\": 1453886029193,"
        echo "    \"who_made\": \"i_did\","
        echo "    \"when_made\": \"made_to_order\""
        echo "  }' | etsy.sh create-draft"
        ;;
esac
