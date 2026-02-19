#!/usr/bin/env node
/**
 * Clawd Financial Tracker - Weekly/Monthly P&L Summary
 *
 * Generates profit & loss summaries for multi-platform e-commerce business:
 *   - Etsy (BelleCoutureGifts) — USD
 *   - Trendyol (Sara Tasarim) — TRY
 *
 * Data sources:
 *   - Etsy orders via KolayXport API
 *   - Trendyol orders via KolayXport API
 *   - Claude API usage from /data/workspace/logs/usage-tracker.jsonl
 *
 * Output:
 *   - WhatsApp-friendly P&L text to stdout
 *   - JSONL snapshot to /data/workspace/logs/financial-tracker.jsonl
 *   - Start/end events to /data/workspace/logs/cron-log.jsonl
 *
 * Usage:
 *   node scripts/financial-tracker.cjs [--json] [--period 7d|30d|90d]
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TRACKER_LOG = '/data/workspace/logs/financial-tracker.jsonl';
const CRON_LOG    = '/data/workspace/logs/cron-log.jsonl';
const USAGE_LOG   = '/data/workspace/logs/usage-tracker.jsonl';
const SCRIPT_NAME = 'financial-tracker';

const API_URL = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';
const API_KEY = process.env.KOLAYXPORT_API_KEY || '';

const ETSY_TRANSACTION_FEE_PCT = 0.065;   // 6.5%
const ETSY_LISTING_FEE         = 0.20;    // $0.20 per sale
const TRENDYOL_COMMISSION_PCT  = 0.15;    // ~15% average

// ---------------------------------------------------------------------------
// CLI Parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const periodIdx = args.indexOf('--period');
const periodArg = periodIdx !== -1 ? args[periodIdx + 1] : '30d';

function parsePeriodDays(str) {
  const match = (str || '30d').match(/^(\d+)d$/);
  return match ? parseInt(match[1], 10) : 30;
}

const PERIOD_DAYS = parsePeriodDays(periodArg);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

/** Normalize date values: ISO strings, epoch seconds (Etsy), epoch ms (Trendyol). */
function toDate(val) {
  if (!val) return new Date(0);
  if (typeof val === 'string') return new Date(val);
  if (typeof val === 'number') return val < 1e12 ? new Date(val * 1000) : new Date(val);
  return new Date(val);
}

function daysAgo(val) {
  return (Date.now() - toDate(val).getTime()) / (86400 * 1000);
}

