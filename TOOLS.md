# Tools Reference — Detailed Command Syntax

Read this file ONLY when you need specific command syntax for a tool.

---

## 1. Google Workspace (via `gog` CLI)

```bash
# Gmail
gog gmail list                    # List recent emails
gog gmail read <id>               # Read specific email
gog gmail send --to <email> --subject "..." --body "..."

# Calendar
gog calendar list                 # List upcoming events
gog calendar add --title "..." --start "2026-01-30 10:00" --end "2026-01-30 11:00"
gog calendar respond <calendarId> <eventId> --status accepted|declined|tentative

# Drive
gog drive list                    # List files
gog drive download <fileId>       # Download file
gog drive upload <path>           # Upload file

# Sheets
gog sheets read <spreadsheetId>   # Read spreadsheet
gog sheets append <spreadsheetId> --range "Sheet1!A:Z" --values '["row","data"]'

# Contacts
gog contacts list                 # List contacts
gog contacts search <query>       # Search contacts
```

---

## 2. Image Generation (Gemini via nano-banana-pro)

Use the nano-banana-pro skill for image generation. The skill handles Gemini API calls automatically.

---

## 3. Browser Automation

Script: `/app/scripts/browser-automation.cjs`

```bash
node /app/scripts/browser-automation.cjs screenshot "https://example.com" "/tmp/screenshot.png"
node /app/scripts/browser-automation.cjs pdf "https://example.com" "/tmp/page.pdf"
node /app/scripts/browser-automation.cjs fetch "https://example.com"
node /app/scripts/browser-automation.cjs canva-login
```

---

## 4. Canva (via Browser Automation)

1. Login: `node /app/scripts/browser-automation.cjs canva-login`
2. Use Puppeteer for design operations

---

## 5. Weather

Use the weather skill when asked about weather conditions or forecasts.

---

## 6. Video Processing (ffmpeg)

```bash
ffmpeg -i input.mp4 -ss 00:00:05 -frames:v 1 frame.png    # Extract frame
ffmpeg -i input.mp4 -ss 00:00:05 -t 00:00:10 -c copy clip.mp4  # Extract clip
ffmpeg -i input.mp4 output.gif                                # Convert format
```

---

## 7. Slack Tools

React to messages, pin/unpin items in Slack channels via built-in skill.

---

## 8. KolayXport Orders API

Script: `/app/scripts/kolayxport.sh`

```bash
/app/scripts/kolayxport.sh orders                    # List recent orders
/app/scripts/kolayxport.sh orders --status Picking    # Filter by status
/app/scripts/kolayxport.sh orders --limit 5           # Limit results
/app/scripts/kolayxport.sh order <order-id>           # Get specific order
```

Statuses: Picking, Shipped, Delivered, Cancelled

---

## 9. Trello

Use the Trello REST API skill for boards, lists, and cards.

---

## 10. Etsy (via KolayXport API)

Script: `/app/scripts/etsy.sh`

### Orders
```bash
/app/scripts/etsy.sh orders
/app/scripts/etsy.sh orders --customer "Sarah"
/app/scripts/etsy.sh orders --limit 5
/app/scripts/etsy.sh order 3963746325
```

### Listings
```bash
/app/scripts/etsy.sh listings --limit 10
/app/scripts/etsy.sh listing 4448583799
/app/scripts/etsy.sh copy 4448583799                  # Copy as draft
/app/scripts/etsy.sh copy 4448583799 "NEW - "         # Copy with prefix
echo '{"title":"New Title","tags":["tag1","tag2"]}' | /app/scripts/etsy.sh update 4448583799
```

### Complete Listing Workflow
```bash
# 1. Copy existing listing
/app/scripts/etsy.sh copy 4448583799
# 2. Upload images with SEO alt text
/app/scripts/etsy.sh upload-image <new_id> "https://...jpg" 1 "Personalized gift box"
# 3. Update title/description/price
echo '{"title":"New Name","price":39.99}' | /app/scripts/etsy.sh update <new_id>
# 4. Publish
/app/scripts/etsy.sh publish <new_id>
```

### Images & Videos
```bash
/app/scripts/etsy.sh upload-image <listing_id> <image_url> [rank] [alt_text]
/app/scripts/etsy.sh upload-video <listing_id> <video_url>
/app/scripts/etsy.sh get-video <listing_id>
```

