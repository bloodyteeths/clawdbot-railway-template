#!/usr/bin/env node
/**
 * eRank Client for Clawd (BelleCoutureGifts)
 * HTTP login + Puppeteer text extraction from eRank SPA pages
 *
 * Usage:
 *   node erank.cjs login                          - Login and verify session
 *   node erank.cjs keyword "search term"          - Keyword tool research
 *   node erank.cjs audit <listing_id>             - Listing audit page data
 *   node erank.cjs trending                       - Trending keywords (Trend Buzz)
 *   node erank.cjs shop [shop_name]               - Shop overview
 *   node erank.cjs health                         - Health check (listings with issues)
 *   node erank.cjs listings                       - Active listings overview
 */

const fs = require('fs');
const path = require('path');

const ERANK_EMAIL = process.env.ERANK_EMAIL;
const ERANK_PASSWORD = process.env.ERANK_PASSWORD;
const SESSION_PATH = process.env.ERANK_SESSION_PATH || '/data/workspace/erank-session.json';
const BASE_URL = 'https://members.erank.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── Cookie helpers ────────────────────────────────────────────

function parseCookies(setCookieHeaders) {
    const cookies = {};
    for (const header of (setCookieHeaders || [])) {
        const [pair] = header.split(';');
        const [name, ...valueParts] = pair.split('=');
        cookies[name.trim()] = valueParts.join('=').trim();
    }
    return cookies;
}

function cookieStr(cookies) {
    return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(existing, newHeaders) {
    const merged = { ...existing };
    if (!newHeaders) return merged;
    const headers = Array.isArray(newHeaders) ? newHeaders : [newHeaders];
    for (const header of headers) {
        const [pair] = header.split(';');
        const [name, ...valueParts] = pair.split('=');
        merged[name.trim()] = valueParts.join('=').trim();
    }
    return merged;
}

// ─── Session Management ────────────────────────────────────────

function loadSession() {
    try {
        if (fs.existsSync(SESSION_PATH)) {
            const data = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8'));
            if (data.timestamp && Date.now() - data.timestamp < 12 * 60 * 60 * 1000) {
                return data;
            }
        }
    } catch {}
    return null;
}

function saveSession(cookies) {
    const data = { cookies, timestamp: Date.now() };
    fs.mkdirSync(path.dirname(SESSION_PATH), { recursive: true });
    fs.writeFileSync(SESSION_PATH, JSON.stringify(data, null, 2));
}

// ─── Login ────────────────────────────────────────────────────

async function login(forceLogin = false) {
    if (!ERANK_EMAIL || !ERANK_PASSWORD) {
        throw new Error('ERANK_EMAIL and ERANK_PASSWORD environment variables required');
    }

    if (!forceLogin) {
        const session = loadSession();
        if (session) {
            const check = await fetch(`${BASE_URL}/dashboard`, {
                headers: { 'Cookie': cookieStr(session.cookies), 'User-Agent': UA },
                redirect: 'manual'
            });
            if (check.status === 200) {
                return session.cookies;
            }
            console.log('Saved session expired, logging in fresh...');
        }
    }

    console.log('Logging in to eRank...');

    const loginPage = await fetch(`${BASE_URL}/login`, {
        headers: { 'User-Agent': UA },
        redirect: 'manual'
    });
    let cookies = parseCookies(loginPage.headers.getSetCookie());
    const html = await loginPage.text();
    const csrfMatch = html.match(/<meta\s+name="csrf-token"\s+content="([^"]+)"/);
    if (!csrfMatch) throw new Error('Could not find CSRF token on login page');

    const loginRes = await fetch(`${BASE_URL}/login`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Cookie': cookieStr(cookies),
            'X-XSRF-TOKEN': decodeURIComponent(cookies['XSRF-TOKEN'] || ''),
            'User-Agent': UA,
            'Referer': `${BASE_URL}/login`
        },
        body: new URLSearchParams({
            _token: csrfMatch[1],
            email: ERANK_EMAIL,
            password: ERANK_PASSWORD
        }).toString(),
        redirect: 'manual'
    });

    cookies = mergeCookies(cookies, loginRes.headers.getSetCookie());

    if (loginRes.status !== 302) {
        throw new Error(`Login failed (HTTP ${loginRes.status})`);
    }

    const location = loginRes.headers.get('location') || '';
    if (location.includes('login')) {
        throw new Error('Login failed — invalid credentials');
    }

    const dashUrl = location.startsWith('/') ? `${BASE_URL}${location}` : location;
    const dashRes = await fetch(dashUrl, {
        headers: { 'Cookie': cookieStr(cookies), 'User-Agent': UA },
        redirect: 'manual'
    });
    cookies = mergeCookies(cookies, dashRes.headers.getSetCookie());

    saveSession(cookies);
    console.log('Login successful!');
    return cookies;
}

