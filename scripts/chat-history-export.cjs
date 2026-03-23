#!/usr/bin/env node
/**
 * Chat History Export & Summarizer
 *
 * Reads session JSONL files from /data/.clawdbot/agents/main/sessions/,
 * extracts user/assistant messages for the target date, calls the OpenClaw
 * gateway to produce a structured markdown summary, and saves it.
 *
 * Usage:
 *   node chat-history-export.cjs                     # Summarize today
 *   node chat-history-export.cjs --date 2026-02-25   # Summarize specific date
 *   node chat-history-export.cjs --dry-run            # Preview without writing
 *   node chat-history-export.cjs --skip-existing      # Skip if summary exists
 *
 * Output:
 *   - /data/workspace/memory/chat-summaries/YYYY-MM-DD.md
 *   - /data/workspace/logs/chat-history-export.jsonl
 *   - /data/workspace/logs/cron-log.jsonl
 *
 * Cron: Daily at 23:50 CET
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────

const SESSIONS_DIR = '/data/.clawdbot/agents/main/sessions';
const SUMMARIES_DIR = '/data/workspace/memory/chat-summaries';
const LOG_DIR = '/data/workspace/logs';
const EXPORT_LOG = path.join(LOG_DIR, 'chat-history-export.jsonl');
const CRON_LOG = path.join(LOG_DIR, 'cron-log.jsonl');

// ── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const dateIdx = args.indexOf('--date');
const EXPLICIT_DATE = dateIdx !== -1 ? args[dateIdx + 1] : null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
        job, status, timestamp: isoNow(),
        ...(summary ? { summary } : {})
    });
}

function toDateStr(ts) {
    const d = new Date(typeof ts === 'number' ? ts : ts);
    return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });
}

function todayStamp() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });
}

function getTargetDate() {
    if (EXPLICIT_DATE) return EXPLICIT_DATE;
    return todayStamp();
}

// ── Extract Messages from Session JSONL ─────────────────────────────────────

function extractMessages(filePath, targetDate) {
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

                // Only user and assistant text messages
                if (msg.role === 'user' || msg.role === 'assistant') {
                    // Check date matches
                    const msgDate = toDateStr(d.timestamp);
                    if (msgDate !== targetDate) continue;

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
                    // Truncate very long messages (tool outputs etc)
                    if (text.length > 5000) text = text.slice(0, 5000) + '\n... [truncated]';

                    messages.push({
                        timestamp: d.timestamp,
                        role: msg.role,
                        text
                    });
                }
            } catch {}
        }
    } catch {}
    return messages;
}

// ── Summarize via OpenClaw Gateway ─────────────────────────────────────────────

function getGatewayToken() {
    const tokenPath = '/data/.clawdbot/gateway.token';
    if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
    throw new Error('Gateway token not found at ' + tokenPath);
}

async function summarize(transcript, dateStr) {
    const gwToken = getGatewayToken();
    const sessionKey = `hook:chat-summary-${dateStr}`;

    const prompt = `You are a conversation summarizer. Create a structured summary of these conversations from ${dateStr}.

Output Markdown with these sections:
## Chat Summary - ${dateStr}
### Conversations (topics, participants, channel, language used)
### Key Decisions Made
### Action Items & Tasks
### Important Facts Learned (business data, contacts, preferences, deadlines)
### Follow-ups Needed
### Notable Exchanges (quotes user might reference later)

Rules: Be concise but specific. Use dates, numbers, names. Note language (Turkish/Macedonian/English). Skip mundane exchanges. Focus on what Clawd should remember.

Here are the conversations:

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
            return await pollForResult(sessionKey);
        }
        if (result.response) return result.response;
        throw new Error('Unexpected response: ' + JSON.stringify(result).slice(0, 200));
    } finally {
        clearTimeout(timeout);
    }
}

async function pollForResult(sessionKey) {
    const maxWait = 120000;
    const pollInterval = 5000;
    const start = Date.now();
    const sessionsJson = path.join(SESSIONS_DIR, 'sessions.json');

    while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, pollInterval));

        try {
            const store = JSON.parse(fs.readFileSync(sessionsJson, 'utf8'));
            const fullKey = `agent:main:${sessionKey}`;
            const entry = store[fullKey];
            if (!entry || !entry.sessionId) continue;

            const sessionFile = path.join(SESSIONS_DIR, `${entry.sessionId}.jsonl`);
            if (!fs.existsSync(sessionFile)) continue;

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
    cronLog('chat-history-export', 'start');

    const dateStr = getTargetDate();
    console.log(`[chat-history-export] Processing date: ${dateStr}`);
    if (DRY_RUN) console.log('(DRY RUN -- will not write summary)\n');

    // Check if summary already exists
    const outFile = path.join(SUMMARIES_DIR, `${dateStr}.md`);
    if (SKIP_EXISTING && fs.existsSync(outFile)) {
        const msg = `Summary already exists for ${dateStr}, skipping`;
        console.log(msg);
        cronLog('chat-history-export', 'success', msg);
        process.exit(0);
    }

    // Read all session JSONL files and extract messages for target date
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.jsonl'));
    console.log(`Scanning ${files.length} session files...`);

    const allMessages = [];
    for (const file of files) {
        const msgs = extractMessages(path.join(SESSIONS_DIR, file), dateStr);
        allMessages.push(...msgs);
    }

    if (allMessages.length === 0) {
        const msg = `No chat messages found for ${dateStr}.`;
        console.log(msg);

        if (!DRY_RUN) {
            ensureDir(SUMMARIES_DIR);
            const minimalSummary = `## Chat Summary - ${dateStr}\n\nNo conversations recorded on this date.\n`;
            fs.writeFileSync(outFile, minimalSummary, 'utf8');
        }

        cronLog('chat-history-export', 'success', msg);
        process.exit(0);
    }

    console.log(`Found ${allMessages.length} messages for ${dateStr}.`);

    // Sort by timestamp and build transcript
    allMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let transcript = allMessages.map(m => {
        const time = new Date(m.timestamp).toLocaleTimeString('en-GB', {
            timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit'
        });
        const role = m.role === 'user' ? 'User' : 'Clawd';
        return `[${time}] ${role}: ${m.text}`;
    }).join('\n\n');

    // Truncate if too large
    if (transcript.length > 80000) {
        console.log(`Transcript too large (${transcript.length} chars), truncating...`);
        transcript = '... [earlier truncated] ...\n\n' + transcript.slice(-80000);
    }

    if (DRY_RUN) {
        console.log('='.repeat(60));
        console.log('TRANSCRIPT PREVIEW:');
        console.log(transcript.slice(0, 2000));
        if (transcript.length > 2000) console.log(`\n... (${transcript.length - 2000} more chars)`);
        console.log('='.repeat(60));
        cronLog('chat-history-export', 'success', `DRY RUN: ${allMessages.length} messages`);
        process.exit(0);
    }

    // Summarize via gateway
    console.log('Calling OpenClaw gateway for summarization...');
    let summaryMd;
    try {
        summaryMd = await summarize(transcript, dateStr);
    } catch (err) {
        const errMsg = `Summarization failed: ${err.message}`;
        console.error(errMsg);
        cronLog('chat-history-export', 'failure', errMsg);
        process.exit(1);
    }

    // Write summary
    ensureDir(SUMMARIES_DIR);
    fs.writeFileSync(outFile, summaryMd, 'utf8');
    console.log(`Summary written to ${outFile}`);

    // Log result
    appendJsonl(EXPORT_LOG, {
        timestamp: isoNow(),
        date: dateStr,
        messageCount: allMessages.length,
        summaryChars: summaryMd.length,
        status: 'success'
    });

    const summary = `Summarized ${allMessages.length} messages (${dateStr})`;
    console.log(summary);
    cronLog('chat-history-export', 'success', summary);
}

// ── Run ────────────────────────────────────────────────────────────────────────

main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    cronLog('chat-history-export', 'failure', err.message);
    process.exit(1);
});