function fmtUSD(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtTRY(n) {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

/** Fetch JSON from KolayXport API */
async function api(endpoint, params = {}) {
  const qs = new URLSearchParams({ apiKey: API_KEY, ...params }).toString();
  const url = `${API_URL}/${endpoint}?${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
  return res.json();
}

// ---------------------------------------------------------------------------
// Revenue Collection
// ---------------------------------------------------------------------------

async function fetchEtsyOrders() {
  try {
    const data = await api('etsy', { action: 'receipts', limit: '100' });
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.error(`[${SCRIPT_NAME}] Etsy orders error: ${e.message}`);
    return null;
  }
}

async function fetchTrendyolOrders(dayRange) {
  try {
    const startDate = String(Date.now() - dayRange * 86400 * 1000);
    const data = await api('trendyol', { action: 'orders', size: '100', startDate });
    if (data && data.content) return data;
    return { content: [], totalElements: 0 };
  } catch (e) {
    console.error(`[${SCRIPT_NAME}] Trendyol orders error: ${e.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cost Collection
// ---------------------------------------------------------------------------

function readApiUsage(periodDays) {
  if (!fs.existsSync(USAGE_LOG)) return { totalCost: 0, entries: 0 };
  try {
    const lines = fs.readFileSync(USAGE_LOG, 'utf8').trim().split('\n').filter(Boolean);
    const cutoff = Date.now() - periodDays * 86400 * 1000;
    let totalCost = 0;
    let entries = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : 0;
        if (ts > cutoff) {
          totalCost += obj.cost || obj.total_cost || obj.usd_cost || 0;
          entries++;
        }
      } catch { /* skip malformed lines */ }
    }
    return { totalCost, entries };
  } catch {
    return { totalCost: 0, entries: 0 };
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeEtsyRevenue(orders, daysCutoff) {
  if (!orders || orders.length === 0) return { revenue: 0, count: 0 };
  const filtered = orders.filter(o => daysAgo(o.order_date) <= daysCutoff);
  const revenue = filtered.reduce((sum, o) => {
    const amount = o.total_price?.amount || 0;
    const divisor = o.total_price?.divisor || 100;
    return sum + (amount / divisor);
  }, 0);
  return { revenue, count: filtered.length };
}

function analyzeTrendyolRevenue(ordersData, daysCutoff) {
  if (!ordersData || !ordersData.content) return { revenue: 0, count: 0 };
  const orders = ordersData.content;
  const filtered = orders.filter(o => o.orderDate && daysAgo(o.orderDate) <= daysCutoff);
  const revenue = filtered.reduce((sum, o) => {
    return sum + (o.lines || []).reduce((s, l) => s + (l.amount || 0), 0);
  }, 0);
  return { revenue, count: filtered.length };
}

function computeEtsyCosts(revenue, orderCount) {
  const transactionFee = revenue * ETSY_TRANSACTION_FEE_PCT;
  const listingFees = orderCount * ETSY_LISTING_FEE;
  return { transactionFee, listingFees, total: transactionFee + listingFees };
}

function computeTrendyolCosts(revenue) {
  const commission = revenue * TRENDYOL_COMMISSION_PCT;
  return { commission, total: commission };
}

// ---------------------------------------------------------------------------
// Historical Comparison
// ---------------------------------------------------------------------------

function readHistoricalSnapshots() {
  if (!fs.existsSync(TRACKER_LOG)) return [];
  try {
    const lines = fs.readFileSync(TRACKER_LOG, 'utf8').trim().split('\n').filter(Boolean);
    return lines
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function computeTrends(current, history, periodDays) {
  // Find a snapshot from roughly one period ago to compare
  const targetTs = Date.now() - periodDays * 86400 * 1000;
  const twoPeriodAgo = Date.now() - 2 * periodDays * 86400 * 1000;

  const prevSnapshots = history.filter(h => {
    const ts = new Date(h.timestamp).getTime();
    return ts >= twoPeriodAgo && ts <= targetTs && h.periodDays === periodDays;
  });

  if (prevSnapshots.length === 0) return null;

  // Use most recent matching snapshot
  const prev = prevSnapshots[prevSnapshots.length - 1];
  const trends = {};

  if (prev.etsy && current.etsy) {
    trends.etsyRevenuePct = pctChange(current.etsy.revenue, prev.etsy.revenue);
    trends.etsyOrdersPct  = pctChange(current.etsy.count, prev.etsy.count);
  }
  if (prev.trendyol && current.trendyol) {
    trends.trendyolRevenuePct = pctChange(current.trendyol.revenue, prev.trendyol.revenue);
    trends.trendyolOrdersPct  = pctChange(current.trendyol.count, prev.trendyol.count);
  }

  return trends;
}

// ---------------------------------------------------------------------------
// Report Builder (WhatsApp-friendly, no markdown tables)
// ---------------------------------------------------------------------------

function buildReport(data) {
  const now = new Date();
  const monthName = now.toLocaleString('en-US', { month: 'short' });
  const year = now.getFullYear();
  const periodLabel = PERIOD_DAYS === 7 ? 'Weekly' : PERIOD_DAYS === 30 ? 'Monthly' : `${PERIOD_DAYS}-Day`;

  let r = '';
  r += `FINANCIAL SUMMARY \u2014 ${monthName} ${year}\n`;
  r += '\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n\n';

  // --- Revenue: 7-day ---
  r += 'REVENUE (Last 7 Days)\n';
  if (data.etsyAvailable) {
    r += `\u2022 Etsy: $${fmtUSD(data.etsy7.revenue)} (${data.etsy7.count} orders)\n`;
  } else {
    r += '\u2022 Etsy: unavailable\n';
  }
  if (data.trendyolAvailable) {
    r += `\u2022 Trendyol: \u20BA${fmtTRY(data.trendyol7.revenue)} (${data.trendyol7.count} orders)\n`;
  } else {
    r += '\u2022 Trendyol: unavailable\n';
  }
  r += '\n';

  // --- Revenue: period ---
  r += `REVENUE (Last ${PERIOD_DAYS} Days)\n`;
  if (data.etsyAvailable) {
    r += `\u2022 Etsy: $${fmtUSD(data.etsyPeriod.revenue)} (${data.etsyPeriod.count} orders)\n`;
  } else {
    r += '\u2022 Etsy: unavailable\n';
  }
  if (data.trendyolAvailable) {
    r += `\u2022 Trendyol: \u20BA${fmtTRY(data.trendyolPeriod.revenue)} (${data.trendyolPeriod.count} orders)\n`;
  } else {
    r += '\u2022 Trendyol: unavailable\n';
  }
  r += '\n';

  // --- Estimated Costs ---
  r += `ESTIMATED COSTS (Last ${PERIOD_DAYS} Days)\n`;
  if (data.etsyAvailable) {
    r += `\u2022 Etsy fees (6.5% + listing): ~$${fmtUSD(data.etsyCosts.total)}\n`;
  }
  if (data.trendyolAvailable) {
    r += `\u2022 Trendyol commission (~15%): ~\u20BA${fmtTRY(data.trendyolCosts.total)}\n`;
  }
  r += `\u2022 Claude API usage: ~$${fmtUSD(data.apiUsage.totalCost)}\n`;
  r += '\n';

  // --- Net Margin ---
  r += 'NET MARGIN\n';
  if (data.etsyAvailable && data.etsyPeriod.revenue > 0) {
    const etsyNet = data.etsyPeriod.revenue - data.etsyCosts.total;
    const etsyMarginPct = (etsyNet / data.etsyPeriod.revenue) * 100;
    r += `\u2022 Etsy: ~$${fmtUSD(etsyNet)} (~${etsyMarginPct.toFixed(0)}%)\n`;
  } else if (data.etsyAvailable) {
    r += '\u2022 Etsy: $0.00 (no sales)\n';
  }
  if (data.trendyolAvailable && data.trendyolPeriod.revenue > 0) {
    const tyNet = data.trendyolPeriod.revenue - data.trendyolCosts.total;
    const tyMarginPct = (tyNet / data.trendyolPeriod.revenue) * 100;
    r += `\u2022 Trendyol: ~\u20BA${fmtTRY(tyNet)} (~${tyMarginPct.toFixed(0)}%)\n`;
  } else if (data.trendyolAvailable) {
    r += '\u2022 Trendyol: \u20BA0.00 (no sales)\n';
  }
  r += '\n';

  // --- Trends ---
  if (data.trends) {
    r += 'TRENDS\n';
    if (data.trends.etsyRevenuePct !== undefined && data.trends.etsyRevenuePct !== null) {
      const arrow = data.trends.etsyRevenuePct >= 0 ? '\u2191' : '\u2193';
      const word  = data.trends.etsyRevenuePct >= 0 ? 'up' : 'down';
      r += `${arrow} Etsy revenue ${word} ${Math.abs(data.trends.etsyRevenuePct).toFixed(0)}% vs previous ${PERIOD_DAYS} days\n`;
    }
    if (data.trends.trendyolRevenuePct !== undefined && data.trends.trendyolRevenuePct !== null) {
      const arrow = data.trends.trendyolRevenuePct >= 0 ? '\u2191' : '\u2193';
      const word  = data.trends.trendyolRevenuePct >= 0 ? 'up' : 'down';
      r += `${arrow} Trendyol revenue ${word} ${Math.abs(data.trends.trendyolRevenuePct).toFixed(0)}% vs previous ${PERIOD_DAYS} days\n`;
    }
    if (data.trends.etsyOrdersPct !== undefined && data.trends.etsyOrdersPct !== null) {
      const arrow = data.trends.etsyOrdersPct >= 0 ? '\u2191' : '\u2193';
      const word  = data.trends.etsyOrdersPct >= 0 ? 'up' : 'down';
      r += `${arrow} Etsy orders ${word} ${Math.abs(data.trends.etsyOrdersPct).toFixed(0)}% vs previous ${PERIOD_DAYS} days\n`;
    }
    if (data.trends.trendyolOrdersPct !== undefined && data.trends.trendyolOrdersPct !== null) {
      const arrow = data.trends.trendyolOrdersPct >= 0 ? '\u2191' : '\u2193';
      const word  = data.trends.trendyolOrdersPct >= 0 ? 'up' : 'down';
      r += `${arrow} Trendyol orders ${word} ${Math.abs(data.trends.trendyolOrdersPct).toFixed(0)}% vs previous ${PERIOD_DAYS} days\n`;
    }
  } else {
    r += 'TRENDS\n';
    r += 'No historical data yet for comparison.\n';
  }

  return r;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startTime = Date.now();
  cronLog('start');
  console.error(`[${SCRIPT_NAME}] Starting at ${new Date().toISOString()}`);
  console.error(`[${SCRIPT_NAME}] Period: ${PERIOD_DAYS} days, JSON output: ${jsonOutput}`);

  if (!API_KEY) {
    const msg = 'KOLAYXPORT_API_KEY not set. Cannot fetch e-commerce data.';
    console.error(`[${SCRIPT_NAME}] ${msg}`);
    cronLog('error', { error: msg });
    process.exit(1);
  }

  // --- Parallel data collection ---
  console.error(`[${SCRIPT_NAME}] Fetching data from APIs...`);

  // We need Trendyol orders for both 7-day and full period windows.
  // The API's startDate filter lets us fetch the wider range, then filter locally for 7d.
  // For Etsy, the API returns recent receipts (up to limit); we filter locally.
  const maxDays = Math.max(PERIOD_DAYS, 7);

  const [etsyOrders, trendyolOrders] = await Promise.all([
    fetchEtsyOrders(),
    fetchTrendyolOrders(maxDays),
  ]);

  const etsyAvailable = etsyOrders !== null;
  const trendyolAvailable = trendyolOrders !== null;

  if (!etsyAvailable && !trendyolAvailable) {
    const msg = 'Both Etsy and Trendyol APIs failed. No data to report.';
    console.error(`[${SCRIPT_NAME}] ${msg}`);
    cronLog('error', { error: msg });
    console.log(`FINANCIAL SUMMARY \u2014 ${new Date().toLocaleString('en-US', { month: 'short' })} ${new Date().getFullYear()}\n\nBoth Etsy and Trendyol APIs are unreachable. Check KolayXport status.`);
    process.exit(1);
  }

  // --- Analyze revenue ---
  console.error(`[${SCRIPT_NAME}] Analyzing revenue...`);

  const etsy7          = etsyAvailable ? analyzeEtsyRevenue(etsyOrders, 7) : { revenue: 0, count: 0 };
  const etsyPeriod     = etsyAvailable ? analyzeEtsyRevenue(etsyOrders, PERIOD_DAYS) : { revenue: 0, count: 0 };
  const trendyol7      = trendyolAvailable ? analyzeTrendyolRevenue(trendyolOrders, 7) : { revenue: 0, count: 0 };
  const trendyolPeriod = trendyolAvailable ? analyzeTrendyolRevenue(trendyolOrders, PERIOD_DAYS) : { revenue: 0, count: 0 };

  // --- Compute costs ---
  const etsyCosts     = computeEtsyCosts(etsyPeriod.revenue, etsyPeriod.count);
  const trendyolCosts = computeTrendyolCosts(trendyolPeriod.revenue);
  const apiUsage      = readApiUsage(PERIOD_DAYS);

  // --- Historical trends ---
  const history  = readHistoricalSnapshots();
  const currentData = {
    etsy: etsyAvailable ? etsyPeriod : null,
    trendyol: trendyolAvailable ? trendyolPeriod : null,
  };
  const trends = computeTrends(currentData, history, PERIOD_DAYS);

  // --- Assemble data bundle ---
  const data = {
    etsyAvailable,
    trendyolAvailable,
    etsy7,
    etsyPeriod,
    trendyol7,
    trendyolPeriod,
    etsyCosts,
    trendyolCosts,
    apiUsage,
    trends,
  };

  // --- Save snapshot ---
  const snapshot = {
    timestamp: new Date().toISOString(),
    periodDays: PERIOD_DAYS,
    etsy: etsyAvailable ? {
      revenue: etsyPeriod.revenue,
      count: etsyPeriod.count,
      fees: etsyCosts.total,
      net: etsyPeriod.revenue - etsyCosts.total,
    } : null,
    trendyol: trendyolAvailable ? {
      revenue: trendyolPeriod.revenue,
      count: trendyolPeriod.count,
      commission: trendyolCosts.total,
      net: trendyolPeriod.revenue - trendyolCosts.total,
    } : null,
    apiCost: apiUsage.totalCost,
  };
  appendJsonl(TRACKER_LOG, snapshot);

  // --- Output ---
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.error(`[${SCRIPT_NAME}] Done in ${elapsed}s`);
  cronLog('end', { durationMs: Date.now() - startTime });

  if (jsonOutput) {
    console.log(JSON.stringify(snapshot, null, 2));
  } else {
    console.log(buildReport(data));
  }
}

main().catch(err => {
  console.error(`[${SCRIPT_NAME}] Fatal error:`, err);
  cronLog('error', { error: err.message });
  process.exit(1);
});
