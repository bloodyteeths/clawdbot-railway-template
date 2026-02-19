---
description: "Trendyol marketplace management for Sara Tasarim — products, orders, shipments, Q&A, finance"
activation: "trendyol, sara tasarim, barcode, cargo, trendyol order, trendyol product"
tools: ["/app/scripts/trendyol.sh"]
---

# Trendyol Manager — Sara Tasarim

Manage the Sara Tasarim Trendyol shop. All API calls go through KolayXport proxy via `trendyol.sh`.

**NEVER call Trendyol API directly.** Always use `/app/scripts/trendyol.sh`.

## Quick Reference

| Action | Command |
|--------|---------|
| List products | `trendyol.sh products` |
| Filter products | `trendyol.sh products --approved true --onSale true` |
| Get product | `trendyol.sh product <barcode>` |
| List orders | `trendyol.sh orders` |
| Filter orders | `trendyol.sh orders --status Created --days 7` |
| Get order | `trendyol.sh order <id>` |
| Check claims | `trendyol.sh claims --days 7` |
| Unanswered Q&A | `trendyol.sh questions --status WAITING_FOR_ANSWER` |
| Settlements | `trendyol.sh settlements --days 30` |

## Workflows

For multi-step operations, see [[workflows]] for:
- Creating a new product
- Updating stock and prices in bulk
- Processing shipments
- Handling returns and claims
- Answering customer questions

## Product Management

```bash
# Create product (async — check batch status after)
echo '{"items":[{
  "barcode":"BC123", "title":"Title",
  "productMainId":"GRP-001", "brandId":1234, "categoryId":5678,
  "quantity":50, "stockCode":"SKU-001",
  "description":"...", "currencyType":"TRY",
  "listPrice":199.99, "salePrice":149.99, "vatRate":10,
  "cargoCompanyId":17,
  "images":[{"url":"https://..."}],
  "attributes":[{"attributeId":338,"attributeValueId":4567}]
}]}' | trendyol.sh create-product

# Check batch result
trendyol.sh batch-status <BATCH_ID>

# Update stock & price (max 1000 items per batch)
echo '{"items":[{"barcode":"BC1","quantity":100,"salePrice":149.99,"listPrice":199.99}]}' | trendyol.sh update-stock-price

# Archive product
trendyol.sh archive <BARCODE>
```

## Categories & Brands

```bash
trendyol.sh categories
trendyol.sh category-attributes <category_id>
trendyol.sh brands --name "Belle"
```

## Shipment & Invoicing

```bash
echo '{"shipmentPackageId":123,"trackingNumber":"TRACK123","cargoCompany":17}' | trendyol.sh update-tracking
trendyol.sh shipping-label <TRACKING>
trendyol.sh cargo-companies
echo '{"shipmentPackageId":123,"invoiceLink":"https://...","invoiceNumber":"INV-001","invoiceDateTime":1708100000000}' | trendyol.sh send-invoice
```

**Cargo Companies:** 4=MNG, 7=Yurtici, 10=UPS, 14=PTT, 17=Aras, 19=Surat

## Order Statuses

Created, Picking, Invoiced, Shipped, Delivered, Cancelled, UnDelivered, Returned, UnSupplied

## Limitations

- Product create/update are async — always check batch-status
- Max 1000 items per stock/price update batch
- Trendyol API uses epoch milliseconds for dates
- Ads and analytics NOT available via API