// ─── Page Data Extraction ──────────────────────────────────────

function extractWindowData(html) {
    const marker = 'window.__DATA__ = ';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;

    const start = idx + marker.length;
    let depth = 0;
    let end = start;
    for (let i = start; i < html.length; i++) {
        if (html[i] === '{' || html[i] === '[') depth++;
        if (html[i] === '}' || html[i] === ']') depth--;
        if (depth === 0) { end = i + 1; break; }
    }

    const jsonStr = html.substring(start, end);
    try {
        return JSON.parse(jsonStr);
    } catch {
        try {
            const fixed = jsonStr
                .replace(/:\s*undefined/g, ': null')
                .replace(/,\s*([}\]])/g, '$1');
            return JSON.parse(fixed);
        } catch {
            return null;
        }
    }
}

async function fetchPage(cookies, urlPath) {
    const url = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
    const res = await fetch(url, {
        headers: { 'Cookie': cookieStr(cookies), 'User-Agent': UA },
        redirect: 'follow'
    });
    return res.text();
}

// ─── Browser-based extraction (eRank is a Vue.js SPA) ─────────

const CHROME_PATH = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';

async function browserPage(cookies, urlPath, waitMs = 3000) {
    let puppeteer;
    try {
        puppeteer = require('puppeteer-core');
    } catch {
        return null;
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: CHROME_PATH,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        await page.setUserAgent(UA);

        const cookieObjects = Object.entries(cookies).map(([name, value]) => ({
            name, value,
            domain: 'members.erank.com',
            path: '/',
            secure: true
        }));
        await page.setCookie(...cookieObjects);

        const url = urlPath.startsWith('http') ? urlPath : `${BASE_URL}${urlPath}`;
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, waitMs));

        return { page, browser };
    } catch (err) {
        if (browser) await browser.close().catch(() => {});
        throw err;
    }
}

// ─── Text parsers ──────────────────────────────────────────────

function parseKeywordStats(text) {
    const result = {};
    const searches = text.match(/Avg\.\s*Searches\s*\n?\s*([\d,]+)/);
    if (searches) result.avgSearches = searches[1];
    const clicks = text.match(/Avg\.\s*Clicks\s*\n?\s*([\d,]+)/);
    if (clicks) result.avgClicks = clicks[1];
    const comp = text.match(/Etsy\s*Comp\.\s*\n?\s*([\d,]+)/);
    if (comp) result.etsyCompetition = comp[1];
    const ctr = text.match(/(\d+%)\s*\n?\s*CTR/);
    if (ctr) result.ctr = ctr[1];

    // Country breakdown (appears after "Searchers by Country" header)
    const countrySection = text.split('Searchers by Country')[1];
    if (countrySection) {
        const countries = [];
        const countryRe = /^([A-Z][a-z][\w\s]{2,20})\n(\d+\.?\d*%)/gm;
        let m;
        while ((m = countryRe.exec(countrySection)) !== null) {
            const name = m[1].trim();
            if (name.length < 25 && !name.includes('\n')) {
                countries.push({ country: name, share: m[2] });
            }
            if (countries.length >= 6) break;
        }
        if (countries.length > 0) result.searchersByCountry = countries;
    }

    return result;
}

