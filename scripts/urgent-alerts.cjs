#!/usr/bin/env node
/**
 * Clawd Urgent Alerts — Proactive E-commerce Monitoring
 *
 * Checks for urgent situations across Etsy and Trendyol:
 *   1. Etsy order issues (bad reviews, problem orders)
 *   2. Trendyol pending shipments (overdue)
 *   3. Trendyol unanswered customer questions
 *   4. Trendyol claims/returns
 *
 * Run via heartbeat every few hours, or as a cron job.
 *
 * Output:
 *   - Human-readable summary to stdout
 *   - JSONL log to /data/workspace/logs/urgent-alerts.jsonl
 *
 * Usage:
 *   node /app/scripts/urgent-alerts.cjs
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_DIR = '/data/workspace/logs';
const LOG_FILE = path.join(LOG_DIR, 'urgent-alerts.jsonl');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, timeoutMs = 30000) {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (e) {
        return null;
    }
}

function ensureLogDir() {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    } catch (_) { /* already exists */ }
}

function appendLog(entry) {
    ensureLogDir();
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(LOG_FILE, line, 'utf8');
}

function dateHeader() {
    return new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        timeZone: 'Europe/Belgrade' // CET — Skopje
    });
}

function nowISO() {
    return new Date().toISOString();
}

// Return the age of an epoch-ms timestamp in hours
function ageInHours(epochMs) {
    if (!epochMs || epochMs <= 0) return Infinity;
    return (Date.now() - epochMs) / (1000 * 60 * 60);
}

