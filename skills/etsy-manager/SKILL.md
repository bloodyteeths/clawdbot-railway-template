---
description: "Etsy shop management for BelleCoutureGifts — listings, orders, SEO, images, personalization"
activation: "etsy, listing, bellecouture, gift box, etsy order, etsy SEO, erank, optimize, tags, update listing"
tools: ["/app/scripts/etsy.sh", "node /app/scripts/erank.cjs"]
---

# Etsy Manager — BelleCoutureGifts

Manage the BelleCoutureGifts Etsy shop. All API calls go through KolayXport proxy via `etsy.sh`.

**NEVER call Etsy API directly.** Always use `/app/scripts/etsy.sh`.

## Quick Reference

| Action | Command |
|--------|---------|
| List orders | `etsy.sh orders` |
| Search orders | `etsy.sh orders --customer "Name"` |
| Get order | `etsy.sh order <id>` |
| List listings | `etsy.sh listings --limit 10` |
| Get listing | `etsy.sh listing <id>` |
| Copy listing | `etsy.sh copy <id> ["Prefix"]` |
| Update listing | `echo '{"title":"..."}' \| etsy.sh update <id>` |
| Get inventory | `etsy.sh get-inventory <id>` |
| Update prices | `echo '<json>' \| etsy.sh update-inventory <id>` |
| Publish draft | `etsy.sh publish <id>` |
| Upload image | `etsy.sh upload-image <id> <url> [rank] [alt]` |
| Upload video | `etsy.sh upload-video <id> <url>` |

## SEO & Research (eRank)

eRank Pro account. HTTP login + Puppeteer browser extraction:

```bash
node /app/scripts/erank.cjs shop                            # Shop overview: sales, tags, images, quotas
node /app/scripts/erank.cjs keyword "gift box for her"      # Keyword research: searches, clicks, CTR, competition
node /app/scripts/erank.cjs audit <listing_id>              # Listing SEO audit
node /app/scripts/erank.cjs trending                        # Trending keywords (Trend Buzz)
node /app/scripts/erank.cjs health                          # Health check: missing images/tags/spelling
node /app/scripts/erank.cjs listings                        # Active listings with grades and visibility
```

If Puppeteer is unavailable, use the built-in keyword database: `skills/etsy-seo-optimizer/keywords.md`

### SEO Quick Rules (full methodology in [[etsy-seo-optimizer]])

1. **Title:** Use all 140 chars. Front-load highest-volume keyword. 2-3 comma-separated phrases.
2. **Tags:** Use ALL 13 slots. Multi-word phrases only. No single words. Include seasonal tags.
3. **Description:** Front-load primary keyword in first sentence. Use 6-part structure (hook, details, personalization, occasions, shipping, shop note).
4. **Images:** Use all 10 slots. Set alt text with keywords on every image.
5. **Video:** Upload if available — listings with video get 2-3x more views.
6. **Materials:** Always fill in — Etsy uses this for search matching.

### Optimization Workflow

1. `etsy.sh listing <id>` — pull current data
2. `node /app/scripts/erank.cjs keyword "<product keyword>"` — research volume
3. `node /app/scripts/erank.cjs audit <id>` — get SEO score
4. Build optimized title (140 chars, front-load primary keyword)
5. Build 13 tags (multi-word, mix long-tail + occasion + attribute)
6. Rewrite description (6-part framework)
7. `echo '{"title":"...", "tags":[...], "description":"..."}' | etsy.sh update <id>`
8. Verify: `etsy.sh listing <id>`
9. Report before/after to user

## Workflows

For multi-step operations, see [[workflows]] for:
- Creating a new listing from scratch
- Duplicating and customizing an existing listing
- SEO optimization with eRank
- Bulk tag updates

## Variation Prices (Inventory)

**IMPORTANT:** Listings with variations (size, color, etc.) cannot have prices changed via `etsy.sh update`.
Use the inventory commands instead:

```bash
# 1. View current variation prices
etsy.sh get-inventory <listing_id>

# 2. Update prices — must include ALL variations, not just changed ones
# Get current inventory, modify prices with jq, pipe back
etsy.sh get-inventory <id> | jq '{ products: [.products[] | { product_id, property_values, offerings: [.offerings[] | .price = 35.00] }] }' | etsy.sh update-inventory <id>

# Or craft the JSON manually for selective price changes
echo '{"products": [
  {"product_id": 123, "property_values": [...], "offerings": [{"offering_id": 456, "price": 29.99, "quantity": 10, "is_enabled": true}]},
  {"product_id": 789, "property_values": [...], "offerings": [{"offering_id": 012, "price": 39.99, "quantity": 5, "is_enabled": true}]}
]}' | etsy.sh update-inventory <id>
```

## Personalization

```bash
etsy.sh get-personalization <id>
echo '{"instructions":"Enter name","required":true}' | etsy.sh simple-personalization <id>
etsy.sh remove-personalization <id>
```

## Shop Config

```bash
etsy.sh shipping-profiles    # 246183515269 (Standard), 296069813802 (US stock)
etsy.sh readiness-states
etsy.sh shop-sections
etsy.sh return-policies
```

## Limitations

- **Price changes on variation listings**: Must use `get-inventory` / `update-inventory`, NOT `update`. The `update` command only works for non-variation listing prices.
- Shipping addresses blocked by Etsy for third-party apps
- Statistics/analytics NOT available via API
- Etsy Ads NOT available via API
- Images must be uploaded after creating draft
- Video: 5-60s, max 100MB, MP4/MOV, audio stripped, 1 per listing