function parseTrendBuzz(text) {
    const trending = [];
    // Pattern: number \n keyword \n month year \n searches \n change \n avgSearches \n avgClicks \n avgCTR \n etsyComp
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
        // Look for numeric index (1, 2, 3...)
        if (/^\d+$/.test(lines[i]) && i + 6 < lines.length) {
            const rank = parseInt(lines[i]);
            const keyword = lines[i + 1];
            // Skip trend chart label (e.g., "Feb 2026")
            // Find the numeric data after the keyword
            let j = i + 2;
            const nums = [];
            while (j < lines.length && nums.length < 6) {
                const val = lines[j];
                if (/^[\d,]+$/.test(val) || /^[\d,]+%$/.test(val) || val.startsWith('↑') || val.startsWith('↓') || val === '-') {
                    nums.push(val);
                }
                j++;
                if (/^\d+$/.test(lines[j]) && parseInt(lines[j]) === rank + 1) break;
            }
            if (keyword && keyword.length > 1 && keyword.length < 60) {
                const entry = { rank, keyword };
                if (nums[0]) entry.searches = nums[0];
                if (nums[1]) entry.change = nums[1];
                if (nums[2]) entry.avgSearches = nums[2];
                if (nums[3]) entry.avgClicks = nums[3];
                if (nums[4]) entry.avgCTR = nums[4];
                if (nums[5]) entry.etsyCompetition = nums[5];
                trending.push(entry);
            }
            i = j;
        } else {
            i++;
        }
    }
    return trending;
}

function parseHealthCheck(text) {
    const issues = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
        // Each listing starts with a title followed by "Listing Audit" and "Edit on Etsy"
        if (i + 1 < lines.length && lines[i + 1] === 'Listing Audit') {
            const title = lines[i];
            // Scan forward for issue counts
            let j = i + 2;
            const entry = { title, issues: [] };
            while (j < lines.length && !(j + 1 < lines.length && lines[j + 1] === 'Listing Audit')) {
                const line = lines[j];
                if (line.includes('Missing Tag')) entry.issues.push(line);
                if (line.includes('Missing Image')) entry.issues.push(line);
                if (line.includes('Spelling Issue')) entry.issues.push(line);
                if (line.includes('One-Word Tag')) entry.issues.push(line);
                if (/^\d+$/.test(line) && entry.issues.length === 0) entry.totalIssues = parseInt(line);
                j++;
            }
            if (entry.issues.length > 0 || entry.totalIssues) issues.push(entry);
            i = j;
        } else {
            i++;
        }
    }
    return issues;
}

function parseListings(text) {
    const listings = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let i = 0;
    while (i < lines.length) {
        // Listings start with a numeric index followed by title
        if (/^\d+$/.test(lines[i]) && i + 1 < lines.length) {
            const rank = parseInt(lines[i]);
            if (rank > 0 && rank < 300 && i + 2 < lines.length) {
                const title = lines[i + 1];
                if (title.length > 15 && !title.startsWith('#')) {
                    const entry = { rank, title };
                    let j = i + 2;
                    while (j < lines.length) {
                        const line = lines[j];
                        if (line === 'Track') { j++; continue; }
                        if (/^[A-F][+-]?$/.test(line)) { entry.grade = line; j++; continue; }
                        if (/^[\d,]+$/.test(line) && !entry.views) { entry.views = line; j++; continue; }
                        if (/^\d+$/.test(line) && entry.views && !entry.tagCount) { entry.tagCount = parseInt(line); j++; continue; }
                        if (/^\d+%$/.test(line)) { entry.visibility = line; j++; continue; }
                        if (/^\d+ yrs?/.test(line) || /^\d+ mos?/.test(line)) { entry.age = line; j++; continue; }
                        if (/^\d+$/.test(line) && parseInt(line) === rank + 1) break;
                        j++;
                    }
                    listings.push(entry);
                    i = j;
                    continue;
                }
            }
        }
        i++;
    }
    return listings;
}

// ─── Commands ──────────────────────────────────────────────────

