---
description: "eBay management via Veeqo — products, inventory, orders, shipping, stock alerts"
activation: "veeqo, ebay, stock, inventory, low stock, warehouse, reorder, out of stock, outletemporiumus"
---

# eBay Manager (via Veeqo)

Manage the **outletemporiumus** eBay store through Veeqo API. Veeqo syncs with eBay automatically — stock and price changes push to eBay immediately.

**Script:** `/app/scripts/veeqo.sh`
**API:** https://api.veeqo.com
**Auth:** `VEEQO_API_KEY` env var (x-api-key header)
**Rate limit:** 5 req/sec

## IMPORTANT: eBay Only

Veeqo has multiple channels connected. Clawd ONLY manages the **eBay** channel:

| Channel ID | Name | Type | Clawd Access |
|-----------|------|------|-------------|
| **633404** | **outletemporiumus** | **eBay** | **YES — full access** |
| 633413 | bellecouturegifts | Etsy | NO — do not touch |
| 633409 | mybabybymerry | Shopify | NO — do not touch |
| 633487 | decorsweetart | Amazon | NO — do not touch |
| 633488 | decorsweetart FBA | Amazon FBA | NO — do not touch |
| 419473 | Amazon Channel | Amazon | NO — do not touch |

**Always use `--channel 633404` when listing products or orders** to scope to eBay only. Never modify products, stock, or orders belonging to other channels.

## Quick Reference

| Task | Command |
|------|---------|
| List eBay products | `veeqo.sh products --channel 633404` |
| Search eBay products | `veeqo.sh products --channel 633404 --query "gift box"` |
| Product details | `veeqo.sh product <id>` |
| Low stock alert | `veeqo.sh low-stock` |
| Check stock | `veeqo.sh stock <sellable_id> <warehouse_id>` |
| Set stock level | `veeqo.sh set-stock <sellable_id> <warehouse_id> <level>` |
| List eBay orders | `veeqo.sh orders --channel 633404` |
| Unfulfilled eBay orders | `veeqo.sh orders --channel 633404 --status awaiting_fulfillment` |
| Order details | `veeqo.sh order <id>` |
| Fulfill order | `echo '{"tracking_number":"..."}' \| veeqo.sh fulfill <order_id>` |
| Warehouses | `veeqo.sh warehouses` |

## eBay Sync Behavior

| What | Sync direction | Frequency |
|------|---------------|-----------|
| New orders | eBay -> Veeqo | Every 10 min |
| New listings | eBay -> Veeqo | Every 60 min |
| Listing updates | eBay -> Veeqo | Every 60 min |
| Stock changes | Veeqo -> eBay | Immediate |
| Price changes | Veeqo -> eBay | Immediate (if price master) |
| Fulfillment/tracking | Veeqo -> eBay | On shipment creation |
| Refunds | NOT synced | Must process on eBay directly |

## Key Concepts

- **Product** = the main item (has title, description, images)
- **Sellable** = a variant/SKU within a product (has price, weight, stock)
- **Sellable ID** = needed for stock operations (not the product ID)
- **Warehouse ID** = stock is tracked per-warehouse. Get IDs via `veeqo.sh warehouses`
- **Channel ID 633404** = the eBay outletemporiumus channel. Always filter by this.
- **Allocation** = assigns order items to a warehouse for fulfillment

## Common Workflows

### Check and replenish low stock
```bash
# 1. Find what's running low
veeqo.sh low-stock

# 2. Replenish a specific variant
veeqo.sh set-stock <sellable_id> <warehouse_id> 50
```

### Fulfill an eBay order
```bash
# 1. Find unfulfilled eBay orders
veeqo.sh orders --channel 633404 --status awaiting_fulfillment

# 2. Get order details
veeqo.sh order <order_id>

# 3. Mark as shipped with tracking
echo '{"tracking_number":"1Z999AA10123456784"}' | veeqo.sh fulfill <order_id>
```

### Create a new product (syncs to eBay)
```bash
echo '{
  "product": {
    "title": "Luxury Gift Box Set",
    "description": "Beautiful handcrafted gift box",
    "product_variants_attributes": [{
      "title": "Standard",
      "sku_code": "LGB-001",
      "price": 34.99,
      "weight_grams": 500,
      "min_reorder_level": 5,
      "quantity_to_reorder": 20
    }],
    "images_attributes": [
      {"src": "https://example.com/image.jpg", "display_position": 1}
    ]
  }
}' | veeqo.sh create-product
```

## Limitations

- eBay channel must be connected via Veeqo web UI (not API)
- Refunds must be processed directly on eBay
- Products created via eBay's Inventory API may break Veeqo stock sync
- `min_reorder_level` triggers the `stock_running_low` flag but doesn't auto-reorder
- Do NOT modify products/orders from other channels (Etsy, Amazon, Shopify)
