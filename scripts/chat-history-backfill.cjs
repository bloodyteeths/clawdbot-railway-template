#!/usr/bin/env node
/**
 * Chat History Backfill - One-time script to process old session JSONL files
 * into daily chat summaries.
 *
 * Reads all session JSONL files from /data/.clawdbot/agents/main/sessions/,
 * extracts user/assistant messages, groups by date, and calls the Anthropic API
 * to produce structured summaries for each day.
 *
 * Usage:
 *   node chat-history-backfill.cjs                    # Process all sessions
 *   node chat-history-backfill.cjs --dry-run          # Preview without API calls
 *   node chat-history-backfill.cjs --date 2026-02-25  # Process specific date only
 *   node chat-history-backfill.cjs --skip-existing    # Skip dates that already have summaries
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────

const SESSIONS_DIR = '/data/.clawdbot/agents/main/sessions';
const SUMMARIES_DIR = '/data/workspace/memory/chat-summaries';
const LOG_DIR = '/data/workspace/logs';

// ── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const dateIdx = args.indexOf('--date');
const ONLY_DATE = dateIdx !== -1 ? args[dateIdx + 1] : null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toDateStr(ts) {
    // Convert timestamp to YYYY-MM-DD in CET
    const d = new Date(typeof ts === 'number' ? ts : ts);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });
}

// ── Parse Sessions ─────────────────────────────────────────────────────────────

function extractMessages(filePath) {
    const messages = [];
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                const d = JSON.parse(line);
                if (d.type !== 'message') continue;
                const msg = d.message;
                if (!msg) continue;

                // Only user and assistant text messages (skip tool calls, thinking)
                if (msg.role === 'user' || msg.role === 'assistant') {
                    let text = '';
                    if (Array.isArray(msg.content)) {
                        for (const block of msg.content) {
                            if (block.type === 'text' && block.text) {
                                text += block.text + '\n';
                            }
                        }
                    } else if (typeof msg.content === 'string') {
                        text = msg.content;
                    }

                    text = text.trim();
                    if (!text) continue;
                    // Skip system/cron messages that are very long (tool outputs etc)
                    if (text.length > 5000) text = text.slice(0, 5000) + '\n... [truncated]';

                    messages.push({
                        timestamp: d.timestamp,
                        date: toDateStr(d.timestamp),
                        role: msg.role,
                        text
                    });
                }
            } catch {}
        }
    } catch (err) {
        console.error(`  Error reading ${path.basename(filePath)}: ${err.message}`);
    }
    return messages;
}

// ── Summarize via OpenClaw Gateway ─────────────────────────────────────────────

function getGatewayToken() {
    const tokenPath = '/data/.clawdbot/gateway.token';
    if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
    throw new Error('Gateway token not found');
}

async function summarize(transcript, dateStr) {
    const gwToken = getGatewayToken();
    const sessionKey = `hook:chat-backfill-${dateStr}`;

    const prompt = `You are a conversation summarizer. Create a structured markdown summary of these conversations from ${dateStr}.

Sections: ## Chat Summary - ${dateStr} / ### Conversations (topics, language) / ### Key Decisions Made / ### Action Items & Tasks / ### Important Facts Learned / ### Follow-ups Needed

Rules: Be concise, use names/numbers/dates. Note language (Turkish/Macedonian/English). Skip cron/automated messages. Focus on human conversations.

Conversations:

${transcript}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    try {
        const response = await fetch('http://127.0.0.1:18789/hooks/agent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-openclaw-token': gwToken
            },
            body: JSON.stringify({
                message: prompt,
                sessionKey,
                model: 'claude-sonnet-4-20250514'
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gateway error ${response.status}: ${errText.slice(0, 200)}`);
        }

        const result = await response.json();

        if (result.runId || result.ok) {
            return await pollForResult(sessionKey, dateStr);
        }
        if (result.response) return result.response;
        throw new Error('Unexpected response: ' + JSON.stringify(result).slice(0, 200));
    } finally {
        clearTimeout(timeout);
    }
}

async function pollForResult(sessionKey, dateStr) {
    const maxWait = 120000;
    const pollInterval = 5000;
    const start = Date.now();
    const sessionsJson = '/data/.clawdbot/agents/main/sessions/sessions.json';
    const sessionsDir = '/data/.clawdbot/agents/main/sessions';

    while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));

        // Look up the sessionId from sessions.json by our session key
        try {
            const store = JSON.parse(fs.readFileSync(sessionsJson, 'utf8'));
            const fullKey = `agent:main:${sessionKey}`;
            const entry = store[fullKey];
            if (!entry || !entry.sessionId) continue;

            const sessionFile = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
            if (!fs.existsSync(sessionFile)) continue;

            // Read the last assistant text message
            const lines = fs.readFileSync(sessionFile, 'utf8').trim().split('\n');
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const d = JSON.parse(lines[i]);
                    if (d.type === 'message' && d.message?.role === 'assistant') {
                        let text = '';
                        const content = d.message.content;
                        if (Array.isArray(content)) {
                            for (const block of content) {
                                if (block.type === 'text') text += block.text;
                            }
                        } else if (typeof content === 'string') {
                            text = content;
                        }
                        if (text && text.length > 50) return text;
                    }
                } catch {}
            }
        } catch {}
    }
    throw new Error(`Timed out waiting for summary (${sessionKey})`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
    console.log('=== Chat History Backfill ===\n');

    // Read all session JSONL files
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    console.log(`Found ${files.length} session files (${SESSIONS_DIR})`);

    // Extract all messages from all sessions
    const allMessages = [];
    let processed = 0;
    for (const file of files) {
        const msgs = extractMessages(path.join(SESSIONS_DIR, file));
        allMessages.push(...msgs);
        processed++;
        if (processed % 50 === 0) console.log(`  Parsed ${processed}/${files.length} files...`);
    }
    console.log(`\nExtracted ${allMessages.length} messages total`);

    // Group by date
    const byDate = {};
    for (const msg of allMessages) {
        if (!byDate[msg.date]) byDate[msg.date] = [];
        byDate[msg.date].push(msg);
    }

    const dates = Object.keys(byDate).sort();
    console.log(`Messages span ${dates.length} days: ${dates[0]} to ${dates[dates.length - 1]}\n`);

    // Filter
    const targetDates = ONLY_DATE ? [ONLY_DATE] : dates;
    ensureDir(SUMMARIES_DIR);

    let summarized = 0;
    let skipped = 0;

    for (const dateStr of targetDates) {
        if (!byDate[dateStr]) {
            console.log(`[${dateStr}] No messages found, skipping`);
            skipped++;
            continue;
        }

        const outFile = path.join(SUMMARIES_DIR, `${dateStr}.md`);
        if (SKIP_EXISTING && fs.existsSync(outFile)) {
            console.log(`[${dateStr}] Summary exists, skipping`);
            skipped++;
            continue;
        }

        const msgs = byDate[dateStr];
        // Build transcript
        const transcript = msgs
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
            .map(m => {
                const time = new Date(m.timestamp).toLocaleTimeString('en-GB', {
                    timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit'
                });
                const role = m.role === 'user' ? 'User' : 'Clawd';
                return `[${time}] ${role}: ${m.text}`;
            })
            .join('\n\n');

        // Truncate if huge
        const finalTranscript = transcript.length > 80000
            ? '... [earlier truncated] ...\n\n' + transcript.slice(-80000)
            : transcript;

        console.log(`[${dateStr}] ${msgs.length} messages, ${finalTranscript.length} chars`);

        if (DRY_RUN) {
            console.log(`  (dry-run) Would summarize and write to ${outFile}`);
            continue;
        }

        try {
            const summary = await summarize(finalTranscript, dateStr);
            fs.writeFileSync(outFile, summary, 'utf8');
            console.log(`  -> Saved ${outFile}`);
            summarized++;
            // Small delay between API calls
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            console.error(`  ERROR: ${err.message}`);
        }
    }

    console.log(`\nDone! Summarized: ${summarized}, Skipped: ${skipped}`);
}

main().catch(err => {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
});