async function cmdKeyword(cookies, keyword) {
    console.log(`Researching keyword: "${keyword}"\n`);

    let result;
    let fullText = '';
    try {
        const ctx = await browserPage(cookies, `/keyword-tool?keyword=${encodeURIComponent(keyword)}&country=USA&source=etsy`, 5000);
        if (!ctx) {
            console.log('Browser not available.');
            console.log('Tip: Use the keyword database in skills/etsy-seo-optimizer/keywords.md');
            return;
        }

        const { page, browser } = ctx;
        try {
            fullText = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                return main.innerText;
            });

            result = parseKeywordStats(fullText);

            if (!result.avgSearches) {
                await new Promise(r => setTimeout(r, 5000));
                fullText = await page.evaluate(() => {
                    const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                    return main.innerText;
                });
                result = parseKeywordStats(fullText);
            }
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (err) {
        console.log('Browser extraction failed:', err.message);
        console.log('Tip: Use the keyword database in skills/etsy-seo-optimizer/keywords.md');
        return;
    }

    if (result && (result.avgSearches || result.etsyCompetition)) {
        console.log('=== Keyword Statistics ===');
        console.log(JSON.stringify(result, null, 2));

        // Output related keywords table
        const kwStart = fullText.indexOf('Keywords related to');
        if (kwStart > -1) {
            console.log('\n=== Related Keywords ===');
            console.log(fullText.substring(kwStart, kwStart + 3000));
        }
    } else {
        console.log('Could not extract keyword data.');
        console.log('Tip: Use the keyword database in skills/etsy-seo-optimizer/keywords.md');
    }
}

async function cmdAudit(cookies, listingId) {
    const idMatch = listingId.match(/listing\/(\d+)/);
    if (idMatch) listingId = idMatch[1];

    console.log(`Auditing listing: ${listingId}\n`);

    let result;
    try {
        const ctx = await browserPage(cookies, `/listing-audit/${listingId}`, 5000);
        if (!ctx) {
            console.log('Browser not available. Use: etsy.sh listing ' + listingId);
            return;
        }

        const { page, browser } = ctx;
        try {
            const text = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                return main.innerText;
            });

            // Extract the full page text for the bot to analyze
            result = { rawText: text.substring(0, 8000) };
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (err) {
        console.log('Browser extraction failed:', err.message);
        console.log('Run: etsy.sh listing ' + listingId);
        return;
    }

    if (result && result.rawText) {
        console.log('=== Listing Audit ===');
        console.log(result.rawText);
    }
}

async function cmdTrending(cookies) {
    console.log('Fetching trending keywords...\n');

    let trending;
    try {
        const ctx = await browserPage(cookies, '/trend-buzz', 5000);
        if (!ctx) {
            console.log('Browser not available.');
            return;
        }

        const { page, browser } = ctx;
        try {
            const text = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                return main.innerText;
            });
            trending = parseTrendBuzz(text);
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (err) {
        console.log('Browser extraction failed:', err.message);
        return;
    }

    if (trending && trending.length > 0) {
        console.log('=== Trending Keywords (Etsy USA) ===');
        console.log('');
        for (const t of trending.slice(0, 30)) {
            const parts = [`${t.rank}. ${t.keyword}`];
            if (t.searches) parts.push(`Searches: ${t.searches}`);
            if (t.avgSearches) parts.push(`Avg: ${t.avgSearches}`);
            if (t.avgCTR) parts.push(`CTR: ${t.avgCTR}`);
            if (t.change && t.change !== '-') parts.push(`(${t.change})`);
            console.log(parts.join(' | '));
        }
    } else {
        console.log('Could not extract trending data.');
    }
}

async function cmdShop(cookies, shopName) {
    shopName = shopName || 'BelleCoutureGifts';
    console.log(`Fetching shop data: ${shopName}\n`);

    const html = await fetchPage(cookies, '/dashboard');
    const data = extractWindowData(html);

    if (data) {
        const shop = data.user?.current_shop;
        if (shop) {
            console.log('=== Shop Overview ===');
            console.log(JSON.stringify(shop, null, 2));
        }

        const { user, ...rest } = data;
        if (Object.keys(rest).length > 0) {
            console.log('\n=== Dashboard Data ===');
            console.log(JSON.stringify(rest, null, 2));
        }
    } else {
        console.log('Could not extract shop data.');
    }
}

