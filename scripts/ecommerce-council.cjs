#!/usr/bin/env node
/**
 * Clawd E-Commerce Council - Daily Briefing Generator
 *
 * Collects data from Etsy (BelleCoutureGifts) and Trendyol (Sara Tasarim),
 * analyzes performance, and generates a structured daily report suitable
 * for WhatsApp delivery.
 *
 * Data sources:
 *   - Etsy orders & listings via KolayXport API
 *   - Trendyol orders, products & claims via KolayXport API
 *
 * Output:
 *   - Structured text report to stdout
 *   - JSONL snapshot to /data/workspace/logs/ecommerce-council.jsonl
 *   - Start/end events to /data/workspace/logs/cron-log.jsonl
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COUNCIL_LOG = '/data/workspace/logs/ecommerce-council.jsonl';
const CRON_LOG    = '/data/workspace/logs/cron-log.jsonl';
const SCRIPT_NAME = 'ecommerce-council';

const API_URL = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';
const API_KEY = process.env.KOLAYXPORT_API_KEY || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function appendJsonl(filePath, obj) {
  ensureDir(filePath);
  fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

function cronLog(event, details = {}) {
  appendJsonl(CRON_LOG, {
    timestamp: new Date().toISOString(),
    script: SCRIPT_NAME,
    event,
    ...details,
  });
}

function readHistoricalSnapshots(maxDays = 7) {
  if (!fs.existsSync(COUNCIL_LOG)) return [];
  try {
    const lines = fs.readFileSync(COUNCIL_LOG, 'utf8').trim().split('\n').filter(Boolean);
    const cutoff = Date.now() - maxDays * 86400 * 1000;
    return lines
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(obj => obj && new Date(obj.timestamp).getTime() > cutoff);
  } catch {
    return [];
  }
}

/** Fetch JSON from KolayXport API */
async function api(endpoint, params = {}) {
  const qs = new URLSearchParams({ apiKey: API_KEY, ...params }).toString();
  const url = `${API_URL}/${endpoint}?${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  return res.json();
}

function formatDateLong(d) {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function truncate(str, len = 40) {
  if (!str) return 'N/A';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

/**
 * Normalize a date value to a Date object.
 * Handles: ISO strings, epoch seconds (Etsy), and epoch milliseconds (Trendyol).
 */
function toDate(dateVal) {
  if (!dateVal) return new Date(0);
  if (typeof dateVal === 'string') return new Date(dateVal);
  // If the number is small enough to be seconds (before year ~2100 in seconds),
  // convert to ms. Epoch ms values are > 1e12.
  if (typeof dateVal === 'number') {
    return dateVal < 1e12 ? new Date(dateVal * 1000) : new Date(dateVal);
  }
  return new Date(dateVal);
}

function isToday(dateVal) {
  const d = toDate(dateVal);
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

function daysAgo(dateVal) {
  return (Date.now() - toDate(dateVal).getTime()) / (86400 * 1000);
}

// ---------------------------------------------------------------------------
// Data Collection
// ---------------------------------------------------------------------------

async function fetchEtsyOrders() {
  try {
    const data = await api('etsy', { action: 'receipts', limit: '50' });
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.error('[Etsy Orders] Error:', e.message);
    return null;
  }
}

async function fetchEtsyListings() {
  try {
    const data = await api('etsy', { action: 'listings', limit: '50' });
    if (data && data.listings) return data;
    return { count: 0, listings: [] };
  } catch (e) {
    console.error('[Etsy Listings] Error:', e.message);
    return null;
  }
}

async function fetchTrendyolOrders() {
  try {
    // Fetch orders from the last 7 days
    const startDate = String((Date.now() - 7 * 86400 * 1000));
    const data = await api('trendyol', { action: 'orders', size: '50', startDate });
    if (data && data.content) return data;
    return { content: [], totalElements: 0 };
  } catch (e) {
    console.error('[Trendyol Orders] Error:', e.message);
    return null;
  }
}

async function fetchTrendyolProducts() {
  try {
    const data = await api('trendyol', { action: 'products', size: '50' });
    if (data && data.content) return data;
    return { content: [], totalElements: 0 };
  } catch (e) {
    console.error('[Trendyol Products] Error:', e.message);
    return null;
  }
}

async function fetchTrendyolClaims() {
  try {
    const startDate = String((Date.now() - 7 * 86400 * 1000));
    const data = await api('trendyol', { action: 'claims', startDate });
    if (data && (data.content || data.claims)) return data;
    return { content: [], totalElements: 0 };
  } catch (e) {
    console.error('[Trendyol Claims] Error:', e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeEtsyOrders(orders) {
  if (!orders || orders.length === 0) {
    return { todayOrders: [], todayRevenue: 0, todayCount: 0, weekOrders: [], weekRevenue: 0, weekCount: 0, avgDaily: 0 };
  }

  const todayOrders = orders.filter(o => isToday(o.order_date));
  const weekOrders = orders.filter(o => daysAgo(o.order_date) <= 7);

  const calcRevenue = (list) =>
    list.reduce((sum, o) => {
      const amount = o.total_price?.amount || 0;
      const divisor = o.total_price?.divisor || 100;
      return sum + (amount / divisor);
    }, 0);

  const todayRevenue = calcRevenue(todayOrders);
  const weekRevenue = calcRevenue(weekOrders);
  const avgDaily = weekOrders.length > 0 ? weekRevenue / 7 : 0;

  return {
    todayOrders,
    todayRevenue,
    todayCount: todayOrders.length,
    weekOrders,
    weekRevenue,
    weekCount: weekOrders.length,
    avgDaily,
  };
}

function analyzeEtsyListings(listingsData) {
  if (!listingsData || !listingsData.listings || listingsData.listings.length === 0) {
    return { total: 0, topByViews: [], topByFavorites: [], zeroViews: [], avgViews: 0 };
  }

  const listings = listingsData.listings;
  const sorted = [...listings].sort((a, b) => (b.views || 0) - (a.views || 0));
  const sortedByFavs = [...listings].sort((a, b) => (b.num_favorers || 0) - (a.num_favorers || 0));

  const zeroViews = listings.filter(l => (l.views || 0) === 0);
  const totalViews = listings.reduce((s, l) => s + (l.views || 0), 0);
  const avgViews = listings.length > 0 ? totalViews / listings.length : 0;

  return {
    total: listingsData.count || listings.length,
    topByViews: sorted.slice(0, 5),
    topByFavorites: sortedByFavs.slice(0, 3),
    zeroViews,
    avgViews,
  };
}

function analyzeTrendyolOrders(ordersData) {
  if (!ordersData || !ordersData.content || ordersData.content.length === 0) {
    return { todayOrders: [], todayRevenue: 0, todayCount: 0, weekOrders: [], weekRevenue: 0, weekCount: 0, pendingShipment: [], cancelled: [] };
  }

  const orders = ordersData.content;

  const todayOrders = orders.filter(o => {
    if (!o.orderDate) return false;
    return isToday(o.orderDate);
  });

  const weekOrders = orders.filter(o => {
    if (!o.orderDate) return false;
    return daysAgo(o.orderDate) <= 7;
  });

  const calcRevenue = (list) =>
    list.reduce((sum, o) => {
      const lineTotal = (o.lines || []).reduce((s, l) => s + (l.amount || 0), 0);
      return sum + lineTotal;
    }, 0);

  const pendingShipment = orders.filter(o =>
    o.status === 'Created' || o.status === 'Picking'
  );

  const cancelled = orders.filter(o =>
    o.status === 'Cancelled' || o.status === 'UnSupplied'
  );

  return {
    todayOrders,
    todayRevenue: calcRevenue(todayOrders),
    todayCount: todayOrders.length,
    weekOrders,
    weekRevenue: calcRevenue(weekOrders),
    weekCount: weekOrders.length,
    pendingShipment,
    cancelled,
  };
}

function analyzeTrendyolProducts(productsData) {
  if (!productsData || !productsData.content || productsData.content.length === 0) {
    return { total: 0, onSale: 0, outOfStock: [], rejected: [] };
  }

  const products = productsData.content;
  const onSale = products.filter(p => p.onSale);
  const outOfStock = products.filter(p => (p.quantity || 0) === 0 && p.onSale);
  const rejected = products.filter(p => p.rejected);

  return {
    total: productsData.totalElements || products.length,
    onSale: onSale.length,
    outOfStock,
    rejected,
  };
}

function analyzeTrendyolClaims(claimsData) {
  if (!claimsData) return { total: 0, claims: [] };
  const claims = claimsData.content || claimsData.claims || [];
  return {
    total: claimsData.totalElements || claims.length,
    claims,
  };
}

// ---------------------------------------------------------------------------
// Action Items Generator
// ---------------------------------------------------------------------------

function generateActionItems(etsyOrderStats, etsyListingStats, tyOrderStats, tyProductStats, tyClaimStats) {
  const actions = [];

  // Trendyol shipments
  if (tyOrderStats.pendingShipment.length > 0) {
    actions.push(`Ship ${tyOrderStats.pendingShipment.length} pending Trendyol order${tyOrderStats.pendingShipment.length > 1 ? 's' : ''} to maintain seller rating`);
  }

  // Trendyol cancellations
  if (tyOrderStats.cancelled.length > 0) {
    actions.push(`Review ${tyOrderStats.cancelled.length} cancelled/unsupplied Trendyol order${tyOrderStats.cancelled.length > 1 ? 's' : ''}`);
  }

  // Trendyol returns
  if (tyClaimStats.total > 0) {
    actions.push(`Handle ${tyClaimStats.total} Trendyol return claim${tyClaimStats.total > 1 ? 's' : ''}`);
  }

  // Trendyol out of stock
  if (tyProductStats.outOfStock.length > 0) {
    actions.push(`Restock ${tyProductStats.outOfStock.length} out-of-stock Trendyol product${tyProductStats.outOfStock.length > 1 ? 's' : ''} (still listed as on sale)`);
  }

  // Trendyol rejected
  if (tyProductStats.rejected.length > 0) {
    actions.push(`Fix ${tyProductStats.rejected.length} rejected Trendyol product${tyProductStats.rejected.length > 1 ? 's' : ''}`);
  }

  // Etsy zero-view listings
  if (etsyListingStats.zeroViews.length > 3) {
    actions.push(`Optimize ${etsyListingStats.zeroViews.length} Etsy listings with 0 views (update titles, tags, photos)`);
  }

  // Low Etsy sales
  if (etsyOrderStats.todayCount === 0 && etsyOrderStats.weekCount < 3) {
    actions.push('Etsy sales are slow - consider running a sale or refreshing top listings');
  }

  // Good momentum
  if (etsyOrderStats.todayCount >= 3) {
    actions.push('Etsy is hot today! Consider boosting Etsy Ads budget to capitalize');
  }

  // Trendyol good momentum
  if (tyOrderStats.todayCount >= 5) {
    actions.push('Trendyol orders are strong today - ensure fast fulfillment');
  }

  // If nothing urgent, add a proactive item
  if (actions.length === 0) {
    actions.push('All clear! Good time to optimize listing photos or add new products');
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Trend Comparison (vs historical)
// ---------------------------------------------------------------------------

function compareTrend(current, history) {
  if (!history || history.length === 0) return null;

  const pastEtsyRevenues = history
    .map(h => h.data?.etsy?.orders?.todayRevenue)
    .filter(v => typeof v === 'number');
  const pastTyRevenues = history
    .map(h => h.data?.trendyol?.orders?.todayRevenue)
    .filter(v => typeof v === 'number');

  const avgEtsy = pastEtsyRevenues.length > 0
    ? pastEtsyRevenues.reduce((a, b) => a + b, 0) / pastEtsyRevenues.length
    : null;
  const avgTy = pastTyRevenues.length > 0
    ? pastTyRevenues.reduce((a, b) => a + b, 0) / pastTyRevenues.length
    : null;

  return { avgEtsy, avgTy, daysOfData: history.length };
}

// ---------------------------------------------------------------------------
// Report Formatter
// ---------------------------------------------------------------------------

function buildReport(etsyOrderStats, etsyListingStats, tyOrderStats, tyProductStats, tyClaimStats, actions, trend, etsyAvailable, tyAvailable) {
  const now = new Date();
  const dateStr = formatDateLong(now);

  let r = '';
  r += `\u{1F4CA} DAILY E-COMMERCE BRIEF \u{2014} ${dateStr}\n\n`;

  // ---- Revenue section ----
  r += `\u{1F4B0} REVENUE\n`;
  if (etsyAvailable) {
    r += `\u{2022} Etsy: $${etsyOrderStats.todayRevenue.toFixed(2)} (${etsyOrderStats.todayCount} order${etsyOrderStats.todayCount !== 1 ? 's' : ''} today)\n`;
    r += `  7-day: $${etsyOrderStats.weekRevenue.toFixed(2)} (${etsyOrderStats.weekCount} orders, avg $${etsyOrderStats.avgDaily.toFixed(2)}/day)\n`;
  } else {
    r += `\u{2022} Etsy: \u{26A0}\u{FE0F} Data unavailable\n`;
  }
  if (tyAvailable) {
    r += `\u{2022} Trendyol: \u{20BA}${tyOrderStats.todayRevenue.toFixed(2)} (${tyOrderStats.todayCount} order${tyOrderStats.todayCount !== 1 ? 's' : ''} today)\n`;
    r += `  7-day: \u{20BA}${tyOrderStats.weekRevenue.toFixed(2)} (${tyOrderStats.weekCount} orders)\n`;
  } else {
    r += `\u{2022} Trendyol: \u{26A0}\u{FE0F} Data unavailable\n`;
  }

  // Trend comparison
  if (trend && (trend.avgEtsy !== null || trend.avgTy !== null)) {
    r += `\n\u{1F4C9} TREND (vs ${trend.daysOfData}-day avg)\n`;
    if (trend.avgEtsy !== null && etsyAvailable) {
      const diff = etsyOrderStats.todayRevenue - trend.avgEtsy;
      const arrow = diff >= 0 ? '\u{2B06}\u{FE0F}' : '\u{2B07}\u{FE0F}';
      r += `\u{2022} Etsy: ${arrow} $${Math.abs(diff).toFixed(2)} ${diff >= 0 ? 'above' : 'below'} avg ($${trend.avgEtsy.toFixed(2)}/day)\n`;
    }
    if (trend.avgTy !== null && tyAvailable) {
      const diff = tyOrderStats.todayRevenue - trend.avgTy;
      const arrow = diff >= 0 ? '\u{2B06}\u{FE0F}' : '\u{2B07}\u{FE0F}';
      r += `\u{2022} Trendyol: ${arrow} \u{20BA}${Math.abs(diff).toFixed(2)} ${diff >= 0 ? 'above' : 'below'} avg (\u{20BA}${trend.avgTy.toFixed(2)}/day)\n`;
    }
  }

  // ---- Winners section (Etsy listings by views) ----
  if (etsyAvailable && etsyListingStats.topByViews.length > 0) {
    r += `\n\u{1F4C8} WINNERS (Top by views)\n`;
    etsyListingStats.topByViews.slice(0, 3).forEach(l => {
      r += `\u{2022} ${truncate(l.title, 45)} \u{2014} ${l.views || 0} views, ${l.num_favorers || 0} favs\n`;
    });
  }

  // ---- Trendyol product stats ----
  if (tyAvailable) {
    r += `\n\u{1F6CD}\u{FE0F} TRENDYOL STORE\n`;
    r += `\u{2022} ${tyProductStats.total} products total, ${tyProductStats.onSale} on sale\n`;
    if (tyProductStats.outOfStock.length > 0) {
      r += `\u{2022} \u{26A0}\u{FE0F} ${tyProductStats.outOfStock.length} on-sale products with 0 stock\n`;
    }
    if (tyProductStats.rejected.length > 0) {
      r += `\u{2022} \u{274C} ${tyProductStats.rejected.length} rejected products\n`;
    }
  }

  // ---- Needs Attention section ----
  const attentionItems = [];
  if (etsyAvailable && etsyListingStats.zeroViews.length > 0) {
    attentionItems.push(`${etsyListingStats.zeroViews.length} Etsy listing${etsyListingStats.zeroViews.length !== 1 ? 's' : ''} with 0 views`);
  }
  if (tyAvailable && tyOrderStats.pendingShipment.length > 0) {
    attentionItems.push(`${tyOrderStats.pendingShipment.length} Trendyol order${tyOrderStats.pendingShipment.length !== 1 ? 's' : ''} pending shipment`);
  }
  if (tyAvailable && tyClaimStats.total > 0) {
    attentionItems.push(`${tyClaimStats.total} Trendyol return/claim${tyClaimStats.total !== 1 ? 's' : ''}`);
  }
  if (tyAvailable && tyOrderStats.cancelled.length > 0) {
    attentionItems.push(`${tyOrderStats.cancelled.length} cancelled/unsupplied Trendyol order${tyOrderStats.cancelled.length !== 1 ? 's' : ''}`);
  }

  if (attentionItems.length > 0) {
    r += `\n\u{26A0}\u{FE0F} NEEDS ATTENTION\n`;
    attentionItems.forEach(item => {
      r += `\u{2022} ${item}\n`;
    });
  }

  // ---- Pending shipment details ----
  if (tyAvailable && tyOrderStats.pendingShipment.length > 0) {
    r += `\n\u{1F4E6} PENDING SHIPMENTS\n`;
    tyOrderStats.pendingShipment.slice(0, 5).forEach(o => {
      const date = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
      const customer = `${o.customerFirstName || ''} ${o.customerLastName || ''}`.trim() || 'N/A';
      const lineTotal = (o.lines || []).reduce((s, l) => s + (l.amount || 0), 0);
      r += `\u{2022} #${o.orderNumber} \u{2014} ${customer} \u{2014} \u{20BA}${lineTotal.toFixed(2)} (${date})\n`;
    });
    if (tyOrderStats.pendingShipment.length > 5) {
      r += `  ... and ${tyOrderStats.pendingShipment.length - 5} more\n`;
    }
  }

  // ---- Action items ----
  r += `\n\u{1F4CB} ACTION ITEMS\n`;
  actions.forEach((action, i) => {
    r += `${i + 1}. ${action}\n`;
  });

  return r;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  cronLog('start');
  console.error(`[${SCRIPT_NAME}] Starting at ${new Date().toISOString()}`);

  if (!API_KEY) {
    const msg = 'KOLAYXPORT_API_KEY not set. Cannot fetch e-commerce data.';
    console.error(`[${SCRIPT_NAME}] ${msg}`);
    cronLog('error', { error: msg });
    process.exit(1);
  }

  // ------ Collect data in parallel ------

  console.error(`[${SCRIPT_NAME}] Fetching data from APIs...`);

  const [etsyOrders, etsyListings, tyOrders, tyProducts, tyClaims] = await Promise.all([
    fetchEtsyOrders(),
    fetchEtsyListings(),
    fetchTrendyolOrders(),
    fetchTrendyolProducts(),
    fetchTrendyolClaims(),
  ]);

  const etsyAvailable = etsyOrders !== null && etsyListings !== null;
  const tyAvailable = tyOrders !== null && tyProducts !== null;

  if (!etsyAvailable && !tyAvailable) {
    const msg = 'Both Etsy and Trendyol APIs failed. No data to report.';
    console.error(`[${SCRIPT_NAME}] ${msg}`);
    cronLog('error', { error: msg });
    // Still output something useful
    console.log(`\u{1F4CA} DAILY E-COMMERCE BRIEF \u{2014} ${formatDateLong(new Date())}\n\n\u{26A0}\u{FE0F} Both Etsy and Trendyol APIs are unreachable. Please check KolayXport status.`);
    process.exit(1);
  }

  // ------ Analyze ------

  console.error(`[${SCRIPT_NAME}] Analyzing data...`);

  const etsyOrderStats = analyzeEtsyOrders(etsyOrders || []);
  const etsyListingStats = analyzeEtsyListings(etsyListings);
  const tyOrderStats = analyzeTrendyolOrders(tyOrders);
  const tyProductStats = analyzeTrendyolProducts(tyProducts);
  const tyClaimStats = analyzeTrendyolClaims(tyClaims);

  // Historical comparison
  const history = readHistoricalSnapshots(7);
  const trend = compareTrend(null, history);

  // Action items
  const actions = generateActionItems(etsyOrderStats, etsyListingStats, tyOrderStats, tyProductStats, tyClaimStats);

  // ------ Build report ------

  const report = buildReport(
    etsyOrderStats, etsyListingStats,
    tyOrderStats, tyProductStats, tyClaimStats,
    actions, trend,
    etsyAvailable, tyAvailable,
  );

  // ------ Save snapshot ------

  const snapshot = {
    timestamp: new Date().toISOString(),
    data: {
      etsy: etsyAvailable ? {
        orders: {
          todayRevenue: etsyOrderStats.todayRevenue,
          todayCount: etsyOrderStats.todayCount,
          weekRevenue: etsyOrderStats.weekRevenue,
          weekCount: etsyOrderStats.weekCount,
          avgDaily: etsyOrderStats.avgDaily,
        },
        listings: {
          total: etsyListingStats.total,
          zeroViews: etsyListingStats.zeroViews.length,
          avgViews: etsyListingStats.avgViews,
          top3: etsyListingStats.topByViews.slice(0, 3).map(l => ({
            id: l.listing_id,
            title: truncate(l.title, 60),
            views: l.views || 0,
            favorites: l.num_favorers || 0,
          })),
        },
      } : null,
      trendyol: tyAvailable ? {
        orders: {
          todayRevenue: tyOrderStats.todayRevenue,
          todayCount: tyOrderStats.todayCount,
          weekRevenue: tyOrderStats.weekRevenue,
          weekCount: tyOrderStats.weekCount,
          pendingShipment: tyOrderStats.pendingShipment.length,
          cancelled: tyOrderStats.cancelled.length,
        },
        products: {
          total: tyProductStats.total,
          onSale: tyProductStats.onSale,
          outOfStock: tyProductStats.outOfStock.length,
          rejected: tyProductStats.rejected.length,
        },
        claims: tyClaimStats.total,
      } : null,
    },
    actions,
    report,
  };

  appendJsonl(COUNCIL_LOG, snapshot);

  // ------ Output ------

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`[${SCRIPT_NAME}] Done in ${elapsed}s`);
  cronLog('end', { durationMs: Date.now() - startTime });

  // Print report to stdout (for cron delivery)
  console.log(report);
}

main().catch(err => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, err);
  cronLog('error', { error: err.message });
  process.exit(1);
});
