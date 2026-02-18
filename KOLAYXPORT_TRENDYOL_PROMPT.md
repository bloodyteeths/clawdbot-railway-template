# KolayXport - Trendyol API Proxy for Clawd

## Overview

KolayXport needs to expose Trendyol Seller API endpoints as a proxy so Clawd (our AI assistant) can manage the Trendyol store. This follows the same pattern as the existing `/etsy` proxy endpoint.

Clawd calls KolayXport at: `GET/POST/PUT/DELETE {KOLAYXPORT_API_URL}/trendyol?apiKey={API_KEY}&action={action}&...params`

KolayXport then makes the real call to `https://apigw.trendyol.com/integration/...` using the stored Trendyol API credentials (sellerId, apiKey, apiSecret with Basic Auth).

---

## Trendyol API Reference

**Production Base URL:** `https://apigw.trendyol.com/integration`
**Stage Base URL:** `https://stageapigw.trendyol.com/integration`
**Auth:** Basic Auth (`Authorization: Basic base64(apiKey:apiSecret)`)
**Seller ID:** Required in all URL paths as `{sellerId}`

---

## Required Endpoints to Implement

### Route: `GET/POST/PUT/DELETE /api/clawd/trendyol`

All endpoints use query parameter `action` to determine the operation.

---

### 1. PRODUCTS

#### `action=products` (GET) - List/Filter Products
Proxy to: `GET /integration/product/sellers/{sellerId}/products`

**Query params to forward:**
- `page` (default: 0)
- `size` (default: 50, max: 200)
- `approved` (true/false)
- `barcode`
- `stockCode`
- `productMainId` (group code)
- `onSale` (true/false)
- `rejected` (true/false)
- `blacklisted` (true/false)
- `brandId`

**Response shape to return:**
```json
{
  "products": [...],
  "totalElements": 500,
  "totalPages": 25,
  "page": 0,
  "size": 20
}
```

Each product should include: `barcode`, `title`, `productMainId`, `brandName`, `categoryName`, `quantity`, `salePrice`, `listPrice`, `stockCode`, `images`, `approved`, `onSale`, `rejected`, `blacklisted`, `attributes`.

#### `action=product` (GET) - Get Single Product by barcode
**Query params:** `barcode` or `stockCode`
Proxy to: `GET /integration/product/sellers/{sellerId}/products?barcode={barcode}`

Return the single product detail.

#### `action=create_products` (POST) - Create Products
Proxy to: `POST /integration/product/sellers/{sellerId}/products`

**Request body (from Clawd):**
```json
{
  "items": [
    {
      "barcode": "BARCODEVALUE",
      "title": "Product Title with Keywords",
      "productMainId": "GROUP123",
      "brandId": 1234,
      "categoryId": 5678,
      "quantity": 50,
      "stockCode": "SKU-001",
      "dimensionalWeight": 1,
      "description": "Full product description...",
      "currencyType": "TRY",
      "listPrice": 199.99,
      "salePrice": 149.99,
      "vatRate": 10,
      "cargoCompanyId": 17,
      "images": [
        {"url": "https://example.com/image1.jpg"}
      ],
      "attributes": [
        {"attributeId": 338, "attributeValueId": 4567}
      ]
    }
  ]
}
```

**Response:** Returns `batchRequestId` for tracking.

#### `action=update_product` (PUT) - Update Product
Proxy to: `PUT /integration/product/sellers/{sellerId}/products`

**Request body (from Clawd):**
```json
{
  "items": [
    {
      "barcode": "BARCODEVALUE",
      "title": "Updated Title",
      "stockCode": "SKU-001",
      "quantity": 100,
      "salePrice": 129.99,
      "listPrice": 179.99,
      "description": "Updated description..."
    }
  ]
}
```

#### `action=update_price_and_inventory` (PUT) - Bulk Stock & Price Update
Proxy to: `PUT /integration/inventory/sellers/{sellerId}/products/price-and-inventory`

**Request body:**
```json
{
  "items": [
    {
      "barcode": "BARCODE1",
      "quantity": 100,
      "salePrice": 149.99,
      "listPrice": 199.99
    },
    {
      "barcode": "BARCODE2",
      "quantity": 50,
      "salePrice": 89.99,
      "listPrice": 119.99
    }
  ]
}
```

**Limits:** Max 1000 items per request.

#### `action=batch_status` (GET) - Check Batch Request Status
**Query params:** `batchRequestId`
Proxy to: `GET /integration/product/sellers/{sellerId}/products/batch-requests/{batchRequestId}`

Returns processing status and any errors for product create/update batches.

#### `action=archive_product` (PUT) - Archive/Unarchive Product
Proxy to: `PUT /integration/product/sellers/{sellerId}/products/archive`

**Request body:**
```json
{
  "items": [
    {"barcode": "BARCODE1"}
  ]
}
```

---

### 2. CATEGORIES & ATTRIBUTES

#### `action=categories` (GET) - List All Categories
Proxy to: `GET /integration/product/product-categories`

Return the full category tree.

#### `action=category_attributes` (GET) - Get Category Attributes
**Query params:** `categoryId`
Proxy to: `GET /integration/product/product-categories/{categoryId}/attributes`

Returns required and optional attributes for the category.

---

### 3. BRANDS

#### `action=brands` (GET) - Search Brands
**Query params:** `name` (search term), `page`, `size`
Proxy to: `GET /integration/product/brands?name={name}`

---

### 4. ORDERS

#### `action=orders` (GET) - List Orders
Proxy to: `GET /integration/order/sellers/{sellerId}/orders`

