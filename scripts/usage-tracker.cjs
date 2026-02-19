#!/usr/bin/env node
/**
 * API Usage Tracker for Clawd
 *
 * Reads session data and calculates token usage + estimated costs.
 * Outputs a daily usage summary and appends to JSONL log.
 *
 * Usage:
 *   node usage-tracker.cjs              - Full usage report
 *   node usage-tracker.cjs --json       - Output JSON only (for piping)
 *   node usage-tracker.cjs --since 24h  - Only count sessions from last 24h (default)
 *   node usage-tracker.cjs --since 7d   - Last 7 days
 *   node usage-tracker.cjs --all        - All sessions ever
 *
 * Pricing (Claude Sonnet):
 *   Input:  $3.00 per 1M tokens
 *   Output: $15.00 per 1M tokens
 *
 * Cron: Daily (e.g., 11 PM Skopje time)
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────

const SESSIONS_PATH = '/data/.clawdbot/agents/main/sessions/sessions.json';
const LOG_DIR = '/data/workspace/logs';
const USAGE_LOG = path.join(LOG_DIR, 'usage-tracker.jsonl');
const CRON_LOG = path.join(LOG_DIR, 'cron-log.jsonl');

// ── Pricing (per 1M tokens) ───────────────────────────────────────────────────

const PRICING = {
    input: 3.00,    // $3.00 per 1M input tokens
    output: 15.00,  // $15.00 per 1M output tokens
};

// ── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const JSON_ONLY = args.includes('--json');
const ALL_TIME = args.includes('--all');

function parseSinceArg() {
    const idx = args.indexOf('--since');
    if (idx === -1) return 24 * 60 * 60 * 1000; // default: 24h

    const val = args[idx + 1] || '24h';
    const match = val.match(/^(\d+)(h|d|w)$/);
    if (!match) {
        console.error(`Invalid --since value: ${val} (use e.g., 24h, 7d, 1w)`);
        process.exit(1);
    }

    const num = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers = { h: 3600000, d: 86400000, w: 604800000 };
    return num * multipliers[unit];
}

const SINCE_MS = ALL_TIME ? 0 : parseSinceArg();

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function isoNow() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

function appendJsonl(filePath, obj) {
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, JSON.stringify(obj) + '\n');
}

function cronLog(job, status, summary) {
    appendJsonl(CRON_LOG, {
        job,
        status,
        timestamp: isoNow(),
        ...(summary ? { summary } : {}),
    });
}

function formatTokenCount(n) {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
    return String(n);
}

function formatCost(dollars) {
    return `$${dollars.toFixed(2)}`;
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

// ── Session Parsing ───────────────────────────────────────────────────────────

/**
 * Recursively search an object for token usage fields.
 * Moltbot/Clawdbot session format may vary, so we search broadly.
 */
