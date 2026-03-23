---
description: "eBay shop management — smart listing creation from Drive photos, market research, pricing, SEO optimization, orders"
activation: "ebay, ebay listing, list on ebay, ebay order, ebay seo, ebay price, sell on ebay, product photos, drive photos, bulk listing"
tools: ["/app/scripts/ebay.sh", "gog"]
---

# eBay Manager — KolayXport Direct Integration

Manage eBay listings through KolayXport's full eBay API. All calls go through `ebay.sh`.

**NEVER call eBay API directly.** Always use `/app/scripts/ebay.sh`.

## Quick Reference

| Task | Command |
|------|---------|
| List listings | `ebay.sh listings --limit 20` |
| Get listing | `ebay.sh listing SKU` |
| Create listing | `echo '{...}' \| ebay.sh create SKU` |
| Update listing | `echo '{...}' \| ebay.sh update SKU` |
| Delete listing | `ebay.sh delete SKU` |
| Publish offer | `ebay.sh publish OFFER_ID` |
| Withdraw listing | `ebay.sh withdraw OFFER_ID` |
| Upload image | `ebay.sh upload-image /path/to/photo.jpg` |
| List orders | `ebay.sh orders --limit 20` |
| Get order | `ebay.sh order ORDER_ID` |
| Search market | `ebay.sh search "product name"` |
| Search seller | `ebay.sh search-seller USERNAME` |
| Category bestsellers | `ebay.sh bestsellers CATEGORY_ID` |
| SEO analysis | `ebay.sh analyze-seo "query" --my-title "My Title"` |
| AI optimize title | `echo '{...}' \| ebay.sh ai-title` |
| AI generate desc | `echo '{...}' \| ebay.sh ai-description` |
| AI suggest price | `echo '{...}' \| ebay.sh ai-price` |
| AI analyze listing | `echo '{...}' \| ebay.sh ai-analyze` |
| Track product | `ebay.sh track-product ITEM_ID` |
| Track seller | `ebay.sh track-seller USERNAME` |
| Niche analysis | `ebay.sh niche-analyze "query"` |
| Product database | `ebay.sh product-db "query"` |
| Analytics | `ebay.sh analytics --days 30` |
| My listings (legacy) | `ebay.sh my-listings` |
| Policies | `ebay.sh fulfillment-policies` / `return-policies` / `payment-policies` |
| Categories | `ebay.sh categories` / `ebay.sh category-suggestions "query"` |
| Item aspects | `ebay.sh aspects CATEGORY_ID` |

## Full API Reference

Read `/data/workspace/docs/EBAY_CLAWD_TOOLS_PROMPT.md` for complete API documentation with all actions, parameters, and response formats.

---

## SMART LISTING WORKFLOW: Google Drive → eBay

This is the core workflow. User provides photos (via Drive folder, WhatsApp, or direct upload), and you intelligently create optimized eBay listings.

### Step 0: Get Photos from Google Drive

```bash
# List files in a Drive folder
gog drive list --folder-id FOLDER_ID

# Download a specific file
gog drive download FILE_ID --output /tmp/product-photo.jpg

# List all images in a folder
gog drive list --folder-id FOLDER_ID --type image
```

If user says "check my Drive" or "photos are in Drive", ask for the folder name/link or search:
```bash
gog drive search "product photos" --type folder
```

### Step 1: Identify & Group Products (CRITICAL)

When you receive multiple photos, you MUST identify and group them by product. Use your vision capabilities:

1. **Download all images** from the Drive folder to /tmp/
2. **Look at each image** — you are multimodal, you can see the photos
3. **Identify what each product is** — material, color, style, brand, size, condition
4. **Group photos by product** — multiple angles of the same item go together
5. **Name each product group** with a descriptive working title

**Grouping heuristics:**
- Same item from different angles → same product
- Same item in different colors → separate products (unless user wants variations)
- Packaging + product shot → same product
- Scale/measurement photos → belongs with the measured product
- Lifestyle/in-use shots → belongs with the featured product

**When uncertain:** Ask the user. Show thumbnails and ask "Are photos 3, 5, 7 the same product?"

### Step 2: Research Each Product on eBay

For EACH identified product:

```bash
# 1. Find the right category
ebay.sh category-suggestions "product description"

# 2. Search for similar products — analyze competition
ebay.sh search "product keywords" --limit 50

# 3. Check category bestsellers for pricing context
ebay.sh bestsellers CATEGORY_ID --limit 20

# 4. Get required item aspects for the category
ebay.sh aspects CATEGORY_ID
```

**From the search results, extract:**
- `priceStats` → min, max, avg, median prices
- `topKeywords` → what keywords competitors use in titles
- `aspectDistributions` → what brands/attributes dominate
- Top sellers' strategies (free shipping?, item condition?, title patterns?)

### Step 3: Determine Pricing Strategy

```bash
# Get AI price suggestion with competitor data
echo '{
  "title": "Your Product Title",
  "condition": "New",
  "categoryName": "Category Name",
  "competitorPrices": [19.99, 24.99, 22.50, 29.99, 18.00]
}' | ebay.sh ai-price
```

**Pricing rules:**
- New seller = price 10-15% below median to gain traction
- Match or undercut top sellers' prices for identical items
- Factor in shipping costs (free shipping listings get more visibility)
- Consider condition — "New" commands premium over "Used"
- If product is unique/handmade, price at or above median

### Step 4: Create Optimized Listing