**Query params to forward:**
- `status` (Created, Picking, Invoiced, Shipped, Delivered, Cancelled, UnDelivered, Returned, Repack, UnSupplied)
- `startDate` (epoch ms)
- `endDate` (epoch ms)
- `page` (default: 0)
- `size` (default: 50)
- `orderNumber`
- `orderByField` (PackageLastModifiedDate, CreatedDate)
- `orderByDirection` (ASC, DESC)

**Response shape:**
```json
{
  "orders": [...],
  "totalElements": 150,
  "totalPages": 3,
  "page": 0,
  "size": 50
}
```

Each order should include: `shipmentPackageId`, `orderNumber`, `orderDate`, `status`, `customerFirstName`, `customerLastName`, `lines` (with productName, quantity, amount, stockCode, barcode), `shipmentAddress`, `cargoTrackingNumber`, `cargoProviderName`.

#### `action=order` (GET) - Get Single Order
**Query params:** `orderNumber` or `shipmentPackageId`
Proxy to same endpoint with `orderNumber` filter.

---

### 5. SHIPMENT

#### `action=update_tracking` (PUT) - Update Cargo Tracking
Proxy to: `PUT /integration/order/sellers/{sellerId}/shipment-packages/{shipmentPackageId}`

**Request body:**
```json
{
  "shipmentPackageId": 123456789,
  "trackingNumber": "TRACKING123",
  "cargoCompany": 17
}
```

**Note:** Map cargo company names to IDs:
| ID | Company |
|----|---------|
| 4 | MNG Kargo |
| 7 | Yurtici Kargo |
| 10 | UPS |
| 14 | PTT Kargo |
| 17 | Aras Kargo |
| 19 | Surat Kargo |

#### `action=update_order_status` (PUT) - Mark as Picking/Invoiced
**Request body:**
```json
{
  "lines": [{"lineId": 123, "quantity": 1}],
  "status": "Picking"
}
```

#### `action=split_package` (POST) - Split Shipment Package
Proxy to: `POST /integration/order/sellers/{sellerId}/shipment-packages/{shipmentPackageId}/split`

#### `action=shipping_label` (GET) - Get Shipping Label
**Query params:** `trackingNumber`
Proxy to: `GET /integration/order/sellers/{sellerId}/common-label/query?id={trackingNumber}`

Returns label PDF/image data.

---

### 6. INVOICE

#### `action=send_invoice` (POST) - Send Invoice Link
Proxy to: `POST /integration/order/sellers/{sellerId}/invoice-links`

**Request body:**
```json
{
  "shipmentPackageId": 123456789,
  "invoiceLink": "https://example.com/invoice.pdf",
  "invoiceNumber": "INV-2026-001",
  "invoiceDateTime": 1708100000000
}
```

#### `action=delete_invoice` (DELETE) - Delete Invoice Link
**Query params:** `invoiceLinkId`
Proxy to: `DELETE /integration/order/sellers/{sellerId}/invoice-links/{invoiceLinkId}`

---

### 7. RETURNS / CLAIMS

#### `action=claims` (GET) - Get Returned Orders
Proxy to: `GET /integration/order/sellers/{sellerId}/claims`

**Query params:** `status`, `startDate`, `endDate`, `page`, `size`

#### `action=approve_claim` (PUT) - Approve Return
Proxy to: `PUT /integration/order/sellers/{sellerId}/claims/{claimId}/approve`

**Request body:**
```json
{
  "claimId": "CLAIM123",
  "claimLineItemIdList": ["LINE1", "LINE2"]
}
```

---

### 8. CUSTOMER Q&A

#### `action=questions` (GET) - Get Customer Questions
Proxy to: `GET /integration/sellers/{sellerId}/questions/filter`

**Query params:** `status` (WAITING_FOR_ANSWER, ANSWERED), `page`, `size`, `startDate`, `endDate`

#### `action=answer_question` (POST) - Answer Customer Question
Proxy to: `POST /integration/sellers/{sellerId}/questions/{questionId}/answers`

**Request body:**
```json
{
  "questionId": 12345,
  "text": "Thank you for your question! Yes, this product..."
}
```

---

### 9. SETTLEMENT / FINANCE

#### `action=settlements` (GET) - Get Account Statements
Proxy to: `GET /integration/finance/sellers/{sellerId}/settlements`

**Query params:** `startDate`, `endDate`, `page`, `size`, `transactionType`

---

### 10. SUPPLIER INFO

#### `action=addresses` (GET) - Get Seller Addresses
Proxy to: `GET /integration/sellers/{sellerId}/addresses`

Returns warehouse and return addresses.

#### `action=cargo_companies` (GET) - List Cargo Companies
Proxy to: `GET /integration/shipment/cargo-companies`

---

## Implementation Notes

1. **Auth header:** All Trendyol API calls need `Authorization: Basic base64(apiKey:apiSecret)` header
2. **User-Agent:** Trendyol requires `User-Agent: {sellerId} - SelfIntegration` header
3. **Content-Type:** `application/json` for all POST/PUT requests
4. **Batch operations:** Product create/update returns `batchRequestId` - client polls `batch_status` for result
5. **Rate limits:** Based on seller tier (50k-Unlimited listings)
6. **Error handling:** Return Trendyol error responses as-is so Clawd can interpret them
7. **Date format:** Trendyol uses epoch milliseconds for dates

## Trendyol Credentials Storage

Store in KolayXport's config/env:
- `TRENDYOL_SELLER_ID` - From Trendyol seller panel > Account > Integration
- `TRENDYOL_API_KEY` - From same location
- `TRENDYOL_API_SECRET` - From same location
