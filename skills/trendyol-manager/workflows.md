---
description: "Step-by-step workflows for common Trendyol operations"
---

# Trendyol Workflows

## Create New Product

1. Find category and required attributes:
   ```bash
   trendyol.sh categories
   trendyol.sh category-attributes <category_id>
   ```

2. Find brand ID:
   ```bash
   trendyol.sh brands --name "BrandName"
   ```

3. Create product:
   ```bash
   echo '{"items":[{
     "barcode": "BC-UNIQUE-123",
     "title": "Product Title",
     "productMainId": "GROUP-001",
     "brandId": 1234,
     "categoryId": 5678,
     "quantity": 50,
     "stockCode": "SKU-001",
     "description": "Full product description...",
     "currencyType": "TRY",
     "listPrice": 199.99,
     "salePrice": 149.99,
     "vatRate": 10,
     "cargoCompanyId": 17,
     "images": [{"url": "https://image-url.jpg"}],
     "attributes": [{"attributeId": 338, "attributeValueId": 4567}]
   }]}' | trendyol.sh create-product
   ```

4. Check batch status (async):
   ```bash
   trendyol.sh batch-status <BATCH_ID>
   ```

## Bulk Stock & Price Update

1. Get current products:
   ```bash
   trendyol.sh products --onSale true
   ```

2. Update (max 1000 per batch):
   ```bash
   echo '{"items":[
     {"barcode":"BC1","quantity":100,"salePrice":149.99,"listPrice":199.99},
     {"barcode":"BC2","quantity":50,"salePrice":89.99,"listPrice":119.99}
   ]}' | trendyol.sh update-stock-price
   ```

## Process Shipment

1. Check new orders:
   ```bash
   trendyol.sh orders --status Created
   ```

2. Update tracking:
   ```bash
   echo '{"shipmentPackageId":123,"trackingNumber":"TRACK123","cargoCompany":17}' | trendyol.sh update-tracking
   ```

3. Send invoice:
   ```bash
   echo '{"shipmentPackageId":123,"invoiceLink":"https://...","invoiceNumber":"INV-001","invoiceDateTime":1708100000000}' | trendyol.sh send-invoice
   ```

4. Get shipping label:
   ```bash
   trendyol.sh shipping-label TRACK123
   ```

## Handle Returns & Claims

1. Check recent claims:
   ```bash
   trendyol.sh claims --days 7
   ```

2. Approve claim:
   ```bash
   echo '{"claimId":"CLAIM123","claimLineItemIdList":["LINE1"]}' | trendyol.sh approve-claim
   ```

## Answer Customer Questions

1. Get unanswered questions:
   ```bash
   trendyol.sh questions --status WAITING_FOR_ANSWER
   ```

2. Answer:
   ```bash
   echo '{"questionId":12345,"text":"Thank you for your question. Yes, this product..."}' | trendyol.sh answer-question
   ```

## Financial Review

```bash
trendyol.sh settlements --days 30
trendyol.sh addresses
```