async function cmdHealth(cookies) {
    console.log('Running health check...\n');

    let issues;
    try {
        const ctx = await browserPage(cookies, '/health-check', 5000);
        if (!ctx) {
            console.log('Browser not available.');
            return;
        }

        const { page, browser } = ctx;
        try {
            const text = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                return main.innerText;
            });
            issues = parseHealthCheck(text);
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (err) {
        console.log('Browser extraction failed:', err.message);
        return;
    }

    if (issues && issues.length > 0) {
        console.log(`=== Health Check: ${issues.length} listings with issues ===`);
        console.log('');
        for (const item of issues.slice(0, 20)) {
            console.log(`- ${item.title}`);
            if (item.totalIssues) console.log(`  Total issues: ${item.totalIssues}`);
            for (const issue of item.issues) {
                console.log(`  * ${issue}`);
            }
        }
    } else {
        console.log('No issues found (or could not extract data).');
    }
}

async function cmdListings(cookies) {
    console.log('Fetching active listings...\n');

    let listings;
    try {
        const ctx = await browserPage(cookies, '/listings/active', 5000);
        if (!ctx) {
            console.log('Browser not available.');
            return;
        }

        const { page, browser } = ctx;
        try {
            const text = await page.evaluate(() => {
                const main = document.querySelector('main') || document.querySelector('#app') || document.body;
                return main.innerText;
            });

            // Just output the structured text — the bot can parse it
            const activeMatch = text.match(/Active\s+(\d+)/);
            const draftMatch = text.match(/Draft\s+(\d+)/);
            const expiredMatch = text.match(/Expired\s+(\d+)/);

            console.log('=== Listings Summary ===');
            if (activeMatch) console.log(`Active: ${activeMatch[1]}`);
            if (draftMatch) console.log(`Draft: ${draftMatch[1]}`);
            if (expiredMatch) console.log(`Expired: ${expiredMatch[1]}`);
            console.log('');

            // Output the listing table text for the bot
            console.log('=== Listing Details ===');
            console.log(text.substring(0, 8000));
        } finally {
            await browser.close().catch(() => {});
        }
    } catch (err) {
        console.log('Browser extraction failed:', err.message);
    }
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
    const [,, command, ...args] = process.argv;

    if (!command) {
        console.log(`
eRank Client for Clawd (BelleCoutureGifts)

Usage:
  node erank.cjs login                          - Login and verify session
  node erank.cjs keyword "search term"          - Keyword tool research
  node erank.cjs audit <listing_id_or_url>      - Listing SEO audit
  node erank.cjs trending                       - Trending keywords (Trend Buzz)
  node erank.cjs shop [shop_name]               - Shop overview (default: BelleCoutureGifts)
  node erank.cjs health                         - Health check (listings with issues)
  node erank.cjs listings                       - Active listings overview

Environment variables required:
  ERANK_EMAIL    - eRank account email
  ERANK_PASSWORD - eRank account password

Examples:
  node erank.cjs keyword "personalized gift box"
  node erank.cjs audit 4448583799
  node erank.cjs audit "https://www.etsy.com/listing/4448583799"
  node erank.cjs trending
  node erank.cjs shop
  node erank.cjs health
`);
        process.exit(0);
    }

    try {
        const cookies = await login(command === 'login');

        switch (command) {
            case 'login':
                console.log('Session saved and verified');
                break;
            case 'keyword':
            case 'kw':
                if (!args[0]) throw new Error('Keyword required: node erank.cjs keyword "search term"');
                await cmdKeyword(cookies, args.join(' '));
                break;
            case 'audit':
            case 'analyze':
                if (!args[0]) throw new Error('Listing ID required: node erank.cjs audit <listing_id>');
                await cmdAudit(cookies, args[0]);
                break;
            case 'trending':
            case 'trends':
                await cmdTrending(cookies);
                break;
            case 'shop':
                await cmdShop(cookies, args[0]);
                break;
            case 'health':
            case 'health-check':
                await cmdHealth(cookies);
                break;
            case 'listings':
            case 'active':
                await cmdListings(cookies);
                break;
            default:
                console.error(`Unknown command: ${command}. Run without arguments for help.`);
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
