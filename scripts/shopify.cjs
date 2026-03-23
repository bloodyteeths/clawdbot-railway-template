#!/usr/bin/env node
/**
 * Shopify API helper for Clawd
 * Direct Shopify Admin API integration using private/custom app
 *
 * Setup:
 *   1. Go to Shopify Admin > Settings > Apps and sales channels > Develop apps
 *   2. Create a custom app with required scopes
 *   3. Install the app and get the Admin API access token
 *   4. Set in Railway:
 *      - SHOPIFY_STORE_URL = your-store.myshopify.com
 *      - SHOPIFY_ACCESS_TOKEN = shpat_xxxxx
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const STORE_URL = process.env.SHOPIFY_STORE_URL;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_KEY = process.env.SHOPIFY_API_KEY;
const API_SECRET = process.env.SHOPIFY_API_SECRET;
const API_VERSION = '2024-01';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function shopifyRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    if (!STORE_URL) {
      reject(new Error('SHOPIFY_STORE_URL must be set'));
      return;
    }

    // Support both access token (custom apps) and API key/secret (legacy private apps)
    const hasAccessToken = !!ACCESS_TOKEN;
    const hasApiCredentials = API_KEY && API_SECRET;

    if (!hasAccessToken && !hasApiCredentials) {
      reject(new Error('Either SHOPIFY_ACCESS_TOKEN or SHOPIFY_API_KEY + SHOPIFY_API_SECRET must be set'));
      return;
    }

    const url = new URL(`https://${STORE_URL}/admin/api/${API_VERSION}${endpoint}`);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // Use access token for custom apps, Basic Auth for legacy private apps
    if (hasAccessToken) {
      headers['X-Shopify-Access-Token'] = ACCESS_TOKEN;
    } else {
      headers['Authorization'] = 'Basic ' + Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
    }

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = body ? JSON.parse(body) : {};
          if (res.statusCode >= 400) {
            reject(new Error(`Shopify API error ${res.statusCode}: ${JSON.stringify(result)}`));
          } else {
            // Include rate limit info
            result._rateLimit = {
              limit: res.headers['x-shopify-shop-api-call-limit'],
              retryAfter: res.headers['retry-after']
            };
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

function formatCurrency(amount, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

// GraphQL request function
function shopifyGraphQL(query, variables = {}) {
  return new Promise((resolve, reject) => {
    if (!STORE_URL || !ACCESS_TOKEN) {
      reject(new Error('SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN must be set for GraphQL'));
      return;
    }

    const url = new URL(`https://${STORE_URL}/admin/api/${API_VERSION}/graphql.json`);

    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': ACCESS_TOKEN
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.errors) {
            reject(new Error(`GraphQL error: ${JSON.stringify(result.errors)}`));
          } else {
            resolve(result.data);
          }
        } catch (e) {
          reject(new Error(`Failed to parse GraphQL response: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify({ query, variables }));
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────
// Shipping Profiles (GraphQL)
// ─────────────────────────────────────────────────────────────

async function listShippingProfiles() {
  const query = `
    query {
      deliveryProfiles(first: 50) {
        edges {
          node {
            id
            name
            default
            activeMethodDefinitionsCount
            productVariantsCountV2 {
              count
            }
            profileLocationGroups {
              locationGroupZones(first: 10) {
                edges {
                  node {
                    zone {
                      id
                      name
                      countries {
                        code {
                          countryCode
                        }
                        name
                      }
                    }
                    methodDefinitions(first: 10) {
                      edges {
                        node {
                          id
                          name
                          active
                          rateProvider {
                            ... on DeliveryRateDefinition {
                              price {
                                amount
                                currencyCode
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(query);
  return data.deliveryProfiles.edges.map(edge => {
    const profile = edge.node;
    const zones = [];

    for (const group of profile.profileLocationGroups || []) {
      for (const zoneEdge of group.locationGroupZones?.edges || []) {
        const zone = zoneEdge.node.zone;
        const methods = zoneEdge.node.methodDefinitions?.edges?.map(m => ({
          id: m.node.id,
          name: m.node.name,
          active: m.node.active,
          price: m.node.rateProvider?.price
        })) || [];

        zones.push({
          id: zone.id,
          name: zone.name,
          countries: zone.countries?.map(c => c.name) || [],
          methods
        });
      }
    }

    return {
      id: profile.id,
      name: profile.name,
      isDefault: profile.default,
      methodsCount: profile.activeMethodDefinitionsCount,
      productsCount: profile.productVariantsCountV2?.count || 0,
      zones
    };
  });
}

async function createShippingProfile(name, locationGroupId = null) {
  // First get the default location if not provided
  if (!locationGroupId) {
    const locQuery = `
      query {
        locations(first: 1) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;
    const locData = await shopifyGraphQL(locQuery);
    if (!locData.locations.edges.length) {
      throw new Error('No locations found');
    }
    locationGroupId = locData.locations.edges[0].node.id;
  }

  const mutation = `
    mutation deliveryProfileCreate($profile: DeliveryProfileInput!) {
      deliveryProfileCreate(profile: $profile) {
        profile {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    profile: {
      name: name,
      locationGroupsToCreate: [{
        locations: [locationGroupId]
      }]
    }
  };

  const data = await shopifyGraphQL(mutation, variables);

  if (data.deliveryProfileCreate.userErrors?.length) {
    throw new Error(data.deliveryProfileCreate.userErrors.map(e => e.message).join(', '));
  }

  return data.deliveryProfileCreate.profile;
}

async function addShippingZone(profileId, zoneName, countryCodes, rates) {
  // Get the profile's location group first
  const profileQuery = `
    query getProfile($id: ID!) {
      deliveryProfile(id: $id) {
        id
        name
        profileLocationGroups {
          locationGroup {
            id
          }
        }
      }
    }
  `;

  const profileData = await shopifyGraphQL(profileQuery, { id: profileId });
  if (!profileData.deliveryProfile?.profileLocationGroups?.length) {
    throw new Error('Profile has no location groups');
  }

  const locationGroupId = profileData.deliveryProfile.profileLocationGroups[0].locationGroup.id;

  const mutation = `
    mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        profile {
          id
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const methodDefs = rates.map(rate => ({
    name: rate.name,
    active: true,
    rateDefinition: {
      price: {
        amount: rate.price,
        currencyCode: rate.currency || 'USD'
      }
    }
  }));

  const variables = {
    id: profileId,
    profile: {
      zonesToCreate: [{
        name: zoneName,
        countries: countryCodes.map(code => ({ code: code, includeAllProvinces: true })),
        methodDefinitionsToCreate: methodDefs
      }]
    }
  };

  const data = await shopifyGraphQL(mutation, variables);

  if (data.deliveryProfileUpdate.userErrors?.length) {
    throw new Error(data.deliveryProfileUpdate.userErrors.map(e => e.message).join(', '));
  }

  return {
    profile: data.deliveryProfileUpdate.profile,
    zone: zoneName,
    countries: countryCodes,
    rates
  };
}

async function assignProductsToProfile(profileId, productIds) {
  const mutation = `
    mutation deliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
      deliveryProfileUpdate(id: $id, profile: $profile) {
        profile {
          id
          name
          productVariantsCountV2 {
            count
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  // Convert numeric IDs to GIDs if needed
  const productGids = productIds.map(id =>
    id.toString().startsWith('gid://') ? id : `gid://shopify/Product/${id}`
  );

  const variables = {
    id: profileId,
    profile: {
      productsToAssociate: productGids
    }
  };

  const data = await shopifyGraphQL(mutation, variables);

  if (data.deliveryProfileUpdate.userErrors?.length) {
    throw new Error(data.deliveryProfileUpdate.userErrors.map(e => e.message).join(', '));
  }

  return {
    profileId,
    productsAssigned: productIds.length,
    totalProducts: data.deliveryProfileUpdate.profile.productVariantsCountV2?.count
  };
}

// ─────────────────────────────────────────────────────────────
// Shop Info
// ─────────────────────────────────────────────────────────────

async function getShopInfo() {
  const { shop } = await shopifyRequest('GET', '/shop.json');
  return {
    name: shop.name,
    email: shop.email,
    domain: shop.domain,
    myshopifyDomain: shop.myshopify_domain,
    currency: shop.currency,
    timezone: shop.iana_timezone,
    country: shop.country_name,
    plan: shop.plan_display_name,
    createdAt: shop.created_at
  };
}

// ─────────────────────────────────────────────────────────────
// Products
// ─────────────────────────────────────────────────────────────

async function listProducts(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit);
  if (options.status) params.set('status', options.status); // active, draft, archived
  if (options.collection_id) params.set('collection_id', options.collection_id);
  if (options.since_id) params.set('since_id', options.since_id);
  if (options.fields) params.set('fields', options.fields);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { products } = await shopifyRequest('GET', `/products.json${query}`);

  return products.map(p => ({
    id: p.id,
    title: p.title,
    status: p.status,
    vendor: p.vendor,
    productType: p.product_type,
    tags: p.tags,
    variants: p.variants?.length || 0,
    images: p.images?.length || 0,
    price: p.variants?.[0]?.price,
    inventory: p.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    handle: p.handle,
    url: `https://${STORE_URL}/products/${p.handle}`
  }));
}

async function getProduct(productId) {
  const { product } = await shopifyRequest('GET', `/products/${productId}.json`);
  return {
    id: product.id,
    title: product.title,
    bodyHtml: product.body_html,
    vendor: product.vendor,
    productType: product.product_type,
    status: product.status,
    tags: product.tags,
    handle: product.handle,
    variants: product.variants?.map(v => ({
      id: v.id,
      title: v.title,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      sku: v.sku,
      inventoryQuantity: v.inventory_quantity,
      weight: v.weight,
      weightUnit: v.weight_unit
    })),
    images: product.images?.map(img => ({
      id: img.id,
      src: img.src,
      alt: img.alt,
      position: img.position
    })),
    options: product.options,
    url: `https://${STORE_URL}/products/${product.handle}`
  };
}

async function createProduct(productData) {
  const { product } = await shopifyRequest('POST', '/products.json', { product: productData });
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    url: `https://${STORE_URL}/products/${product.handle}`,
    adminUrl: `https://${STORE_URL}/admin/products/${product.id}`
  };
}

async function updateProduct(productId, productData) {
  const { product } = await shopifyRequest('PUT', `/products/${productId}.json`, { product: productData });
  return {
    id: product.id,
    title: product.title,
    status: product.status,
    updatedAt: product.updated_at
  };
}

async function deleteProduct(productId) {
  await shopifyRequest('DELETE', `/products/${productId}.json`);
  return { deleted: true, productId };
}

// ─────────────────────────────────────────────────────────────
// Product Variants
// ─────────────────────────────────────────────────────────────

async function updateVariant(variantId, variantData) {
  const { variant } = await shopifyRequest('PUT', `/variants/${variantId}.json`, { variant: variantData });
  return {
    id: variant.id,
    title: variant.title,
    price: variant.price,
    sku: variant.sku,
    inventoryQuantity: variant.inventory_quantity
  };
}

// ─────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────

async function getInventoryLevels(options = {}) {
  const params = new URLSearchParams();
  if (options.inventory_item_ids) params.set('inventory_item_ids', options.inventory_item_ids);
  if (options.location_ids) params.set('location_ids', options.location_ids);
  if (options.limit) params.set('limit', options.limit);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { inventory_levels } = await shopifyRequest('GET', `/inventory_levels.json${query}`);
  return inventory_levels;
}

async function setInventoryLevel(inventoryItemId, locationId, quantity) {
  const { inventory_level } = await shopifyRequest('POST', '/inventory_levels/set.json', {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available: quantity
  });
  return inventory_level;
}

async function adjustInventory(inventoryItemId, locationId, adjustment) {
  const { inventory_level } = await shopifyRequest('POST', '/inventory_levels/adjust.json', {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available_adjustment: adjustment
  });
  return inventory_level;
}

async function getLocations() {
  const { locations } = await shopifyRequest('GET', '/locations.json');
  return locations.map(loc => ({
    id: loc.id,
    name: loc.name,
    address: `${loc.address1 || ''} ${loc.city || ''} ${loc.country || ''}`.trim(),
    active: loc.active
  }));
}

// ─────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────

async function listOrders(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit);
  if (options.status) params.set('status', options.status); // open, closed, cancelled, any
  if (options.financial_status) params.set('financial_status', options.financial_status);
  if (options.fulfillment_status) params.set('fulfillment_status', options.fulfillment_status);
  if (options.created_at_min) params.set('created_at_min', options.created_at_min);
  if (options.created_at_max) params.set('created_at_max', options.created_at_max);
  if (options.since_id) params.set('since_id', options.since_id);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { orders } = await shopifyRequest('GET', `/orders.json${query}`);

  return orders.map(o => ({
    id: o.id,
    name: o.name, // e.g., #1001
    email: o.email,
    totalPrice: formatCurrency(o.total_price, o.currency),
    subtotalPrice: formatCurrency(o.subtotal_price, o.currency),
    financialStatus: o.financial_status,
    fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
    itemCount: o.line_items?.reduce((sum, item) => sum + item.quantity, 0) || 0,
    customer: o.customer ? `${o.customer.first_name} ${o.customer.last_name}` : 'Guest',
    createdAt: formatDate(o.created_at),
    shippingAddress: o.shipping_address ?
      `${o.shipping_address.city}, ${o.shipping_address.country}` : null
  }));
}

async function getOrder(orderId) {
  const { order } = await shopifyRequest('GET', `/orders/${orderId}.json`);
  return {
    id: order.id,
    name: order.name,
    email: order.email,
    phone: order.phone,
    totalPrice: formatCurrency(order.total_price, order.currency),
    subtotalPrice: formatCurrency(order.subtotal_price, order.currency),
    totalTax: formatCurrency(order.total_tax, order.currency),
    totalDiscounts: formatCurrency(order.total_discounts, order.currency),
    financialStatus: order.financial_status,
    fulfillmentStatus: order.fulfillment_status || 'unfulfilled',
    lineItems: order.line_items?.map(item => ({
      id: item.id,
      title: item.title,
      variantTitle: item.variant_title,
      quantity: item.quantity,
      price: formatCurrency(item.price, order.currency),
      sku: item.sku
    })),
    shippingAddress: order.shipping_address,
    billingAddress: order.billing_address,
    customer: order.customer ? {
      id: order.customer.id,
      name: `${order.customer.first_name} ${order.customer.last_name}`,
      email: order.customer.email,
      ordersCount: order.customer.orders_count
    } : null,
    note: order.note,
    tags: order.tags,
    createdAt: formatDate(order.created_at),
    fulfillments: order.fulfillments?.map(f => ({
      id: f.id,
      status: f.status,
      trackingNumber: f.tracking_number,
      trackingUrl: f.tracking_url
    }))
  };
}

async function fulfillOrder(orderId, options = {}) {
  // First get fulfillment orders
  const { fulfillment_orders } = await shopifyRequest('GET', `/orders/${orderId}/fulfillment_orders.json`);

  if (!fulfillment_orders || fulfillment_orders.length === 0) {
    throw new Error('No fulfillment orders found');
  }

  const fulfillmentOrder = fulfillment_orders.find(fo => fo.status === 'open');
  if (!fulfillmentOrder) {
    throw new Error('No open fulfillment orders to fulfill');
  }

  const fulfillmentData = {
    fulfillment: {
      line_items_by_fulfillment_order: [{
        fulfillment_order_id: fulfillmentOrder.id
      }]
    }
  };

  if (options.tracking_number) {
    fulfillmentData.fulfillment.tracking_info = {
      number: options.tracking_number,
      company: options.tracking_company || '',
      url: options.tracking_url || ''
    };
  }

  if (options.notify_customer !== undefined) {
    fulfillmentData.fulfillment.notify_customer = options.notify_customer;
  }

  const { fulfillment } = await shopifyRequest('POST', '/fulfillments.json', fulfillmentData);
  return {
    id: fulfillment.id,
    orderId: orderId,
    status: fulfillment.status,
    trackingNumber: fulfillment.tracking_number,
    trackingUrl: fulfillment.tracking_url
  };
}

async function cancelOrder(orderId, options = {}) {
  const { order } = await shopifyRequest('POST', `/orders/${orderId}/cancel.json`, {
    reason: options.reason || 'other',
    email: options.notify_customer !== false,
    restock: options.restock !== false
  });
  return {
    id: order.id,
    name: order.name,
    cancelledAt: order.cancelled_at,
    cancelReason: order.cancel_reason
  };
}

// ─────────────────────────────────────────────────────────────
// Customers
// ─────────────────────────────────────────────────────────────

async function listCustomers(options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit);
  if (options.since_id) params.set('since_id', options.since_id);
  if (options.created_at_min) params.set('created_at_min', options.created_at_min);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { customers } = await shopifyRequest('GET', `/customers.json${query}`);

  return customers.map(c => ({
    id: c.id,
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    email: c.email,
    phone: c.phone,
    ordersCount: c.orders_count,
    totalSpent: formatCurrency(c.total_spent, c.currency || 'USD'),
    state: c.state,
    tags: c.tags,
    createdAt: formatDate(c.created_at)
  }));
}

async function getCustomer(customerId) {
  const { customer } = await shopifyRequest('GET', `/customers/${customerId}.json`);
  return {
    id: customer.id,
    firstName: customer.first_name,
    lastName: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    ordersCount: customer.orders_count,
    totalSpent: formatCurrency(customer.total_spent, customer.currency || 'USD'),
    state: customer.state,
    tags: customer.tags,
    note: customer.note,
    addresses: customer.addresses,
    defaultAddress: customer.default_address,
    createdAt: formatDate(customer.created_at),
    acceptsMarketing: customer.accepts_marketing
  };
}

async function searchCustomers(query) {
  const { customers } = await shopifyRequest('GET', `/customers/search.json?query=${encodeURIComponent(query)}`);
  return customers.map(c => ({
    id: c.id,
    name: `${c.first_name || ''} ${c.last_name || ''}`.trim(),
    email: c.email,
    ordersCount: c.orders_count,
    totalSpent: formatCurrency(c.total_spent, c.currency || 'USD')
  }));
}

// ─────────────────────────────────────────────────────────────
// Collections
// ─────────────────────────────────────────────────────────────

async function listCollections(type = 'custom') {
  const endpoint = type === 'smart' ? '/smart_collections.json' : '/custom_collections.json';
  const key = type === 'smart' ? 'smart_collections' : 'custom_collections';
  const result = await shopifyRequest('GET', endpoint);

  return result[key].map(c => ({
    id: c.id,
    title: c.title,
    handle: c.handle,
    type: type,
    productsCount: c.products_count,
    publishedAt: c.published_at
  }));
}

async function getCollectionProducts(collectionId, options = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { products } = await shopifyRequest('GET', `/collections/${collectionId}/products.json${query}`);

  return products.map(p => ({
    id: p.id,
    title: p.title,
    handle: p.handle,
    price: p.variants?.[0]?.price,
    image: p.images?.[0]?.src
  }));
}

// ─────────────────────────────────────────────────────────────
// Analytics / Reports
// ─────────────────────────────────────────────────────────────

async function getOrdersCount(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.financial_status) params.set('financial_status', options.financial_status);
  if (options.created_at_min) params.set('created_at_min', options.created_at_min);
  if (options.created_at_max) params.set('created_at_max', options.created_at_max);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { count } = await shopifyRequest('GET', `/orders/count.json${query}`);
  return count;
}

async function getProductsCount(options = {}) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);

  const query = params.toString() ? `?${params.toString()}` : '';
  const { count } = await shopifyRequest('GET', `/products/count.json${query}`);
  return count;
}

async function getSalesSummary(days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const { orders } = await shopifyRequest('GET', `/orders.json?status=any&created_at_min=${startDate.toISOString()}&limit=250`);

  let totalSales = 0;
  let totalOrders = 0;
  let totalItems = 0;
  const statusCounts = {};

  for (const order of orders) {
    if (order.financial_status !== 'refunded' && order.financial_status !== 'voided') {
      totalSales += parseFloat(order.total_price);
      totalOrders++;
      totalItems += order.line_items?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    }
    statusCounts[order.financial_status] = (statusCounts[order.financial_status] || 0) + 1;
  }

  return {
    period: `Last ${days} days`,
    totalSales: formatCurrency(totalSales, orders[0]?.currency || 'USD'),
    totalOrders,
    totalItems,
    averageOrderValue: totalOrders > 0 ? formatCurrency(totalSales / totalOrders, orders[0]?.currency || 'USD') : '$0.00',
    statusBreakdown: statusCounts
  };
}

// ─────────────────────────────────────────────────────────────
// Sync from Etsy
// ─────────────────────────────────────────────────────────────

async function syncFromEtsy(etsyListingId) {
  // Fetch Etsy listing via KolayXport
  const kolayxportUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';
  const kolayxportKey = process.env.KOLAYXPORT_API_KEY;

  if (!kolayxportKey) {
    throw new Error('KOLAYXPORT_API_KEY not set - cannot fetch Etsy listing');
  }

  const etsyResponse = await new Promise((resolve, reject) => {
    const url = new URL(`${kolayxportUrl}/etsy/listing/${etsyListingId}`);
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${kolayxportKey}`,
        'Accept': 'application/json'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse Etsy response: ${body}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });

  if (!etsyResponse.listing) {
    throw new Error('Etsy listing not found');
  }

  const etsy = etsyResponse.listing;

  // Convert to Shopify product format
  const shopifyProduct = {
    title: etsy.title,
    body_html: etsy.description?.replace(/\n/g, '<br>'),
    vendor: 'BelleCoutureGifts',
    product_type: etsy.taxonomy?.name || '',
    tags: etsy.tags?.join(', '),
    status: 'draft', // Create as draft for review
    variants: [{
      price: etsy.price?.amount ? (etsy.price.amount / etsy.price.divisor).toFixed(2) : '0.00',
      sku: `ETSY-${etsyListingId}`,
      inventory_management: 'shopify',
      inventory_quantity: etsy.quantity || 0
    }]
  };

  // Add images if available
  if (etsy.images && etsy.images.length > 0) {
    shopifyProduct.images = etsy.images.map((img, idx) => ({
      src: img.url_fullxfull || img.url_570xN,
      position: idx + 1
    }));
  }

  const result = await createProduct(shopifyProduct);
  return {
    ...result,
    syncedFrom: `Etsy listing ${etsyListingId}`,
    note: 'Created as draft - review before publishing'
  };
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === 'help') {
    console.log(`Shopify API Helper

Usage: shopify.sh <command> [options]

Setup (Option A - Legacy Private App):
  Set in Railway:
     - SHOPIFY_STORE_URL = your-store.myshopify.com
     - SHOPIFY_API_KEY = your API key
     - SHOPIFY_API_SECRET = your API secret/password

Setup (Option B - Custom App):
  1. Create custom app in Shopify Admin > Settings > Apps > Develop apps
  2. Configure scopes and install app
  3. Set in Railway:
     - SHOPIFY_STORE_URL = your-store.myshopify.com
     - SHOPIFY_ACCESS_TOKEN = shpat_xxxxx

Commands:
  status                     Check connection and shop info

  Products:
    products [--limit N]     List products
    product <id>             Get product details
    create-product           Create product (JSON from stdin)
    update-product <id>      Update product (JSON from stdin)
    delete-product <id>      Delete product

  Inventory:
    locations                List inventory locations
    inventory <item_ids>     Get inventory levels
    set-inventory            Set inventory (JSON from stdin)
    adjust-inventory         Adjust inventory (JSON from stdin)

  Orders:
    orders [--limit N] [--status S]  List orders
    order <id>               Get order details
    fulfill <order_id>       Fulfill order (JSON options from stdin)
    cancel <order_id>        Cancel order

  Customers:
    customers [--limit N]    List customers
    customer <id>            Get customer details
    search-customers <query> Search customers

  Collections:
    collections [--type T]   List collections (custom/smart)
    collection-products <id> Get products in collection

  Analytics:
    sales [--days N]         Sales summary (default 30 days)
    counts                   Get product/order counts

  Sync:
    sync-from-etsy <id>      Import Etsy listing to Shopify (as draft)

  Shipping (GraphQL):
    shipping-profiles                List all shipping profiles
    create-shipping-profile <name>   Create new shipping profile
    add-shipping-zone <profile_id> <zone_name> <countries> --rate "Name:Price"
                                     Add zone with rates to profile
    assign-shipping-profile <profile_id> <product_ids>
                                     Assign products to shipping profile

Examples:
  shopify.sh status
  shopify.sh products --limit 10
  shopify.sh orders --status open --limit 5
  shopify.sh sales --days 7
  echo '{"title":"Test","variants":[{"price":"10.00"}]}' | shopify.sh create-product
`);
    return;
  }

  try {
    let result;

    switch (command) {
      case 'status': {
        const shop = await getShopInfo();
        console.log('Connected to Shopify store:\n');
        console.log(`  Store: ${shop.name}`);
        console.log(`  Domain: ${shop.domain}`);
        console.log(`  Email: ${shop.email}`);
        console.log(`  Currency: ${shop.currency}`);
        console.log(`  Timezone: ${shop.timezone}`);
        console.log(`  Plan: ${shop.plan}`);
        return;
      }

      case 'products': {
        const options = {};
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--limit' && args[i+1]) options.limit = args[++i];
          if (args[i] === '--status' && args[i+1]) options.status = args[++i];
        }
        result = await listProducts(options);
        break;
      }

      case 'product': {
        if (!args[0]) throw new Error('Product ID required');
        result = await getProduct(args[0]);
        break;
      }

      case 'create-product': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const productData = JSON.parse(input);
        result = await createProduct(productData);
        break;
      }

      case 'update-product': {
        if (!args[0]) throw new Error('Product ID required');
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const productData = JSON.parse(input);
        result = await updateProduct(args[0], productData);
        break;
      }

      case 'delete-product': {
        if (!args[0]) throw new Error('Product ID required');
        result = await deleteProduct(args[0]);
        break;
      }

      case 'locations': {
        result = await getLocations();
        break;
      }

      case 'inventory': {
        if (!args[0]) throw new Error('Inventory item IDs required (comma-separated)');
        result = await getInventoryLevels({ inventory_item_ids: args[0] });
        break;
      }

      case 'set-inventory': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const { inventory_item_id, location_id, available } = JSON.parse(input);
        result = await setInventoryLevel(inventory_item_id, location_id, available);
        break;
      }

      case 'adjust-inventory': {
        let input = '';
        for await (const chunk of process.stdin) input += chunk;
        const { inventory_item_id, location_id, adjustment } = JSON.parse(input);
        result = await adjustInventory(inventory_item_id, location_id, adjustment);
        break;
      }

      case 'orders': {
        const options = {};
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--limit' && args[i+1]) options.limit = args[++i];
          if (args[i] === '--status' && args[i+1]) options.status = args[++i];
          if (args[i] === '--financial' && args[i+1]) options.financial_status = args[++i];
          if (args[i] === '--fulfillment' && args[i+1]) options.fulfillment_status = args[++i];
        }
        result = await listOrders(options);
        break;
      }

      case 'order': {
        if (!args[0]) throw new Error('Order ID required');
        result = await getOrder(args[0]);
        break;
      }

      case 'fulfill': {
        if (!args[0]) throw new Error('Order ID required');
        let input = '';
        try {
          for await (const chunk of process.stdin) input += chunk;
        } catch {}
        const options = input ? JSON.parse(input) : {};
        result = await fulfillOrder(args[0], options);
        break;
      }

      case 'cancel': {
        if (!args[0]) throw new Error('Order ID required');
        result = await cancelOrder(args[0]);
        break;
      }

      case 'customers': {
        const options = {};
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--limit' && args[i+1]) options.limit = args[++i];
        }
        result = await listCustomers(options);
        break;
      }

      case 'customer': {
        if (!args[0]) throw new Error('Customer ID required');
        result = await getCustomer(args[0]);
        break;
      }

      case 'search-customers': {
        if (!args[0]) throw new Error('Search query required');
        result = await searchCustomers(args.join(' '));
        break;
      }

      case 'collections': {
        let type = 'custom';
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--type' && args[i+1]) type = args[++i];
        }
        result = await listCollections(type);
        break;
      }

      case 'collection-products': {
        if (!args[0]) throw new Error('Collection ID required');
        result = await getCollectionProducts(args[0]);
        break;
      }

      case 'sales': {
        let days = 30;
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '--days' && args[i+1]) days = parseInt(args[++i]);
        }
        result = await getSalesSummary(days);
        break;
      }

      case 'counts': {
        const [products, orders, activeProducts] = await Promise.all([
          getProductsCount(),
          getOrdersCount(),
          getProductsCount({ status: 'active' })
        ]);
        result = {
          totalProducts: products,
          activeProducts,
          draftProducts: products - activeProducts,
          totalOrders: orders
        };
        break;
      }

      case 'sync-from-etsy': {
        if (!args[0]) throw new Error('Etsy listing ID required');
        result = await syncFromEtsy(args[0]);
        break;
      }

      case 'shipping-profiles': {
        result = await listShippingProfiles();
        break;
      }

      case 'create-shipping-profile': {
        if (!args[0]) throw new Error('Profile name required');
        result = await createShippingProfile(args[0]);
        break;
      }

      case 'add-shipping-zone': {
        // Usage: add-shipping-zone <profile_id> <zone_name> <country_codes> --rate "Name:10.00" --rate "Express:20.00"
        if (!args[0]) throw new Error('Profile ID required');
        if (!args[1]) throw new Error('Zone name required');
        if (!args[2]) throw new Error('Country codes required (comma-separated, e.g., US,CA,MX)');

        const countryCodes = args[2].split(',').map(c => c.trim().toUpperCase());
        const rates = [];

        for (let i = 3; i < args.length; i++) {
          if (args[i] === '--rate' && args[i+1]) {
            const [name, price] = args[++i].split(':');
            rates.push({ name, price: parseFloat(price), currency: 'USD' });
          }
        }

        if (rates.length === 0) {
          rates.push({ name: 'Standard Shipping', price: 0, currency: 'USD' });
        }

        result = await addShippingZone(args[0], args[1], countryCodes, rates);
        break;
      }

      case 'assign-shipping-profile': {
        // Usage: assign-shipping-profile <profile_id> <product_id1,product_id2,...>
        if (!args[0]) throw new Error('Profile ID required');
        if (!args[1]) throw new Error('Product IDs required (comma-separated)');

        const productIds = args[1].split(',').map(id => id.trim());
        result = await assignProductsToProfile(args[0], productIds);
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "shopify.sh help" for usage');
        process.exit(1);
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
