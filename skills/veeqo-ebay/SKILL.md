---
description: "eBay management via Veeqo — products, inventory, orders, shipping, stock alerts"
activation: "veeqo, ebay, stock, inventory, low stock, warehouse, reorder, out of stock"
---

# Veeqo / eBay Manager

Manage eBay listings, inventory, orders, and shipping through the Veeqo API. Veeqo syncs with eBay automatically — changes to products and stock in Veeqo push to eBay.

**Script:** `/app/scripts/veeqo.sh`
**API:** https://api.veeqo.com
**Auth:** `VEEQO_API_KEY` env var (x-api-key header)
**Rate limit:** 5 req/sec

## Quick Reference

| Task | Command |
|------|---------|
| List products | `veeqo.sh products` |
| Search products | `veeqo.sh products --query "gift box"` |
| Product details | `veeqo.sh product <id>` |
| Low stock alert | `veeqo.sh low-stock` |
| Check stock | `veeqo.sh stock <sellable_id> <warehouse_id>` |
| Set stock level | `veeqo.sh set-stock <sellable_id> <warehouse_id> <level>` |
| List orders | `veeqo.sh orders` |
| Unfulfilled orders | `veeqo.sh orders --status awaiting_fulfillment` |
| Order details | `veeqo.sh order <id>` |
| Fulfill order | `echo '{"tracking_number":"..."}' \| veeqo.sh fulfill <order_id>` |
| Connected channels | `veeqo.sh channels` |
| Warehouses | `veeqo.sh warehouses` |

## eBay Sync Behavior

| What | Sync direction | Frequency |
|------|---------------|-----------|
| New orders | eBay → Veeqo | Every 10 min |
| New listings | eBay → Veeqo | Every 60 min |
| Listing updates | eBay → Veeqo | Every 60 min |
| Stock changes | Veeqo → eBay | Immediate |
| Price changes | Veeqo → eBay | Immediate (if price master) |
| Fulfillment/tracking | Veeqo → eBay | On shipment creation |
| Refunds | NOT synced | Must process on eBay directly |

## Key Concepts

- **Product** = the main item (has title, description, images)
- **Sellable** = a variant/SKU within a product (has price, weight, stock)
- **Sellable ID** = needed for stock operations (not the product ID)
- **Warehouse ID** = stock is tracked per-warehouse. Get IDs via `veeqo.sh warehouses`
- **Allocation** = assigns order items to a warehouse for fulfillment
- **Channel** = a connected store (eBay, Shopify, etc.)

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
# 1. Find unfulfilled orders
veeqo.sh orders --status awaiting_fulfillment

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
