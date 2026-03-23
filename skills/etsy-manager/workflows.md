---
description: "Step-by-step workflows for common Etsy operations"
---

# Etsy Workflows

## Create New Listing from Scratch

1. Get required IDs:
   ```bash
   etsy.sh shipping-profiles
   etsy.sh readiness-states
   ```

2. Research keywords first:
   ```bash
   node /app/scripts/erank.cjs keyword "your product keyword"
   ```

3. Create draft with optimized SEO:
   ```bash
   echo '{
     "title": "Primary Keyword Product Name, Secondary Keyword Variation, Occasion Use Case, Differentiator — up to 140 chars",
     "description": "Primary keyword in first sentence. Full 6-part description...",
     "price": 29.99, "quantity": 10,
     "taxonomy_id": 1257,
     "shipping_profile_id": 246183515269,
     "readiness_state_id": 1453886029193,
     "who_made": "i_did", "when_made": "made_to_order",
     "tags": ["tag one phrase", "tag two phrase", "tag three", "tag four", "tag five", "tag six", "tag seven", "tag eight", "tag nine", "tag ten", "tag eleven", "tag twelve", "tag thirteen"],
     "materials": ["fabric", "ribbon"]
   }' | etsy.sh create-draft
   ```

4. Upload images with SEO alt text (up to 10, rank 1 = primary):
   ```bash
   etsy.sh upload-image <new_id> "https://...jpg" 1 "Primary keyword - descriptive alt text"
   etsy.sh upload-image <new_id> "https://...jpg" 2 "Secondary keyword - what's in this image"
   ```

5. Add personalization if needed:
   ```bash
   echo '{"instructions":"Enter name (max 50 chars)","required":true}' | etsy.sh simple-personalization <new_id>
   ```

6. Publish:
   ```bash
   etsy.sh publish <new_id>
   ```

## Duplicate & Customize Listing

1. Copy existing listing as draft:
   ```bash
   etsy.sh copy <source_id>
   # Returns new listing ID
   ```

2. Update title/description/price/tags:
   ```bash
   echo '{
     "title": "New Variation Title — optimized for different keyword",
     "price": 39.99,
     "tags": ["new tag 1", "new tag 2", "...", "all 13 tags"]
   }' | etsy.sh update <new_id>
   ```

3. Upload new images with alt text (copies don't carry images):
   ```bash
   etsy.sh upload-image <new_id> "https://...jpg" 1 "Primary image alt text with keywords"
   ```

4. Publish when ready:
   ```bash
   etsy.sh publish <new_id>
   ```

## Update Variation Prices

For listings with variations (size, color, etc.), prices CANNOT be changed via `etsy.sh update`.
Use the inventory API instead.

### Step 1: Get Current Inventory
```bash
etsy.sh get-inventory <listing_id>
```
Note each variation's `product_id`, `property_values`, `offering_id`, current price, and quantity.

### Step 2: Build Updated JSON
Include ALL variations (not just changed ones). Omitting a variation may remove it.

```bash
# Change all variations to the same price ($35):
etsy.sh get-inventory <id> | jq '{ products: [.products[] | { product_id, property_values, offerings: [.offerings[] | .price = 35.00] }] }' | etsy.sh update-inventory <id>

# Or change specific variation prices:
echo '{"products": [
  {"product_id": 111, "property_values": [{"property_id": 200, "property_name": "Size", "values": ["Small"]}], "offerings": [{"offering_id": 222, "price": 25.99, "quantity": 10, "is_enabled": true}]},
  {"product_id": 333, "property_values": [{"property_id": 200, "property_name": "Size", "values": ["Large"]}], "offerings": [{"offering_id": 444, "price": 35.99, "quantity": 5, "is_enabled": true}]}
]}' | etsy.sh update-inventory <id>
```

### Step 3: Verify
```bash
etsy.sh get-inventory <listing_id>
```

## SEO Optimization Workflow

Use this when optimizing an existing listing for better search ranking.

### Step 1: Get Current Listing Data
```bash
etsy.sh listing <listing_id>
```
Record: current title, tags, description, views, favorites.

### Step 2: Research Keywords
```bash
node /app/scripts/erank.cjs keyword "main product keyword"
node /app/scripts/erank.cjs keyword "alternate phrasing"
node /app/scripts/erank.cjs trending
```
Identify: highest-volume relevant keywords, trending terms, long-tail opportunities.

### Step 3: Audit Current SEO
```bash
node /app/scripts/erank.cjs audit <listing_id>
```
Review: SEO score, tag quality, missing opportunities.

### Step 4: Check Competitors
```bash
node /app/scripts/erank.cjs top-sellers "product category"
```
Learn: what titles/tags top sellers use.

### Step 5: Build Optimized Title (140 chars)
Formula: `[Primary Keyword] [Product], [Secondary Keyword] [Variation], [Occasion], [Differentiator]`
- Front-load highest-volume keyword
- Include 2-3 distinct phrases separated by commas
- Use all available characters

### Step 6: Build 13 Optimized Tags
| Slot | Type | Example |
|------|------|---------|
| 1-3 | Primary (high volume) | "gift box for her" |
| 4-7 | Long-tail (specific) | "spa gift set women" |
| 8-10 | Occasion/seasonal | "mothers day gift" |
| 11-13 | Attribute/differentiator | "personalized gift box" |

Rules:
- All 13 slots MUST be filled
- Multi-word phrases only (no single words)
- Use synonyms of title words, not exact copies
- Include seasonal terms if within 6 weeks of event

### Step 7: Rewrite Description
Structure:
1. **Hook** — 1-2 sentences, primary keyword, emotional appeal (first 160 chars matter most for Google)
2. **Product details** — bullet points: what's included, materials, dimensions
3. **Personalization** — specific instructions if applicable
4. **Occasions** — when/why to buy
5. **Shipping** — processing time, packaging quality
6. **Shop note** — cross-sell, care instructions

### Step 8: Apply Changes
```bash
echo '{
  "title": "Optimized title...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13"],
  "description": "Optimized description..."
}' | etsy.sh update <listing_id>
```

### Step 9: Verify
```bash
etsy.sh listing <listing_id>
```
Check: all 13 tags applied, title near 140 chars, description updated.

### Step 10: Report
Show the user:
- Before/after title comparison
- Tags added/removed/changed
- Key description changes
- Expected impact (24-48 hours for Etsy to reindex)

## Bulk Tag Update

For updating tags across multiple listings:

1. Get list of listings:
   ```bash
   etsy.sh listings --limit 50
   ```

2. For each listing, pull current data and update tags:
   ```bash
   etsy.sh listing <id>
   echo '{"tags": ["tag1", ..., "tag13"]}' | etsy.sh update <id>
   ```

3. Add seasonal tags in bulk (4-6 weeks before event):
   - Replace Tier 4 (attribute) tags with seasonal keywords
   - Keep Tier 1-3 tags stable for consistent ranking

## Cross-Post to Pinterest

After creating/updating a listing, pin it:

```bash
/app/scripts/pinterest.sh pin-from-etsy <listing_id> --board "Gift Ideas"
```

## Cross-Post to Shopify

Sync an Etsy listing to Shopify:

```bash
/app/scripts/shopify.sh sync-from-etsy <etsy_listing_id>
```