Video: 5-60s, max 100MB, MP4/MOV/MPEG/FLV/AVI, audio stripped, 1 per listing.

### Create Draft
```bash
/app/scripts/etsy.sh shipping-profiles    # Get shipping_profile_id
/app/scripts/etsy.sh readiness-states     # Get readiness_state_id
echo '{
  "title": "Product Name",
  "description": "Full description...",
  "price": 29.99, "quantity": 10,
  "taxonomy_id": 1257,
  "shipping_profile_id": 246183515269,
  "readiness_state_id": 1453886029193,
  "who_made": "i_did", "when_made": "made_to_order",
  "tags": ["gift box", "handmade"],
  "materials": ["fabric", "ribbon"]
}' | /app/scripts/etsy.sh create-draft
```

### Shop Config
```bash
/app/scripts/etsy.sh shipping-profiles
/app/scripts/etsy.sh readiness-states
/app/scripts/etsy.sh shop-sections
/app/scripts/etsy.sh return-policies
```

Shop Shipping Profiles: 246183515269 (Standard), 296069813802 (US stock)

### Personalization
```bash
/app/scripts/etsy.sh get-personalization <listing_id>
echo '{"instructions":"Enter name","required":true}' | /app/scripts/etsy.sh simple-personalization <listing_id>
echo '[{"question_type":"text_input","question_text":"Personalization","instructions":"Enter name (max 50 chars)","required":true,"max_allowed_characters":50}]' | /app/scripts/etsy.sh set-personalization <listing_id>
/app/scripts/etsy.sh remove-personalization <listing_id>
```

### Notes
- Shipping addresses blocked by Etsy for third-party apps
- Statistics/analytics NOT available via API
- Etsy Ads NOT available via API
- Images must be uploaded after creating draft

---

## 11. Trendyol (via KolayXport API)

Script: `/app/scripts/trendyol.sh`

### Products
```bash
/app/scripts/trendyol.sh products
/app/scripts/trendyol.sh products --approved true --onSale true
/app/scripts/trendyol.sh products --barcode BARCODE123 --sku STOCKCODE
/app/scripts/trendyol.sh product BARCODE123
echo '{"items":[{"barcode":"BC123","title":"Title","productMainId":"GRP-001","brandId":1234,"categoryId":5678,"quantity":50,"stockCode":"SKU-001","description":"...","currencyType":"TRY","listPrice":199.99,"salePrice":149.99,"vatRate":10,"cargoCompanyId":17,"images":[{"url":"https://..."}],"attributes":[{"attributeId":338,"attributeValueId":4567}]}]}' | /app/scripts/trendyol.sh create-product
echo '{"items":[{"barcode":"BC123","title":"Updated","salePrice":129.99,"listPrice":179.99}]}' | /app/scripts/trendyol.sh update-product
echo '{"items":[{"barcode":"BC1","quantity":100,"salePrice":149.99,"listPrice":199.99}]}' | /app/scripts/trendyol.sh update-stock-price
/app/scripts/trendyol.sh batch-status BATCH_ID
/app/scripts/trendyol.sh archive BARCODE123
```

### Categories & Brands
```bash
/app/scripts/trendyol.sh categories
/app/scripts/trendyol.sh category-attributes 1234
/app/scripts/trendyol.sh brands --name "Belle"
```

### Orders
```bash
/app/scripts/trendyol.sh orders
/app/scripts/trendyol.sh orders --status Created|Picking|Shipped --days 7
/app/scripts/trendyol.sh order 10920042184
```

### Shipment & Invoice
```bash
echo '{"shipmentPackageId":123,"trackingNumber":"TRACK123","cargoCompany":17}' | /app/scripts/trendyol.sh update-tracking
/app/scripts/trendyol.sh shipping-label TRACKING123
/app/scripts/trendyol.sh cargo-companies
echo '{"shipmentPackageId":123,"invoiceLink":"https://...","invoiceNumber":"INV-001","invoiceDateTime":1708100000000}' | /app/scripts/trendyol.sh send-invoice
```

### Returns & Q&A
```bash
/app/scripts/trendyol.sh claims --days 7
echo '{"claimId":"CLAIM123","claimLineItemIdList":["LINE1"]}' | /app/scripts/trendyol.sh approve-claim
/app/scripts/trendyol.sh questions --status WAITING_FOR_ANSWER
echo '{"questionId":12345,"text":"Answer text..."}' | /app/scripts/trendyol.sh answer-question
```

