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

2. Create draft:
   ```bash
   echo '{
     "title": "Product Name — Keyword Rich Title",
     "description": "Full description with keywords...",
     "price": 29.99, "quantity": 10,
     "taxonomy_id": 1257,
     "shipping_profile_id": 246183515269,
     "readiness_state_id": 1453886029193,
     "who_made": "i_did", "when_made": "made_to_order",
     "tags": ["gift box", "personalized gift", "handmade"],
     "materials": ["fabric", "ribbon"]
   }' | etsy.sh create-draft
   ```

3. Upload images (up to 10, rank 1 = primary):
   ```bash
   etsy.sh upload-image <new_id> "https://...jpg" 1 "SEO alt text for primary image"
   etsy.sh upload-image <new_id> "https://...jpg" 2 "Alt text for second image"
   ```

4. Add personalization if needed:
   ```bash
   echo '{"instructions":"Enter name (max 50 chars)","required":true}' | etsy.sh simple-personalization <new_id>
   ```

5. Publish:
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
     "title": "New Variation Title",
     "price": 39.99,
     "tags": ["new tag 1", "new tag 2"]
   }' | etsy.sh update <new_id>
   ```

3. Upload new images (copies don't carry images):
   ```bash
   etsy.sh upload-image <new_id> "https://...jpg" 1 "Primary image alt"
   ```

4. Publish when ready:
   ```bash
   etsy.sh publish <new_id>
   ```

## SEO Optimization Workflow

1. Research keywords:
   ```bash
   node /app/scripts/erank.cjs keyword "your product keyword"
   node /app/scripts/erank.cjs trending
   ```

2. Audit current listing:
   ```bash
   node /app/scripts/erank.cjs analyze "https://www.etsy.com/listing/<id>"
   ```

3. Check competitor listings:
   ```bash
   node /app/scripts/erank.cjs top-sellers "gift boxes"
   ```

4. Update listing with optimized tags/title:
   ```bash
   echo '{
     "title": "Keyword-optimized title with long-tail phrases",
     "tags": ["max 13 tags", "use all slots", "long-tail keywords"]
   }' | etsy.sh update <id>
   ```

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
