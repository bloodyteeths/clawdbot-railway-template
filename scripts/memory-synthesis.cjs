#!/usr/bin/env node
/**
 * Memory Synthesis - Weekly memory note consolidation for Clawd
 *
 * Reads daily memory notes (memory/2026-*.md) and synthesizes them into
 * categorized updates that can be merged into MEMORY.md.
 *
 * Usage:
 *   node memory-synthesis.cjs                    - Synthesize all unprocessed daily notes
 *   node memory-synthesis.cjs --dry-run          - Preview without archiving
 *   node memory-synthesis.cjs --since 2026-02-01 - Only process notes after this date
 *
 * Output:
 *   - Synthesized summary to stdout
 *   - Appends to /data/workspace/logs/memory-synthesis.jsonl
 *   - Archives processed notes to memory/archive/
 *
 * Cron: Weekly (e.g., Sunday midnight)
 */

const fs = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────────

const WORKSPACE = '/data/workspace';
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const ARCHIVE_DIR = path.join(MEMORY_DIR, 'archive');
const MEMORY_MD = path.join(WORKSPACE, 'MEMORY.md');
const LOG_DIR = path.join(WORKSPACE, 'logs');
const SYNTHESIS_LOG = path.join(LOG_DIR, 'memory-synthesis.jsonl');
const CRON_LOG = path.join(LOG_DIR, 'cron-log.jsonl');

// ── CLI Args ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const SINCE_DATE = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

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

// ── Section keywords for categorization ────────────────────────────────────────

const CATEGORY_PATTERNS = {
    'Business Updates': [
        /\b(revenue|sales|orders?|customers?|MRR|ARR|churn|growth|launch|shipped|deployed|released)\b/i,
        /\b(etsy|trendyol|facturino|nabavkidata|bellecouture|kolayxport|shopify)\b/i,
        /\b(traffic|conversion|impressions|clicks|views|visits)\b/i,
        /\b(leads?|outreach|pipeline|investors?|funding|pitch)\b/i,
    ],
    'Decisions Made': [
        /\b(decided|decision|chose|chosen|agreed|confirmed|approved|switched|pivot)\b/i,
        /\b(will use|going with|opted for|settled on|committed to)\b/i,
        /\b(policy|rule|standard|convention|approach)\b/i,
    ],
    'Lessons Learned': [
        /\b(learned|lesson|mistake|realized|discovered|turns out|note to self)\b/i,
        /\b(don'?t|never|always|important|careful|gotcha|caveat|warning)\b/i,
        /\b(workaround|fix|solution|solved|root cause)\b/i,
    ],
    'Status Changes': [
        /\b(status|updated?|changed?|moved?|migrated?|upgraded?|downgraded?)\b/i,
        /\b(started|stopped|paused|resumed|completed|finished|done)\b/i,
        /\b(enabled|disabled|configured|installed|removed|added)\b/i,
        /\b(broken|fixed|working|down|up|live|offline)\b/i,
    ],
};

// ── Core Logic ─────────────────────────────────────────────────────────────────

/**
 * Find all daily note files matching the 2026-*.md pattern.
 * Returns sorted list of { file, date, fullPath }.
 */
function findDailyNotes() {
    if (!fs.existsSync(MEMORY_DIR)) {
        return [];
    }

    const files = fs.readdirSync(MEMORY_DIR).filter(f => {
        // Match pattern: 2026-MM-DD.md (or any year starting with 20)
        if (!/^20\d{2}-\d{2}-\d{2}\.md$/.test(f)) return false;

        // Apply --since filter if provided
        if (SINCE_DATE) {
            const fileDate = f.replace('.md', '');
            return fileDate >= SINCE_DATE;
        }
        return true;
    });

    return files
        .sort()
        .map(f => ({
            file: f,
            date: f.replace('.md', ''),
            fullPath: path.join(MEMORY_DIR, f),
        }));
}

/**
 * Parse a daily note file into an array of bullet points / sections.
 * Extracts headings and their content.
 */
function parseDailyNote(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const entries = [];

    let currentSection = 'General';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Detect markdown headings
        const headingMatch = trimmed.match(/^#{1,4}\s+(.+)/);
        if (headingMatch) {
            currentSection = headingMatch[1].trim();
            continue;
        }

        // Detect bullet points (-, *, or numbered)
        const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
        const numberedMatch = trimmed.match(/^\d+[.)]\s+(.+)/);

        if (bulletMatch || numberedMatch) {
            const text = (bulletMatch ? bulletMatch[1] : numberedMatch[1]).trim();
            entries.push({
                section: currentSection,
                text,
                raw: trimmed,
            });
        } else if (!headingMatch) {
            // Plain text paragraph -- treat as entry
            entries.push({
                section: currentSection,
                text: trimmed,
                raw: trimmed,
            });
        }
    }

    return entries;
}

