---
description: "Etsy shop management for BelleCoutureGifts — listings, orders, SEO, images, personalization"
activation: "etsy, listing, bellecouture, gift box, etsy order, etsy SEO, erank"
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
| Publish draft | `etsy.sh publish <id>` |
| Upload image | `etsy.sh upload-image <id> <url> [rank] [alt]` |
| Upload video | `etsy.sh upload-video <id> <url>` |

## Workflows

For multi-step operations, see [[workflows]] for:
- Creating a new listing from scratch
- Duplicating and customizing an existing listing
- SEO optimization with eRank
- Bulk tag updates

## SEO & Research

Use eRank for keyword research before creating/optimizing listings:

```bash
node /app/scripts/erank.cjs keyword "gift box for her"
node /app/scripts/erank.cjs analyze "https://www.etsy.com/listing/123"
node /app/scripts/erank.cjs trending
node /app/scripts/erank.cjs top-sellers "gift boxes"
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

- Shipping addresses blocked by Etsy for third-party apps
- Statistics/analytics NOT available via API
- Etsy Ads NOT available via API
- Images must be uploaded after creating draft
- Video: 5-60s, max 100MB, MP4/MOV, audio stripped, 1 per listing