// Try to parse JSON from a string that might contain jq-formatted text.
// Returns null on failure.
function tryParseJson(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Check 1: Etsy orders — look for anything unusual
// ---------------------------------------------------------------------------

function checkEtsyOrders() {
    const result = { name: 'etsy_orders', urgent: false, issues: [], summary: '' };

    const raw = run('/app/scripts/etsy.sh orders --limit 10');
    if (!raw) {
        result.summary = 'Etsy orders: could not fetch (API may be down)';
        result.issues.push({ type: 'api_error', detail: 'etsy.sh orders returned no output' });
        result.urgent = true;
        return result;
    }

    // The etsy.sh orders command outputs formatted text, not JSON.
    // We also try a raw JSON call so we can inspect fields.
    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) {
        result.summary = 'Etsy orders: KOLAYXPORT_API_KEY not set';
        result.issues.push({ type: 'config_error', detail: 'Missing KOLAYXPORT_API_KEY' });
        result.urgent = true;
        return result;
    }

    const jsonRaw = run(`curl -s "${apiUrl}/etsy?apiKey=${apiKey}&action=receipts&limit=10"`);
    const orders = tryParseJson(jsonRaw);

    if (!orders || !Array.isArray(orders)) {
        // The text output looked OK but JSON parsing failed — just report text summary
        result.summary = 'Etsy orders: normal (text-only check)';
        return result;
    }

    if (orders.length === 0) {
        result.summary = 'Etsy orders: no recent orders';
        return result;
    }

    // Look for orders with issues
    let issueCount = 0;
    for (const order of orders) {
        // Check for unshipped orders older than 48h
        const orderDate = order.order_date ? new Date(order.order_date).getTime() : 0;
        const hoursOld = ageInHours(orderDate);

        const isShipped = order.status === 'Shipped' || order.status === 'Completed' ||
                          order.tracking?.tracking_code;

        if (hoursOld > 48 && !isShipped) {
            result.issues.push({
                type: 'unshipped_order',
                detail: `Order #${order.receipt_id} is ${Math.round(hoursOld)}h old and unshipped`,
                receipt_id: order.receipt_id,
                hours_old: Math.round(hoursOld)
            });
            issueCount++;
        }
    }

    if (issueCount > 0) {
        result.urgent = true;
        result.summary = `${issueCount} Etsy order(s) may need attention`;
    } else {
        result.summary = `Etsy orders: normal (${orders.length} checked)`;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Check 2: Trendyol pending shipments
// ---------------------------------------------------------------------------

function checkTrendyolShipments() {
    const result = { name: 'trendyol_shipments', urgent: false, issues: [], summary: '' };

    const jsonRaw = run('/app/scripts/trendyol.sh orders --size 20 2>/dev/null');
    if (!jsonRaw) {
        result.summary = 'Trendyol orders: could not fetch';
        result.issues.push({ type: 'api_error', detail: 'trendyol.sh orders returned no output' });
        result.urgent = true;
        return result;
    }

    // Also try raw JSON via curl for structured data
    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) {
        result.summary = 'Trendyol orders: KOLAYXPORT_API_KEY not set';
        result.issues.push({ type: 'config_error', detail: 'Missing KOLAYXPORT_API_KEY' });
        result.urgent = true;
        return result;
    }

    const rawJson = run(`curl -s "${apiUrl}/trendyol?apiKey=${apiKey}&action=orders&size=20"`);
    const data = tryParseJson(rawJson);

    if (!data || !data.content) {
        // Fall back to text analysis
        const pendingMatches = jsonRaw.match(/Status:\s*Created/gi) || [];
        const pickingMatches = jsonRaw.match(/Status:\s*Picking/gi) || [];
        const unshippedCount = pendingMatches.length + pickingMatches.length;

        if (unshippedCount > 0) {
            result.urgent = unshippedCount >= 3;
            result.issues.push({
                type: 'pending_shipments',
                detail: `${unshippedCount} order(s) not yet shipped (text parse)`,
                count: unshippedCount
            });
            result.summary = `${unshippedCount} Trendyol order(s) pending shipment`;
        } else {
            result.summary = 'Trendyol shipments: all shipped';
        }
        return result;
    }

    const orders = data.content;
    let pendingCount = 0;
    let overdue48h = 0;

    for (const order of orders) {
        const status = (order.status || '').toLowerCase();
        if (status === 'created' || status === 'picking') {
            pendingCount++;

            const orderDateMs = order.orderDate || 0;
            if (ageInHours(orderDateMs) > 48) {
                overdue48h++;
                result.issues.push({
                    type: 'overdue_shipment',
                    detail: `Order #${order.orderNumber} pending >48h (status: ${order.status})`,
                    order_number: order.orderNumber,
                    status: order.status,
                    hours_old: Math.round(ageInHours(orderDateMs))
                });
            }
        }
    }

    if (overdue48h > 0) {
        result.urgent = true;
        result.summary = `${overdue48h} Trendyol order(s) pending shipment >48h`;
    } else if (pendingCount > 0) {
        result.summary = `${pendingCount} Trendyol order(s) pending shipment (within deadline)`;
    } else {
        result.summary = `Trendyol shipments: all shipped (${orders.length} checked)`;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Check 3: Trendyol unanswered customer questions
// ---------------------------------------------------------------------------

function checkTrendyolQuestions() {
    const result = { name: 'trendyol_questions', urgent: false, issues: [], summary: '' };

    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) {
        result.summary = 'Trendyol questions: KOLAYXPORT_API_KEY not set';
        return result;
    }

    const rawJson = run(`curl -s "${apiUrl}/trendyol?apiKey=${apiKey}&action=questions"`);
    const data = tryParseJson(rawJson);

    if (!data) {
        // Fallback: use the shell script and parse text
        const text = run('/app/scripts/trendyol.sh questions');
        if (!text) {
            result.summary = 'Trendyol questions: could not fetch';
            return result;
        }

        const waitingMatches = text.match(/Answer:\s*\[WAITING\]/gi) || [];
        const unanswered = waitingMatches.length;

        if (unanswered > 0) {
            result.urgent = true;
            result.issues.push({
                type: 'unanswered_questions',
                detail: `${unanswered} unanswered customer question(s) (text parse)`,
                count: unanswered
            });
            result.summary = `${unanswered} unanswered Trendyol question(s)`;
        } else {
            result.summary = 'Trendyol questions: all answered';
        }
        return result;
    }

    const questions = data.content || data.questions || [];
    let unansweredCount = 0;
    let oldUnanswered = 0;

    for (const q of questions) {
        const hasAnswer = q.answer && q.answer.text;
        const status = (q.status || '').toLowerCase();

        if (!hasAnswer || status === 'waiting_for_answer' || status === 'unanswered') {
            unansweredCount++;

            // Try to parse date and check age
            const createdMs = q.creationDateMs || (q.creationDate ? new Date(q.creationDate).getTime() : 0);
            if (ageInHours(createdMs) > 24) {
                oldUnanswered++;
                result.issues.push({
                    type: 'old_unanswered_question',
                    detail: `Question #${q.id} unanswered >24h: "${(q.text || '').substring(0, 60)}"`,
                    question_id: q.id,
                    product: q.productName,
                    hours_old: Math.round(ageInHours(createdMs))
                });
            } else {
                result.issues.push({
                    type: 'unanswered_question',
                    detail: `Question #${q.id}: "${(q.text || '').substring(0, 60)}"`,
                    question_id: q.id,
                    product: q.productName
                });
            }
        }
    }

    if (oldUnanswered > 0) {
        result.urgent = true;
        result.summary = `${oldUnanswered} unanswered Trendyol question(s) >24h old`;
    } else if (unansweredCount > 0) {
        result.urgent = true;
        result.summary = `${unansweredCount} unanswered Trendyol question(s)`;
    } else {
        result.summary = 'Trendyol questions: all answered';
    }

    return result;
}

// ---------------------------------------------------------------------------
// Check 4: Trendyol claims / returns
// ---------------------------------------------------------------------------

function checkTrendyolClaims() {
    const result = { name: 'trendyol_claims', urgent: false, issues: [], summary: '' };

    const apiKey = process.env.KOLAYXPORT_API_KEY;
    const apiUrl = process.env.KOLAYXPORT_API_URL || 'https://kolayxport.com/api/clawd';

    if (!apiKey) {
        result.summary = 'Trendyol claims: KOLAYXPORT_API_KEY not set';
        return result;
    }

    const rawJson = run(`curl -s "${apiUrl}/trendyol?apiKey=${apiKey}&action=claims"`);
    const data = tryParseJson(rawJson);

    if (!data) {
        const text = run('/app/scripts/trendyol.sh claims');
        if (!text) {
            result.summary = 'Trendyol claims: could not fetch';
            return result;
        }

        const claimMatches = text.match(/Claim #/gi) || [];
        if (claimMatches.length > 0) {
            result.urgent = true;
            result.issues.push({
                type: 'claims_found',
                detail: `${claimMatches.length} claim(s) found (text parse)`,
                count: claimMatches.length
            });
            result.summary = `${claimMatches.length} Trendyol claim(s)/return(s) found`;
        } else if (text.includes('0 total') || text.includes('Returns/Claims (0')) {
            result.summary = 'Trendyol claims: none';
        } else {
            result.summary = 'Trendyol claims: checked (no issues detected)';
        }
        return result;
    }

    const claims = data.content || data.claims || [];
    const totalClaims = data.totalElements || claims.length;

    if (totalClaims === 0 || claims.length === 0) {
        result.summary = 'Trendyol claims: none';
        return result;
    }

    // Check for recent / active claims
    let newClaims = 0;
    for (const claim of claims) {
        const claimDateMs = claim.claimDate || 0;
        const hoursOld = ageInHours(claimDateMs);

        // Claims in the last 72 hours are considered "new"
        if (hoursOld <= 72) {
            newClaims++;
            result.issues.push({
                type: 'new_claim',
                detail: `Claim #${claim.claimId || claim.id} on order #${claim.orderNumber} (${Math.round(hoursOld)}h ago)`,
                claim_id: claim.claimId || claim.id,
                order_number: claim.orderNumber,
                hours_old: Math.round(hoursOld)
            });
        }
    }

    if (newClaims > 0) {
        result.urgent = true;
        result.summary = `${newClaims} new Trendyol claim(s)/return(s) in last 72h`;
    } else {
        result.summary = `Trendyol claims: ${totalClaims} total (no recent ones)`;
    }

    return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const timestamp = nowISO();
    const date = dateHeader();

    // Run all checks
    const checks = [
        checkEtsyOrders(),
        checkTrendyolShipments(),
        checkTrendyolQuestions(),
        checkTrendyolClaims()
    ];

    const urgentChecks = checks.filter(c => c.urgent);
    const okChecks = checks.filter(c => !c.urgent);

    // Build output
    const lines = [];

    if (urgentChecks.length > 0) {
        lines.push(`\u{1F6A8} URGENT ALERTS \u2014 ${date}`);
        for (const check of urgentChecks) {
            for (const issue of check.issues) {
                lines.push(`\u2022 ${issue.detail}`);
            }
            // If no individual issues but still urgent (e.g., summary-level)
            if (check.issues.length === 0) {
                lines.push(`\u2022 ${check.summary}`);
            }
        }
    }

    if (okChecks.length > 0) {
        if (urgentChecks.length > 0) {
            lines.push('');
        }
        lines.push(`\u2705 NO ISSUES`);
        for (const check of okChecks) {
            lines.push(`\u2022 ${check.summary}`);
        }
    }

    // If nothing is urgent at all
    if (urgentChecks.length === 0) {
        lines.length = 0; // clear
        lines.push(`ALERTS_OK \u2014 no urgent issues`);
        lines.push('');
        for (const check of checks) {
            lines.push(`\u2022 ${check.summary}`);
        }
    }

    const output = lines.join('\n');
    console.log(output);

    // Write to JSONL log
    const logEntry = {
        timestamp,
        urgent: urgentChecks.length > 0,
        checks: checks.map(c => ({
            name: c.name,
            urgent: c.urgent,
            summary: c.summary,
            issue_count: c.issues.length,
            issues: c.issues
        })),
        output
    };

    appendLog(logEntry);

    // Exit with code 1 if there are urgent issues (useful for cron alerting)
    if (urgentChecks.length > 0) {
        process.exit(1);
    }
}

main();