### Finance
```bash
/app/scripts/trendyol.sh settlements --days 30
/app/scripts/trendyol.sh addresses
```

### Order Statuses
Created, Picking, Invoiced, Shipped, Delivered, Cancelled, UnDelivered, Returned, UnSupplied

### Cargo Companies
4=MNG, 7=Yurtici, 10=UPS, 14=PTT, 17=Aras, 19=Surat

### Notes
- Product create/update are async — use batch-status to check
- Max 1000 items per stock/price update batch
- Trendyol API uses epoch milliseconds for dates
- Ads and analytics NOT available via API

---

## 12. eRank (Etsy SEO Research)

Script: `node /app/scripts/erank.cjs`

```bash
node /app/scripts/erank.cjs login
node /app/scripts/erank.cjs keyword "gift box for her"
node /app/scripts/erank.cjs analyze "https://www.etsy.com/listing/123456789"
node /app/scripts/erank.cjs trending
node /app/scripts/erank.cjs top-sellers "gift boxes"
```

Features: Keyword Explorer, Listing Audit, Trend Buzz, Top Sellers, Competitor Spy, Tag Generator.
Rate limit: be human-like, don't spam requests.

---

## 13. Pinterest (via Make.com)

Script: `/app/scripts/pinterest.sh`

```bash
/app/scripts/pinterest.sh status
/app/scripts/pinterest.sh test
/app/scripts/pinterest.sh pin-from-etsy 4448583799 [--board "Gift Ideas"]
/app/scripts/pinterest.sh pin-from-shopify 8765432109876
echo '{"title":"...","description":"...","link":"https://...","imageUrl":"https://..."}' | /app/scripts/pinterest.sh create-pin
echo '{"title":"Gift Box","tags":["gift"],"price":"$29.99"}' | /app/scripts/pinterest.sh generate-description
/app/scripts/pinterest.sh viral-ideas "Gift Box" "self-care gift"
```

SEO: Use 2:3 image ratio (1000x1500), 3-5 hashtags, keyword-rich titles.
Free tier: 1000 ops/month. Best times: 8-11pm, weekends.

---

## 14. Shopify (Direct Admin API)

Script: `/app/scripts/shopify.sh`

```bash
/app/scripts/shopify.sh status
/app/scripts/shopify.sh products [--limit N] [--status active|draft|archived]
/app/scripts/shopify.sh product <id>
echo '{"title":"Name","variants":[{"price":"29.99"}]}' | /app/scripts/shopify.sh create-product
echo '{"title":"Updated"}' | /app/scripts/shopify.sh update-product <id>
/app/scripts/shopify.sh delete-product <id>
/app/scripts/shopify.sh orders [--limit N] [--status open|closed|cancelled]
/app/scripts/shopify.sh order <id>
echo '{"tracking_number":"1234","tracking_company":"UPS"}' | /app/scripts/shopify.sh fulfill <order_id>
/app/scripts/shopify.sh customers [--limit N]
/app/scripts/shopify.sh search-customers "john@example.com"
/app/scripts/shopify.sh locations
/app/scripts/shopify.sh inventory <inventory_item_ids>
/app/scripts/shopify.sh collections [--type custom|smart]
/app/scripts/shopify.sh sales [--days 30]
/app/scripts/shopify.sh counts
/app/scripts/shopify.sh sync-from-etsy <etsy_listing_id>
```

---

## Environment Variables

- `CANVA_EMAIL`, `CANVA_PASSWORD` — Canva
- `GEMINI_API_KEY` — Gemini image generation
- `GOG_CREDENTIALS_JSON`, `GOG_TOKEN_JSON` — Google OAuth
- `KOLAYXPORT_API_KEY`, `KOLAYXPORT_API_URL` — KolayXport
- `TRELLO_API_KEY`, `TRELLO_TOKEN` — Trello
- `VELA_EMAIL`, `VELA_PASSWORD` — Vela (legacy)
- `ERANK_EMAIL`, `ERANK_PASSWORD` — eRank
- `MAKE_PINTEREST_WEBHOOK_URL` — Pinterest via Make.com
- `CLOUDINARY_CLOUD_NAME` — Image proxying (default: dhcwyis5i)
- `SHOPIFY_STORE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` — Shopify (legacy)
- `SHOPIFY_ACCESS_TOKEN` — Shopify (custom app, alternative)