```bash
# 1. Optimize the title (max 80 chars for eBay!)
echo '{
  "title": "Your Draft Title",
  "categoryName": "Category",
  "keywords": ["brand", "key feature", "size"]
}' | ebay.sh ai-title

# 2. Generate HTML description
echo '{
  "title": "Optimized Title",
  "aspects": {"Brand": ["X"], "Size": ["Y"]},
  "condition": "New",
  "price": 24.99
}' | ebay.sh ai-description

# 3. Upload all product images
ebay.sh upload-image /tmp/product-front.jpg
ebay.sh upload-image /tmp/product-back.jpg
ebay.sh upload-image /tmp/product-detail.jpg
# Save each returned URL

# 4. Create the listing
echo '{
  "sku": "UNIQUE-SKU-001",
  "title": "Optimized SEO Title Here Max 80 Chars",
  "price": 24.99,
  "description": "<div>Generated HTML description</div>",
  "aspects": {
    "Brand": ["Brand Name"],
    "Color": ["Blue"],
    "Size": ["Medium"]
  },
  "imageUrls": [
    "https://supabase-url/image1.jpg",
    "https://supabase-url/image2.jpg"
  ],
  "condition": "NEW",
  "quantity": 5,
  "categoryId": "12345",
  "paymentPolicyId": "...",
  "returnPolicyId": "...",
  "fulfillmentPolicyId": "...",
  "publish": true
}' | ebay.sh create UNIQUE-SKU-001
```

### Step 5: Verify & Report

After creating each listing:
1. Confirm listing is published with `ebay.sh listing SKU`
2. Run `echo '{"title":"...","imageCount":N}' | ebay.sh ai-analyze` to verify quality
3. Report to user: title, price, URL, quality score

---

## eBay Title SEO Rules (IMPORTANT)

eBay titles are **max 80 characters** (NOT 140 like Etsy). Every character counts.

**Title formula:** `[Brand] [Product] [Key Feature] [Size/Color] [Condition] [Differentiator]`

**Do:**
- Front-load the most important keywords
- Include brand name if applicable
- Include size, color, material when relevant
- Use common search terms (check `topKeywords` from market research)
- Include condition keywords: "New", "Vintage", "Sealed"

**Don't:**
- Use ALL CAPS (eBay penalizes this)
- Use special characters: !, @, #, $, %, *, excessive punctuation
- Use filler words: "wow", "amazing", "look", "L@@K"
- Repeat words
- Use abbreviations buyers won't search for

---

## Item Aspects (Specifics) — CRITICAL for SEO

eBay heavily weighs item specifics in search ranking. ALWAYS fill in all required AND recommended aspects.

```bash
# Get required aspects for a category
ebay.sh aspects CATEGORY_ID
```

From the response, fill in ALL aspects marked `aspectRequired: true`. For optional aspects, fill in as many as possible — more specifics = higher search ranking.

**Common required aspects by category:**
- Clothing: Brand, Size, Color, Material, Style, Pattern
- Electronics: Brand, Model, Type, Connectivity, Compatible Model
- Home: Brand, Material, Color, Room, Style, Type
- Toys: Brand, Age Level, Character Family, Type

---

## SKU Naming Convention

Generate meaningful SKUs: `CATEGORY-PRODUCT-VARIANT`

Examples:
- `SHOE-NIKE-AM90-RED-42` (Nike Air Max 90, Red, Size 42)
- `GIFT-CANDLE-SET-3PK` (Candle gift set, 3 pack)
- `ELEC-BT-EARBUDS-BLK` (Bluetooth earbuds, black)
- `HOME-VASE-CERAMIC-LG` (Ceramic vase, large)

---

## Bulk Listing Workflow

When creating many listings at once:

1. **Get policies once** (reuse for all listings):
   ```bash
   ebay.sh fulfillment-policies
   ebay.sh return-policies
   ebay.sh payment-policies
   ```
   Save the policy IDs.

2. **Process products sequentially** — don't blast the API
3. **Use bulk title optimization** for efficiency:
   ```bash
   echo '{
     "listings": [
       {"id": "SKU-1", "title": "draft title 1", "categoryName": "Cat1"},
       {"id": "SKU-2", "title": "draft title 2", "categoryName": "Cat2"}
     ]
   }' | ebay.sh ai-bulk-titles
   ```
4. **Report progress** to user after each listing: "Created 3/10: Nike Shoes - $24.99"

---

## Competitor Tracking Workflow

```bash
# 1. Find top sellers in your niche
ebay.sh search "your product" --limit 50
# Look at seller names in results

# 2. Track a competitor
ebay.sh track-seller "competitor_username"

# 3. Track their best products
ebay.sh search-seller "competitor_username" --limit 20
# Pick top items by estimatedSoldQuantity
ebay.sh track-product LEGACY_ITEM_ID --notes "Top seller's best item"

# 4. Deep niche analysis
ebay.sh niche-analyze "product category"

# 5. Monitor over time
ebay.sh refresh-tracked
ebay.sh price-history PRODUCT_ID
```

---

## Order Management

```bash
# List unfulfilled orders
ebay.sh orders --filter "orderfulfillmentstatus:{NOT_STARTED}"

# Get order details with shipping address
ebay.sh order ORDER_ID

# After shipping, tracking is updated via eBay seller hub or API
```

---

## IMPORTANT NOTES

- **eBay title max: 80 characters** (not 140 like Etsy)
- **Images need public URLs** — always upload via `ebay.sh upload-image` first
- **Item aspects are critical** — fill ALL required + recommended for search ranking
- **Price competitively** — use market research data, not guesswork
- **Condition matters** — specify exactly (New, Used, Refurbished, etc.)
- **Free shipping boosts visibility** — consider building shipping into price
- **eBay rate limits apply** — don't make more than 5 requests/second
- **SKU must be unique** — check existing listings before creating
- **Publish = live** — `publish: true` in create makes it immediately live. Omit to create as draft.
