#!/usr/bin/env node
/**
 * Clawd SaaS Monitor — Health & Event Polling for Facturino + Nabavkidata
 *
 * Polls /api/clawd/status (Facturino) and /api/clawd/status (Nabavkidata)
 * to check system health, new users, payment issues, scraper status, etc.
 *
 * Usage:
 *   node /app/scripts/saas-monitor.cjs
 *   node /app/scripts/saas-monitor.cjs --app facturino
 *   node /app/scripts/saas-monitor.cjs --app nabavkidata
 *
 * Environment:
 *   FACTURINO_URL       - e.g. https://facturino.mk
 *   NABAVKIDATA_URL     - e.g. https://nabavkidata.com
 *   SAAS_MONITOR_TOKEN  - shared secret for X-Monitor-Token header
 *
 * Output:
 *   - Human-readable summary to stdout
 *   - JSONL log to /data/workspace/logs/saas-monitor.jsonl
 *   - Exit code 1 if urgent issues found
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_DIR = '/data/workspace/logs';
const LOG_FILE = path.join(LOG_DIR, 'saas-monitor.jsonl');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FACTURINO_URL = process.env.FACTURINO_URL || 'https://facturino.mk';
const NABAVKIDATA_URL = process.env.NABAVKIDATA_URL || 'https://nabavkidata.com';
const TOKEN = process.env.SAAS_MONITOR_TOKEN || '';

const APPS = {
    facturino: {
        name: 'Facturino',
        url: FACTURINO_URL,
        statusPath: '/api/v1/clawd/status',
        healthPath: '/health'
    },
    nabavkidata: {
        name: 'Nabavkidata',
        url: NABAVKIDATA_URL,
        statusPath: '/api/clawd/status',
        healthPath: '/health'
    }
};

// Parse --app flag
const appFilter = process.argv.find((a, i) => process.argv[i - 1] === '--app');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd, timeoutMs = 15000) {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (e) {
        return null;
    }
}

function ensureLogDir() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

function appendLog(entry) {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function dateHeader() {
    return new Date().toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
        timeZone: 'Europe/Belgrade'
    });
}

function nowISO() {
    return new Date().toISOString();
}

function tryParseJson(raw) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
}

// ---------------------------------------------------------------------------
// Poll an app's /api/clawd/status endpoint
// ---------------------------------------------------------------------------

function pollAppStatus(appKey) {
    const app = APPS[appKey];
    const result = {
        name: appKey,
        label: app.name,
        urgent: false,
        reachable: false,
        issues: [],
        events: [],
        summary: ''
    };

    // Try the clawd/status endpoint first (rich data)
    const statusUrl = `${app.url}${app.statusPath}`;
    const headers = TOKEN ? `-H "X-Monitor-Token: ${TOKEN}"` : '';
    const raw = run(`curl -sf ${headers} "${statusUrl}" 2>/dev/null`);
    const data = tryParseJson(raw);

    if (data) {
        result.reachable = true;

        // Check overall health status
        if (data.status === 'degraded') {
            result.urgent = true;
            result.issues.push({
                type: 'degraded',
                detail: `${app.name} is DEGRADED`
            });

            // List failing checks
            if (data.health) {
                for (const [check, ok] of Object.entries(data.health)) {
                    if (!ok) {
                        result.issues.push({
                            type: 'health_check_failed',
                            detail: `${app.name}: ${check} check failed`
                        });
                    }
                }
            }
        }

        // Check metrics for issues
        if (data.metrics) {
            const m = data.metrics;

            // New users (informational, not urgent)
            if (m.new_users_24h > 0) {
                result.events.push({
                    type: 'new_users',
                    detail: `${app.name}: ${m.new_users_24h} new user(s) in last 24h`
                });
            }

            // Failed jobs (urgent if > 0)
            if (m.failed_jobs_24h > 0) {
                result.urgent = true;
                result.issues.push({
                    type: 'failed_jobs',
                    detail: `${app.name}: ${m.failed_jobs_24h} failed job(s) in last 24h`
                });
            }

            // Pending webhooks (warning if > 10)
            if (m.pending_webhooks > 10) {
                result.issues.push({
                    type: 'pending_webhooks',
                    detail: `${app.name}: ${m.pending_webhooks} pending webhooks (backlog)`
                });
            }

            // Scraper status (nabavkidata-specific)
            if (m.scraper_status === 'failed') {
                result.urgent = true;
                result.issues.push({
                    type: 'scraper_failed',
                    detail: `${app.name}: scraper FAILED`
                });
            } else if (m.scraper_status === 'stale') {
                result.issues.push({
                    type: 'scraper_stale',
                    detail: `${app.name}: scraper is stale (last run: ${m.scraper_last_run || 'unknown'})`
                });
            }

            // High error rate
            if (m.error_rate_1h > 0.05) {
                result.urgent = true;
                result.issues.push({
                    type: 'high_error_rate',
                    detail: `${app.name}: ${(m.error_rate_1h * 100).toFixed(1)}% error rate in last hour`
                });
            }
        }

        // Collect recent events
        if (data.recent_events && data.recent_events.length > 0) {
            for (const evt of data.recent_events) {
                if (evt.type === 'payment_failed' || evt.type === 'subscription_cancelled') {
                    result.urgent = true;
                    result.issues.push({
                        type: evt.type,
                        detail: `${app.name}: ${evt.type} — ${evt.email || evt.user || 'unknown'}`
                    });
                } else {
                    result.events.push({
                        type: evt.type,
                        detail: `${app.name}: ${evt.type} — ${evt.email || evt.user || ''}`
                    });
                }
            }
        }

        // Build summary
        const issueCount = result.issues.length;
        const eventCount = result.events.length;
        if (issueCount > 0) {
            result.summary = `${app.name}: ${issueCount} issue(s)`;
        } else if (eventCount > 0) {
            result.summary = `${app.name}: healthy, ${eventCount} event(s)`;
        } else {
            result.summary = `${app.name}: healthy`;
        }

        return result;
    }

    // Fallback: try basic health endpoint
    const healthUrl = `${app.url}${app.healthPath}`;
    const healthRaw = run(`curl -sf "${healthUrl}" 2>/dev/null`);
    const healthData = tryParseJson(healthRaw);

    if (healthData) {
        result.reachable = true;
        if (healthData.status === 'degraded' || healthData.status === 'unhealthy') {
            result.urgent = true;
            result.issues.push({
                type: 'degraded',
                detail: `${app.name}: health endpoint reports ${healthData.status}`
            });
            result.summary = `${app.name}: ${healthData.status} (basic check)`;
        } else {
            result.summary = `${app.name}: healthy (basic check, clawd/status not available)`;
        }
        return result;
    }

    // App is unreachable
    result.urgent = true;
    result.issues.push({
        type: 'unreachable',
        detail: `${app.name} is DOWN — cannot reach ${app.url}`
    });
    result.summary = `${app.name}: UNREACHABLE`;

    return result;
}

// ---------------------------------------------------------------------------
// Check for recent webhook events (pushed by apps to Clawd)
// ---------------------------------------------------------------------------

function checkRecentWebhooks() {
    const result = { name: 'webhooks', urgent: false, issues: [], events: [], summary: '' };

    const urgentFile = path.join(LOG_DIR, 'saas-urgent.jsonl');
    if (!fs.existsSync(urgentFile)) {
        result.summary = 'No urgent webhook events';
        return result;
    }

    // Read last 20 lines
    try {
        const lines = fs.readFileSync(urgentFile, 'utf8').trim().split('\n').slice(-20);
        const cutoff = Date.now() - 60 * 60 * 1000; // Last 1 hour

        for (const line of lines) {
            const evt = tryParseJson(line);
            if (!evt) continue;

            const receivedAt = new Date(evt.received_at).getTime();
            if (receivedAt < cutoff) continue;

            result.urgent = true;
            result.issues.push({
                type: evt.type,
                detail: `[webhook] ${evt.app || 'unknown'}: ${evt.type} — ${evt.email || evt.detail || ''}`
            });
        }
    } catch (_) {}

    if (result.issues.length > 0) {
        result.summary = `${result.issues.length} urgent webhook event(s) in last hour`;
    } else {
        result.summary = 'No urgent webhook events';
    }

    return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    const timestamp = nowISO();
    const date = dateHeader();

    // Determine which apps to check
    const appsToCheck = appFilter ? [appFilter] : Object.keys(APPS);

    // Run checks
    const checks = [];
    for (const appKey of appsToCheck) {
        if (APPS[appKey]) {
            checks.push(pollAppStatus(appKey));
        }
    }

    // Also check recent webhook events
    if (!appFilter) {
        checks.push(checkRecentWebhooks());
    }

    const urgentChecks = checks.filter(c => c.urgent);
    const okChecks = checks.filter(c => !c.urgent);

    // Build output
    const lines = [];

    if (urgentChecks.length > 0) {
        lines.push(`\u{1F6A8} SAAS ALERTS \u2014 ${date}`);
        for (const check of urgentChecks) {
            for (const issue of check.issues) {
                lines.push(`\u2022 ${issue.detail}`);
            }
            if (check.issues.length === 0) {
                lines.push(`\u2022 ${check.summary}`);
            }
        }
    }

    // Show events (new users, etc.)
    const allEvents = checks.flatMap(c => c.events || []);
    if (allEvents.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(`\u{1F4CA} EVENTS`);
        for (const evt of allEvents) {
            lines.push(`\u2022 ${evt.detail}`);
        }
    }

    if (okChecks.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(`\u2705 HEALTHY`);
        for (const check of okChecks) {
            lines.push(`\u2022 ${check.summary}`);
        }
    }

    if (urgentChecks.length === 0 && allEvents.length === 0) {
        lines.length = 0;
        lines.push(`SAAS_OK \u2014 all systems healthy`);
        lines.push('');
        for (const check of checks) {
            lines.push(`\u2022 ${check.summary}`);
        }
    }

    const output = lines.join('\n');
    console.log(output);

    // Write to JSONL log
    appendLog({
        timestamp,
        urgent: urgentChecks.length > 0,
        apps_checked: appsToCheck,
        checks: checks.map(c => ({
            name: c.name,
            reachable: c.reachable,
            urgent: c.urgent,
            summary: c.summary,
            issue_count: c.issues.length,
            issues: c.issues,
            event_count: (c.events || []).length,
            events: c.events || []
        })),
        output
    });

    if (urgentChecks.length > 0) {
        process.exit(1);
    }
}

main();