function extractTokenUsage(obj, sessionId) {
    const result = {
        sessionId,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        messageCount: 0,
        lastActivity: null,
    };

    if (!obj || typeof obj !== 'object') return result;

    // Walk the object looking for token fields
    function walk(node, depth) {
        if (depth > 10 || !node || typeof node !== 'object') return;

        // Check for direct token fields (common patterns)
        const tokenFieldSets = [
            // Pattern 1: { inputTokens, outputTokens }
            { input: 'inputTokens', output: 'outputTokens', total: 'totalTokens' },
            // Pattern 2: { input_tokens, output_tokens }
            { input: 'input_tokens', output: 'output_tokens', total: 'total_tokens' },
            // Pattern 3: { usage: { input, output } }
            { input: 'input', output: 'output', total: 'total' },
            // Pattern 4: { tokens_in, tokens_out }
            { input: 'tokens_in', output: 'tokens_out', total: 'tokens_total' },
            // Pattern 5: { prompt_tokens, completion_tokens }
            { input: 'prompt_tokens', output: 'completion_tokens', total: 'total_tokens' },
        ];

        for (const fields of tokenFieldSets) {
            if (typeof node[fields.input] === 'number' && typeof node[fields.output] === 'number') {
                result.inputTokens += node[fields.input];
                result.outputTokens += node[fields.output];
                if (typeof node[fields.total] === 'number') {
                    result.totalTokens += node[fields.total];
                }
                return; // Found tokens at this level, don't recurse deeper
            }
        }

        // Check for usage sub-object
        if (node.usage && typeof node.usage === 'object') {
            walk(node.usage, depth + 1);
            return;
        }

        // Check for timestamp / last activity
        for (const key of ['lastActivity', 'updatedAt', 'updated_at', 'lastMessage', 'timestamp']) {
            if (node[key] && typeof node[key] === 'string') {
                const ts = new Date(node[key]);
                if (!isNaN(ts.getTime())) {
                    if (!result.lastActivity || ts > result.lastActivity) {
                        result.lastActivity = ts;
                    }
                }
            }
            if (node[key] && typeof node[key] === 'number' && node[key] > 1000000000) {
                // Epoch seconds or milliseconds
                const ms = node[key] > 1e12 ? node[key] : node[key] * 1000;
                const ts = new Date(ms);
                if (!result.lastActivity || ts > result.lastActivity) {
                    result.lastActivity = ts;
                }
            }
        }

        // Count messages
        if (Array.isArray(node.messages)) {
            result.messageCount += node.messages.length;

            // Look for token usage within messages
            for (const msg of node.messages) {
                if (msg && typeof msg === 'object') {
                    walk(msg, depth + 1);
                }
            }
        }

        // Recurse into child objects (but not arrays of primitives)
        if (Array.isArray(node)) {
            for (const item of node) {
                if (item && typeof item === 'object') {
                    walk(item, depth + 1);
                }
            }
        } else {
            for (const key of Object.keys(node)) {
                if (node[key] && typeof node[key] === 'object') {
                    walk(node[key], depth + 1);
                }
            }
        }
    }

    walk(obj, 0);

    // Ensure totalTokens is at least the sum
    if (result.totalTokens < result.inputTokens + result.outputTokens) {
        result.totalTokens = result.inputTokens + result.outputTokens;
    }

    return result;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
    cronLog('usage-tracker', 'start');

    // Read sessions file
    if (!fs.existsSync(SESSIONS_PATH)) {
        const msg = `Sessions file not found: ${SESSIONS_PATH}`;
        console.error(msg);
        cronLog('usage-tracker', 'failure', msg);
        process.exit(1);
    }

    let sessionsData;
    try {
        const raw = fs.readFileSync(SESSIONS_PATH, 'utf8');
        sessionsData = JSON.parse(raw);
    } catch (err) {
        const msg = `Failed to parse sessions file: ${err.message}`;
        console.error(msg);
        cronLog('usage-tracker', 'failure', msg);
        process.exit(1);
    }

    // Extract usage from each session
    const now = new Date();
    const cutoff = ALL_TIME ? new Date(0) : new Date(now.getTime() - SINCE_MS);
    const sessions = [];

    // Sessions may be an object keyed by ID, or an array
    const entries = Array.isArray(sessionsData)
        ? sessionsData.map((s, i) => [s.id || s.sessionId || `session-${i}`, s])
        : Object.entries(sessionsData);

    for (const [id, data] of entries) {
        const usage = extractTokenUsage(data, id);

        // Apply time filter (if we found a timestamp)
        if (usage.lastActivity && usage.lastActivity < cutoff) {
            continue;
        }

        // Include sessions with tokens or where we couldn't determine time
        if (usage.totalTokens > 0 || !usage.lastActivity) {
            sessions.push(usage);
        }
    }

    // Aggregate totals
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let totalMessages = 0;

    for (const s of sessions) {
        totalInput += s.inputTokens;
        totalOutput += s.outputTokens;
        totalTokens += s.totalTokens;
        totalMessages += s.messageCount;
    }

    // Calculate costs
    const inputCost = (totalInput / 1000000) * PRICING.input;
    const outputCost = (totalOutput / 1000000) * PRICING.output;
    const totalCost = inputCost + outputCost;

    // Find top session by total tokens
    const topSession = sessions.length > 0
        ? sessions.reduce((max, s) => s.totalTokens > max.totalTokens ? s : max, sessions[0])
        : null;

    // Build report
    const report = {
        timestamp: isoNow(),
        date: formatDate(now),
        period: ALL_TIME ? 'all-time' : `last ${SINCE_MS / 3600000}h`,
        sessions: {
            total: sessions.length,
            withTokens: sessions.filter(s => s.totalTokens > 0).length,
        },
        tokens: {
            input: totalInput,
            output: totalOutput,
            total: totalTokens,
        },
        cost: {
            input: Math.round(inputCost * 100) / 100,
            output: Math.round(outputCost * 100) / 100,
            total: Math.round(totalCost * 100) / 100,
        },
        topSession: topSession ? {
            id: topSession.sessionId,
            totalTokens: topSession.totalTokens,
            inputTokens: topSession.inputTokens,
            outputTokens: topSession.outputTokens,
        } : null,
        messages: totalMessages,
    };

    // JSON-only output mode
    if (JSON_ONLY) {
        console.log(JSON.stringify(report, null, 2));
        appendJsonl(USAGE_LOG, report);
        cronLog('usage-tracker', 'success', `${formatCost(totalCost)} total cost`);
        return;
    }

    // Human-readable output
    const periodLabel = ALL_TIME ? 'All Time' : formatDate(now);
    const lines = [
        '',
        `API USAGE -- ${periodLabel}`,
        `${'='.repeat(45)}`,
        `  Total sessions: ${sessions.length}`,
        `  Input tokens:  ${formatTokenCount(totalInput).padStart(8)} (${formatCost(inputCost)})`,
        `  Output tokens: ${formatTokenCount(totalOutput).padStart(8)} (${formatCost(outputCost)})`,
        `  Total tokens:  ${formatTokenCount(totalTokens).padStart(8)}`,
        `  Estimated cost: ${formatCost(totalCost)}`,
    ];

    if (totalMessages > 0) {
        lines.push(`  Messages: ${totalMessages}`);
    }

    if (topSession && topSession.totalTokens > 0) {
        lines.push(`  Top session: ${topSession.sessionId} (${formatTokenCount(topSession.totalTokens)} tokens)`);
    }

    lines.push(`${'='.repeat(45)}`);

    // Per-session breakdown (top 10)
    if (sessions.length > 1) {
        const sorted = [...sessions]
            .filter(s => s.totalTokens > 0)
            .sort((a, b) => b.totalTokens - a.totalTokens)
            .slice(0, 10);

        if (sorted.length > 0) {
            lines.push('');
            lines.push('Top sessions by token usage:');
            for (const s of sorted) {
                const sessionCost = (s.inputTokens / 1e6 * PRICING.input) + (s.outputTokens / 1e6 * PRICING.output);
                lines.push(`  ${s.sessionId.substring(0, 40).padEnd(40)} ${formatTokenCount(s.totalTokens).padStart(8)} (${formatCost(sessionCost)})`);
            }
        }
    }

    // Warning thresholds
    if (totalCost > 10) {
        lines.push('');
        lines.push('WARNING: Daily cost exceeds $10.00! Review session usage.');
    } else if (totalCost > 5) {
        lines.push('');
        lines.push('NOTE: Daily cost above $5.00. Monitor for unusual spikes.');
    }

    lines.push('');

    console.log(lines.join('\n'));

    // Write to JSONL log
    appendJsonl(USAGE_LOG, report);

    const summary = `${sessions.length} sessions, ${formatTokenCount(totalTokens)} tokens, ${formatCost(totalCost)} cost`;
    cronLog('usage-tracker', 'success', summary);
}

// ── Run ────────────────────────────────────────────────────────────────────────

try {
    main();
} catch (err) {
    console.error(`Fatal error: ${err.message}`);
    cronLog('usage-tracker', 'failure', err.message);
    process.exit(1);
}