/**
 * Categorize an entry based on keyword matching.
 * Returns the best-matching category or 'Uncategorized'.
 */
function categorize(entry) {
    let bestCategory = 'Uncategorized';
    let bestScore = 0;

    for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
        let score = 0;
        for (const pattern of patterns) {
            if (pattern.test(entry.text)) {
                score++;
            }
        }
        // Also check the section header for hints
        if (category === 'Lessons Learned' && /lesson|learn|note/i.test(entry.section)) {
            score += 2;
        }
        if (category === 'Decisions Made' && /decision|decide/i.test(entry.section)) {
            score += 2;
        }
        if (category === 'Status Changes' && /status|update|change/i.test(entry.section)) {
            score += 2;
        }
        if (category === 'Business Updates' && /business|sales|etsy|trendyol|facturino/i.test(entry.section)) {
            score += 2;
        }

        if (score > bestScore) {
            bestScore = score;
            bestCategory = category;
        }
    }

    return bestCategory;
}

/**
 * Deduplicate entries by checking for high text overlap.
 * Simple approach: skip if >80% of words match an existing entry.
 */
function deduplicateEntries(entries) {
    const unique = [];

    for (const entry of entries) {
        const words = new Set(entry.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        let isDupe = false;

        for (const existing of unique) {
            const existingWords = new Set(existing.text.toLowerCase().split(/\s+/).filter(w => w.length > 3));
            if (words.size === 0 || existingWords.size === 0) continue;

            let overlap = 0;
            for (const w of words) {
                if (existingWords.has(w)) overlap++;
            }
            const ratio = overlap / Math.min(words.size, existingWords.size);
            if (ratio > 0.8) {
                isDupe = true;
                break;
            }
        }

        if (!isDupe) {
            unique.push(entry);
        }
    }

    return unique;
}

/**
 * Build the synthesized markdown output.
 */
function buildSynthesis(categorized, dateRange, noteCount) {
    const lines = [];
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });

    lines.push(`## Memory Synthesis -- ${dateStr}`);
    lines.push(`> Synthesized from ${noteCount} daily note(s) (${dateRange.start} to ${dateRange.end})`);
    lines.push('');

    const categoryOrder = ['Business Updates', 'Decisions Made', 'Lessons Learned', 'Status Changes', 'Uncategorized'];

    for (const category of categoryOrder) {
        const entries = categorized[category];
        if (!entries || entries.length === 0) continue;

        lines.push(`### ${category}`);

        // Group by source date for context
        const byDate = {};
        for (const entry of entries) {
            if (!byDate[entry.sourceDate]) {
                byDate[entry.sourceDate] = [];
            }
            byDate[entry.sourceDate].push(entry);
        }

        for (const [date, dateEntries] of Object.entries(byDate).sort()) {
            for (const entry of dateEntries) {
                lines.push(`- ${entry.text} *(${date})*`);
            }
        }

        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Archive processed daily notes by moving them to the archive directory.
 */
function archiveNotes(notes) {
    if (DRY_RUN) return;

    ensureDir(ARCHIVE_DIR);

    for (const note of notes) {
        const dest = path.join(ARCHIVE_DIR, note.file);
        try {
            fs.renameSync(note.fullPath, dest);
        } catch (err) {
            // If rename fails (cross-device), copy + delete
            try {
                fs.copyFileSync(note.fullPath, dest);
                fs.unlinkSync(note.fullPath);
            } catch (copyErr) {
                console.error(`Failed to archive ${note.file}: ${copyErr.message}`);
            }
        }
    }
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
    cronLog('memory-synthesis', 'start');

    const notes = findDailyNotes();

    if (notes.length === 0) {
        const msg = 'No daily notes found to synthesize.';
        console.log(msg);
        cronLog('memory-synthesis', 'success', msg);
        process.exit(0);
    }

    console.log(`Found ${notes.length} daily note(s) to process.`);
    if (DRY_RUN) {
        console.log('(DRY RUN -- will not archive notes)\n');
    }

    // Read current MEMORY.md for reference (not modified by this script)
    let currentMemory = '';
    if (fs.existsSync(MEMORY_MD)) {
        currentMemory = fs.readFileSync(MEMORY_MD, 'utf8');
    }

    // Parse all daily notes
    const allEntries = [];
    for (const note of notes) {
        try {
            const entries = parseDailyNote(note.fullPath);
            for (const entry of entries) {
                entry.sourceDate = note.date;
                entry.sourceFile = note.file;
            }
            allEntries.push(...entries);
        } catch (err) {
            console.error(`Error parsing ${note.file}: ${err.message}`);
        }
    }

    if (allEntries.length === 0) {
        const msg = `Parsed ${notes.length} note(s) but found no extractable entries.`;
        console.log(msg);
        cronLog('memory-synthesis', 'success', msg);
        process.exit(0);
    }

    console.log(`Extracted ${allEntries.length} entries from daily notes.`);

    // Categorize entries
    const categorized = {};
    for (const entry of allEntries) {
        const category = categorize(entry);
        entry.category = category;
        if (!categorized[category]) {
            categorized[category] = [];
        }
        categorized[category].push(entry);
    }

    // Deduplicate within each category
    for (const category of Object.keys(categorized)) {
        categorized[category] = deduplicateEntries(categorized[category]);
    }

    // Count total after dedup
    const totalUnique = Object.values(categorized).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`After deduplication: ${totalUnique} unique entries.\n`);

    // Build synthesis
    const dateRange = {
        start: notes[0].date,
        end: notes[notes.length - 1].date,
    };
    const synthesis = buildSynthesis(categorized, dateRange, notes.length);

    // Output to stdout
    console.log('='.repeat(60));
    console.log(synthesis);
    console.log('='.repeat(60));

    // Write to synthesis log (JSONL)
    const logEntry = {
        timestamp: isoNow(),
        dateRange,
        noteCount: notes.length,
        entryCount: allEntries.length,
        uniqueEntryCount: totalUnique,
        categories: {},
        synthesis,
    };
    for (const [cat, entries] of Object.entries(categorized)) {
        logEntry.categories[cat] = entries.map(e => ({
            text: e.text,
            sourceDate: e.sourceDate,
        }));
    }
    appendJsonl(SYNTHESIS_LOG, logEntry);

    // Archive processed notes
    archiveNotes(notes);

    const summary = `Synthesized ${totalUnique} entries from ${notes.length} notes (${dateRange.start} to ${dateRange.end})` +
        (DRY_RUN ? ' [DRY RUN]' : `, archived to memory/archive/`);
    console.log(`\n${summary}`);
    cronLog('memory-synthesis', 'success', summary);
}

// ── Run ────────────────────────────────────────────────────────────────────────

try {
    main();
} catch (err) {
    console.error(`Fatal error: ${err.message}`);
    cronLog('memory-synthesis', 'failure', err.message);
    process.exit(1);
}
