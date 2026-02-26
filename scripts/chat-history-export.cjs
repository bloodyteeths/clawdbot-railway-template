#!/usr/bin/env node
/**
 * Chat History Export & Summarizer
 *
 * Reads the day's chat log JSONL (captured by the message-logger hook),
 * groups by conversation, calls the Anthropic API to produce a structured
 * markdown summary, and saves it as a memory file Clawd can drill into.
 *
 * Usage:
 *   node chat-history-export.cjs                     # Summarize today
 *   node chat-history-export.cjs --date 2026-02-25   # Summarize specific date
 *   node chat-history-export.cjs --dry-run            # Preview without writing
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

const WORKSPACE = '/data/workspace';
const CHAT_LOGS_DIR = path.join(WORKSPACE, 'memory', 'chat-logs');
const SUMMARIES_DIR = path.join(WORKSPACE, 'memory', 'chat-summaries');
const LOG_DIR = path.join(WORKSPACE, 'logs');
const EXPORT_LOG = path.join(LOG_DIR, 'chat-history-export.jsonl');
const CRON_LOG = path.join(LOG_DIR, 'cron-log.jsonl');

// ── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const dateIdx = args.indexOf('--date');
const EXPLICIT_DATE = dateIdx !== -1 ? args[dateIdx + 1] : null;

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
        ...(summary ? { summary } : {})
    });
}

function todayStamp() {
    // Current date in CET/Skopje timezone
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Belgrade' });
}

function getTargetDate() {
    if (EXPLICIT_DATE) return EXPLICIT_DATE;
    return todayStamp();
}

// ── Read & Parse ───────────────────────────────────────────────────────────────

function readChatLog(dateStr) {
    const logFile = path.join(CHAT_LOGS_DIR, `${dateStr}.jsonl`);
    if (!fs.existsSync(logFile)) return [];

    return fs.readFileSync(logFile, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            try { return JSON.parse(line); }
            catch { return null; }
        })
        .filter(Boolean);
}

function groupByConversation(messages) {
    const groups = {};
    for (const msg of messages) {
        const key = msg.sessionKey || msg.conversationId ||
            `${msg.channel || 'unknown'}:${msg.from || msg.to || 'unknown'}`;
        if (!groups[key]) {
            groups[key] = {
                channel: msg.channel || 'unknown',
                participant: msg.from || msg.to || 'unknown',
                senderName: msg.senderName || null,
                messages: []
            };
        }
        groups[key].messages.push(msg);
        // Update senderName if we get one
        if (msg.senderName && !groups[key].senderName) {
            groups[key].senderName = msg.senderName;
        }
    }
    return groups;
}

// ── Transcript Builder ─────────────────────────────────────────────────────────

function buildTranscript(groups) {
    const parts = [];

    for (const [key, group] of Object.entries(groups)) {
        const label = group.senderName || group.participant;
        parts.push(`--- Conversation: ${label} (${group.channel}) ---`);

        for (const msg of group.messages) {
            const time = msg.ts ? new Date(msg.ts).toLocaleTimeString('en-GB', {
                timeZone: 'Europe/Belgrade',
                hour: '2-digit',
                minute: '2-digit'
            }) : '??:??';

            const sender = msg.event === 'received'
                ? (msg.senderName || msg.from || 'User')
                : 'Clawd';

            const content = msg.content || '[media/no content]';
            parts.push(`[${time}] ${sender}: ${content}`);
        }

        parts.push('');
    }

    return parts.join('\n');
}

// ── Anthropic API ──────────────────────────────────────────────────────────────

async function summarize(transcript, dateStr) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

    const systemPrompt = `You are a conversation summarizer for a personal AI assistant called Clawd.
Your job is to create structured summaries of daily conversations between Clawd and its users (Atilla and Merisa).

Output a Markdown document with these sections:

## Chat Summary - ${dateStr}

### Conversations
For each distinct conversation thread:
- **Participants**: Who was involved
- **Channel**: WhatsApp/Telegram/Slack
- **Time**: Start-end timestamps
- **Topics discussed**: Brief bullet list
- **Language**: Primary language used (Turkish/Macedonian/English)

### Key Decisions Made
- Bullet points of any decisions, approvals, or commitments

### Action Items & Tasks
- Tasks assigned or mentioned (with who and deadline if stated)

### Important Facts Learned
- New business data, contacts, preferences, or personal details mentioned
- Prices, deadlines, metrics worth remembering

### Follow-ups Needed
- Anything left unresolved or promised for later

### Notable Exchanges
- Key quotes or exchanges the user might reference later (with context)

Rules:
- Be concise but specific. Use dates, numbers, names.
- Preserve language context (note if conversations were in Turkish, Bosnian, Macedonian, etc.)
- Focus on information that would help Clawd remember context in future sessions
- If a conversation is mundane/transient (weather check, greeting), summarize in one line
- If no meaningful conversations occurred, say so briefly
- Include any emotional context (was the user frustrated, happy, stressed?)`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: systemPrompt,
                messages: [{
                    role: 'user',
                    content: `Here are today's conversations (${dateStr}):\n\n${transcript}`
                }]
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Anthropic API error ${response.status}: ${errText}`);
        }

        const result = await response.json();
        return result.content[0].text;
    } finally {
        clearTimeout(timeout);
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
    cronLog('chat-history-export', 'start');

    const dateStr = getTargetDate();
    console.log(`[chat-history-export] Processing date: ${dateStr}`);
    if (DRY_RUN) console.log('(DRY RUN -- will not write summary)\n');

    // Read chat log
    const messages = readChatLog(dateStr);

    if (messages.length === 0) {
        const msg = `No chat messages found for ${dateStr}.`;
        console.log(msg);

        // Write minimal summary so the index stays consistent
        if (!DRY_RUN) {
            ensureDir(SUMMARIES_DIR);
            const minimalSummary = `## Chat Summary - ${dateStr}\n\nNo conversations recorded on this date.\n`;
            fs.writeFileSync(path.join(SUMMARIES_DIR, `${dateStr}.md`), minimalSummary, 'utf8');
        }

        cronLog('chat-history-export', 'success', msg);
        process.exit(0);
    }

    console.log(`Found ${messages.length} messages.`);

    // Group by conversation
    const groups = groupByConversation(messages);
    const convCount = Object.keys(groups).length;
    console.log(`Grouped into ${convCount} conversation(s).`);

    // Build transcript
    let transcript = buildTranscript(groups);

    // Truncate if too large (>200 messages worth, ~50K chars)
    if (transcript.length > 50000) {
        console.log(`Transcript too large (${transcript.length} chars), truncating to last 50K chars...`);
        transcript = '... [earlier messages truncated] ...\n\n' + transcript.slice(-50000);
    }

    if (DRY_RUN) {
        console.log('='.repeat(60));
        console.log('TRANSCRIPT PREVIEW:');
        console.log(transcript.slice(0, 2000));
        if (transcript.length > 2000) console.log(`\n... (${transcript.length - 2000} more chars)`);
        console.log('='.repeat(60));
        cronLog('chat-history-export', 'success', `DRY RUN: ${messages.length} messages, ${convCount} conversations`);
        process.exit(0);
    }

    // Summarize with Claude
    console.log('Calling Anthropic API for summarization...');
    let summaryMd;
    try {
        summaryMd = await summarize(transcript, dateStr);
    } catch (err) {
        const errMsg = `API summarization failed: ${err.message}`;
        console.error(errMsg);
        cronLog('chat-history-export', 'failure', errMsg);
        process.exit(1);
    }

    // Write summary
    ensureDir(SUMMARIES_DIR);
    const outFile = path.join(SUMMARIES_DIR, `${dateStr}.md`);
    fs.writeFileSync(outFile, summaryMd, 'utf8');
    console.log(`Summary written to ${outFile}`);

    // Log result
    appendJsonl(EXPORT_LOG, {
        timestamp: isoNow(),
        date: dateStr,
        messageCount: messages.length,
        conversationCount: convCount,
        summaryChars: summaryMd.length,
        status: 'success'
    });

    const summary = `Summarized ${messages.length} messages from ${convCount} conversations (${dateStr})`;
    console.log(summary);
    cronLog('chat-history-export', 'success', summary);
}

// ── Run ────────────────────────────────────────────────────────────────────────

main().catch(err => {
    console.error(`Fatal error: ${err.message}`);
    cronLog('chat-history-export', 'failure', err.message);
    process.exit(1);
});
