# PRD.md -- Clawd VA: Product Requirements Document

> **Single source of truth** for the Clawd virtual assistant workspace.
> Last updated: 2026-02-19

---

## 1. Architecture Overview

```
                          Internet
                             |
                    +--------+--------+
                    |   Railway.app   |
                    |  (Docker host)  |
                    +--------+--------+
                             |
                     :8080 (public)
                             |
                +------------+-------------+
                |  Express Wrapper Server  |
                |  (src/server.js)         |
                |  - /setup (admin UI)     |
                |  - /setup/healthz        |
                |  - /setup/etsy/*  OAuth  |
                |  - /setup/api/*  exec    |
                |  - /setup/whatsapp-qr    |
                +------------+-------------+
                             |
                     proxy (all other routes)
                             |
                     :18789 (loopback)
                             |
                +------------+-------------+
                |  OpenClaw Gateway        |
                |  (clawdbot v2026.2.9)    |
                |  - Claude Opus 4 model   |
                |  - Tool execution        |
                |  - Session management    |
                |  - Cron scheduler        |
                +------------+-------------+
                        |    |    |
               +--------+   |   +--------+
               |             |            |
          Telegram      WhatsApp       Slack
         @biberovic_bot  +905425...   workspace

Persistent volumes:
  /data/.clawdbot/       Config, sessions, gateway token
  /data/workspace/       Memory, scripts, logs, cron state
```

### Container Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Init | tini | Reaps zombie processes from Chromium |
| Entrypoint | scripts/entrypoint.sh | gog auth, symlinks, then node |
| Wrapper | Express 5 + http-proxy | Port 8080, basic auth on /setup |
| Gateway | OpenClaw (Clawdbot) | Port 18789, token auth |
| Runtime | Node 24 (Bookworm) | ESM, puppeteer-core, tar |
| Browser | Chromium + Playwright | Headless, no-sandbox |
| Python | uv + python3 | For Gemini image generation |
| CLI | gog, jq, ffmpeg, curl | Google Workspace, media, HTTP |

---

## 2. OpenClaw Platform Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Model | Claude (Anthropic API key) | via `ANTHROPIC_API_KEY` |
| Auth | `apiKey` | Anthropic API key flow |
| Gateway bind | loopback | Wrapper proxies externally |
| Gateway port | 18789 | Internal only |
| Gateway auth | token | Stable across restarts |
| Workspace | /data/workspace | Persistent Railway volume |
| State dir | /data/.clawdbot | Config, sessions, gateway.token |
| DM policy | open | No pairing required for new contacts |
| Group policy | open + requireMention | Must @mention bot in groups |
| Stream mode | partial | Telegram uses partial streaming |

### Channels

| Channel | Status | Identifier | DM Policy | Group Policy |
|---------|--------|-----------|-----------|-------------|
| Telegram | Active | @biberovic_bot | open | requireMention |
| WhatsApp | Active | +905425683362 | open | requireMention |
| Slack | Active | Bot + App tokens | open | requireMention |

### Context & Compaction

The gateway manages conversation context automatically. Sessions compact when they approach the context window limit. Key behavior:

- Each channel+user combination gets its own session
- Sessions persist across restarts in `/data/.clawdbot/`
- CLAUDE.md (tools prompt) is copied to workspace at startup as the system prompt
- Memory files (MEMORY.md, USER.md, etc.) are read by the agent during sessions

---

## 3. Scripts & Automations

### E-Commerce Scripts (via KolayXport proxy)

| Script | Path | Language | Purpose |
|--------|------|----------|---------|
| etsy.sh | /app/scripts/etsy.sh | Bash | Full Etsy API: orders, listings, images, video, personalization, publishing |
| trendyol.sh | /app/scripts/trendyol.sh | Bash | Full Trendyol API: products, orders, shipment, returns, Q&A, finance |
| kolayxport.sh | /app/scripts/kolayxport.sh | Bash | Legacy KolayXport orders (Trendyol) |
| shopify.sh | /app/scripts/shopify.sh | Bash | Shopify Admin API: products, orders, customers, inventory, collections |
| shopify.cjs | /app/scripts/shopify.cjs | Node.js | Shopify helper library (used by shopify.sh) |
| pinterest.sh | /app/scripts/pinterest.sh | Bash | Pinterest pin creation via Make.com webhooks |

### Research & Intelligence Scripts

| Script | Path | Language | Purpose |
|--------|------|----------|---------|
| erank.cjs | /app/scripts/erank.cjs | Node.js | eRank browser automation: keyword research, competitor analysis, trending |
| idea-machine.cjs | /app/scripts/idea-machine.cjs | Node.js | Daily e-commerce insights: sales analysis, opportunities, trend alerts |

### Infrastructure Scripts

| Script | Path | Language | Purpose |
|--------|------|----------|---------|
| browser-automation.js | /app/scripts/browser-automation.js | Node.js | Puppeteer: screenshot, PDF, fetch, Canva login |
| entrypoint.sh | /app/scripts/entrypoint.sh | Bash | Container startup: gog auth, symlinks, server start |
| setup-cron.sh | /app/scripts/setup-cron.sh | Bash | One-time cron job registration |
| cron-log.sh | /app/scripts/cron-log.sh | Bash | Cron logging library: `cron_start` / `cron_end` |
| cron-health.sh | /app/scripts/cron-health.sh | Bash | Cron health checker: staleness, failures, alerts |
| smoke.js | /app/scripts/smoke.js | Node.js | Build smoke test |

### Script Access

Scripts are symlinked at container startup by `entrypoint.sh`:
- Shell scripts: `/usr/local/bin/{etsy.sh,trendyol.sh,pinterest.sh,kolayxport.sh,shopify.sh}` (in PATH)
- All scripts: `/data/workspace/{script}` (workspace access)

### Critical Rule

**NEVER call Etsy or Trendyol APIs directly.** Always use `etsy.sh` and `trendyol.sh`. These scripts handle authentication through the KolayXport proxy. Direct API calls will fail with auth errors.

---

## 4. Cron Jobs

| Name | Schedule | Timezone | Purpose | Delivery |
|------|----------|----------|---------|----------|
| pinterest-daily | `0 10 * * *` (10:00 AM) | Europe/Skopje | Pin top Etsy/Shopify listings to Pinterest boards | Isolated session |
| heartbeat | `0 * * * *` (hourly) | Europe/Skopje | Prayer time reminders, health checks, memory scan | Per-user messages |
| ecommerce-council | `0 9 * * *` (9:00 AM) | Europe/Skopje | Morning insights via idea-machine.cjs | WhatsApp + Telegram |
| memory-synthesis | `0 3 * * 0` (Sun 3 AM) | Europe/Skopje | Weekly memory consolidation: deduplicate, archive old daily notes | Isolated session |
| backup-databases | `0 4 * * *` (4:00 AM) | Europe/Skopje | Backup sessions.json, memory files, cron logs | Isolated session |

### Cron Logging

All cron jobs should source `/app/scripts/cron-log.sh` and call:
1. `cron_start "job-name"` at the beginning
2. `cron_end "success" "summary"` or `cron_end "failure" "error message"` at the end

Logs written to:
- `/data/workspace/logs/cron-log.jsonl` -- All entries
- `/data/workspace/logs/cron-failures.jsonl` -- Failures only
- `/data/workspace/logs/cron-alerts.jsonl` -- Health check alerts

### Cron Health Monitoring

Run `/app/scripts/cron-health.sh` to check job health. Expected staleness thresholds:

| Job | Max Stale (hours) |
|-----|-------------------|
| pinterest-daily | 26 |
| heartbeat | 2 |
| memory-synthesis | 170 |
| ecommerce-council | 26 |
| backup-databases | 26 |

---

## 5. Memory System

### File Structure

```
/data/workspace/
  MEMORY.md              Long-term memory (hard rules, facts, business state)
  USER.md                User profiles (Atilla, Merisa, Ekin)
  businesses.md          Business context (Facturino, Nabavkidata, e-commerce)
  HEARTBEAT.md           Heartbeat instructions (prayer times, health checks)
  CLAUDE.md              Tools prompt (copied from /app/CLAWD_TOOLS_PROMPT.md at startup)
  memory/
    prayer-sent.json     Prayer reminder tracking (date -> times sent)
    prayer-verses.md     Previously used verses (avoid repeats)
    daily/
      YYYY-MM-DD.md      Daily notes (observations, events, decisions)
    synthesis/
      YYYY-WW.md         Weekly synthesis (consolidated from daily notes)
  .learnings/
    README.md            Self-improvement system documentation
    YYYY-MM-DD-*.md      Individual learning files
```

### Memory Hierarchy

1. **MEMORY.md** -- Hard rules (email policy, price changes, privacy), user facts, business status. Read at session start.
2. **USER.md** -- Contact details, preferences, roles, communication channels per person.
3. **businesses.md** -- Current state of each business, targets, challenges, key URLs.
4. **HEARTBEAT.md** -- Instructions for the hourly heartbeat cron (prayer times, health checks).
5. **Daily notes** -- Captured during conversations. One file per day. Raw observations.
6. **Weekly synthesis** -- Consolidated from daily notes by the `memory-synthesis` cron. Removes noise, keeps insights.
7. **.learnings/** -- Mistakes and corrections. Scanned during heartbeats to prevent repeating errors.

### Memory Update Rules

- **MEMORY.md hard rules:** Only updated when a user gives an explicit, permanent instruction (e.g., "never do X").
- **Daily notes:** Append observations freely. Include date, source (who said it), and context.
- **Synthesis:** Weekly cron reads all daily notes from the past 7 days, extracts patterns, updates MEMORY.md if warranted, archives daily files.
- **Learnings:** Created immediately when a mistake is identified. Never deleted, only appended.

---

## 6. Integrations

### 6a. Etsy (BelleCoutureGifts) -- via KolayXport

| Capability | Command | Notes |
|-----------|---------|-------|
| List orders | `etsy.sh orders` | Last 25 by default |
| Search by customer | `etsy.sh orders --customer "Name"` | |
| Order details | `etsy.sh order RECEIPT_ID` | |
| List listings | `etsy.sh listings --limit N` | 209 active listings |
| Listing details | `etsy.sh listing LISTING_ID` | |
| Copy listing | `etsy.sh copy LISTING_ID` | Creates draft with all settings |
| Upload image | `etsy.sh upload-image ID URL RANK ALT_TEXT` | SEO alt text is critical |
| Upload video | `etsy.sh upload-video ID VIDEO_URL` | 5-60s, max 100MB |
| Update listing | `echo JSON \| etsy.sh update ID` | Title, tags, description, price |
| Create draft | `echo JSON \| etsy.sh create-draft` | Needs shipping_profile_id, taxonomy_id |
| Publish | `etsy.sh publish ID` | Draft must have images |
| Personalization | `etsy.sh get/set/simple/remove-personalization ID` | |
| Shop config | `etsy.sh shipping-profiles / readiness-states / shop-sections / return-policies` | |

**Limitations:** No shipping addresses (Etsy blocks for 3rd-party apps). No statistics/analytics API. No Etsy Ads API.

### 6b. Trendyol (Sara Tasarim) -- via KolayXport

| Capability | Command | Notes |
|-----------|---------|-------|
| Products CRUD | `trendyol.sh products/product/create-product/update-product` | Async via batch |
| Stock & price | `trendyol.sh update-stock-price` | Max 1000 items/batch |
| Orders | `trendyol.sh orders/order` | Filter by status, days |
| Shipment | `trendyol.sh update-tracking / shipping-label` | |
| Invoices | `trendyol.sh send-invoice` | |
| Returns | `trendyol.sh claims / approve-claim` | |
| Customer Q&A | `trendyol.sh questions / answer-question` | Affects seller score |
| Finance | `trendyol.sh settlements` | |
| Categories | `trendyol.sh categories / category-attributes ID` | |
| Brands | `trendyol.sh brands --name "search"` | |

**Limitations:** Trendyol Ads not available via API. Analytics/traffic data only in seller panel.

### 6c. Shopify (MyBabyByMerry)

| Capability | Command | Notes |
|-----------|---------|-------|
| Products | `shopify.sh products/product/create-product/update-product/delete-product` | |
| Orders | `shopify.sh orders/order/fulfill/cancel` | |
| Customers | `shopify.sh customers/customer/search-customers` | |
| Inventory | `shopify.sh locations/inventory/set-inventory/adjust-inventory` | |
| Collections | `shopify.sh collections/collection-products` | |
| Analytics | `shopify.sh sales --days N / counts` | |
| Cross-platform | `shopify.sh sync-from-etsy ETSY_ID` | Copy Etsy listing to Shopify |

### 6d. Pinterest -- via Make.com Webhooks

| Capability | Command | Notes |
|-----------|---------|-------|
| Status | `pinterest.sh status` | Check webhook config |
| Test | `pinterest.sh test` | Verify webhook connectivity |
| Pin from Etsy | `pinterest.sh pin-from-etsy LISTING_ID [--board "Name"]` | Auto-fetches image/details |
| Pin from Shopify | `pinterest.sh pin-from-shopify PRODUCT_ID` | |
| Custom pin | `echo JSON \| pinterest.sh create-pin` | title, description, link, imageUrl |
| Generate description | `echo JSON \| pinterest.sh generate-description` | SEO-optimized |
| Viral ideas | `pinterest.sh viral-ideas "keyword1" "keyword2"` | |

**Why Make.com:** Pinterest API requires formal approval (privacy policy, terms). Make.com handles OAuth, free tier = 1000 ops/month.

### 6e. Google Workspace -- via gog CLI

| Service | Commands | Notes |
|---------|----------|-------|
| Gmail | `gog gmail list/read/send` | atillatkulu@gmail.com |
| Calendar | `gog calendar list/add/respond` | |
| Drive | `gog drive list/download/upload` | |
| Sheets | `gog sheets read/append` | |
| Contacts | `gog contacts list/search` | |

**Auth:** OAuth client credentials + token stored in env vars (`GOG_CREDENTIALS_JSON`, `GOG_TOKEN_JSON`). File-based keyring (no macOS Keychain in containers).

### 6f. Other Integrations

| Integration | Type | Purpose |
|------------|------|---------|
| Trello | Skill (API key + token) | Task/project management |
| Slack | Skill (bot + app tokens) | Team communication, reactions, pins |
| Weather | Skill (no API key) | Weather forecasts |
| nano-banana-pro | Skill (Gemini API key) | Image generation via Gemini 3 Pro |
| video-frames | Skill (ffmpeg) | Extract frames/clips from video |
| skill-creator | Skill | Create custom OpenClaw skills |
| bluebubbles | Skill | iMessage bridge |
| eRank | Browser automation | Etsy SEO research (login required) |
| Canva | Browser automation | Design creation (login via Puppeteer) |
| Postmark | API (env var) | Outbound email: partners@facturino.mk |
| Apollo | API (env var) | VC/lead research (Pro tier) |
| ElevenLabs | API (env var) | Text-to-speech (10K chars/month free, NO video) |

---

## 7. Monitoring & Observability

### Health Checks

| Check | Method | Frequency |
|-------|--------|-----------|
| Express wrapper | `GET /setup/healthz` | Railway built-in |
| Gateway alive | `ensureGatewayRunning()` on every proxied request | Per-request |
| Cron health | `/app/scripts/cron-health.sh` | During heartbeat (hourly) |
| Channel status | `curl /setup/api/exec -d '{"args":["channels","status"]}'` | On demand |

### Log Files

| File | Location | Format | Purpose |
|------|----------|--------|---------|
| cron-log.jsonl | /data/workspace/logs/ | JSONL | All cron start/end events |
| cron-failures.jsonl | /data/workspace/logs/ | JSONL | Failures only |
| cron-alerts.jsonl | /data/workspace/logs/ | JSONL | Health check alerts |
| Gateway stdout | Docker logs | Text | OpenClaw gateway output |
| Wrapper stdout | Docker logs | Text | Express wrapper output |

### Cron Log Entry Format

```json
{"job":"pinterest-daily","status":"start","timestamp":"2026-02-19T08:00:00.000Z"}
{"job":"pinterest-daily","status":"success","timestamp":"2026-02-19T08:02:15.000Z","duration_ms":135000,"summary":"Pinned 5 listings to 3 boards"}
```

### Alert Conditions

| Condition | Severity | Action |
|-----------|----------|--------|
| Cron job failure | Warning | Log to cron-failures.jsonl, report in next heartbeat |
| Cron job stale (missed schedule) | Warning | Log to cron-alerts.jsonl, report in heartbeat |
| Gateway not ready after 20s | Error | Return 503 to client |
| WhatsApp session corrupt | Error | Re-link via /setup/whatsapp-qr |

---

## 8. Databases & State

### Persistent State (/data/.clawdbot/)

| File | Purpose | Managed By |
|------|---------|-----------|
| clawdbot.json | OpenClaw configuration (model, channels, auth) | Gateway |
| gateway.token | Stable gateway auth token (auto-generated) | Wrapper |
| etsy-token.json | Etsy OAuth tokens (access + refresh) | Wrapper |
| sessions/ | Conversation session data per channel+user | Gateway |

### Workspace State (/data/workspace/)

| File/Dir | Purpose | Managed By |
|----------|---------|-----------|
| CLAUDE.md | System prompt (tools reference) | entrypoint.sh (copy from /app) |
| MEMORY.md | Long-term memory | Agent |
| USER.md | User profiles | Agent |
| businesses.md | Business context | Agent |
| HEARTBEAT.md | Heartbeat instructions | Agent |
| pinterest-token.json | Pinterest OAuth tokens | Wrapper (OAuth callback) |
| memory/ | Daily notes, synthesis, prayer tracking | Agent + cron |
| .learnings/ | Mistake/correction log | Agent |
| logs/ | Cron logs, failures, alerts | cron-log.sh, cron-health.sh |

### Backup Strategy

Daily backup cron (4:00 AM) archives:
- All `/data/workspace/` files
- `/data/.clawdbot/clawdbot.json`
- Session data

Manual backup available: `GET /setup/export` (downloads .tar.gz)

---

## 9. Environment Variables

### Required

| Variable | Purpose | Example |
|----------|---------|---------|
| ANTHROPIC_API_KEY | Claude API access | sk-ant-... |
| SETUP_PASSWORD | Protects /setup admin UI | pZMcVLVMcmLomrCQ |
| KOLAYXPORT_API_KEY | KolayXport proxy auth (Etsy + Trendyol) | (secret) |
| KOLAYXPORT_API_URL | KolayXport API base URL | https://kolayxport.com/api/clawd |

### Google Workspace

| Variable | Purpose |
|----------|---------|
| GOG_CREDENTIALS_JSON | Google OAuth client credentials JSON |
| GOG_TOKEN_JSON | Google OAuth token JSON |

### E-Commerce

| Variable | Purpose |
|----------|---------|
| ETSY_API_KEY | Etsy OAuth app key |
| ETSY_API_SECRET | Etsy OAuth app secret |
| ETSY_REDIRECT_URI | Etsy OAuth callback URL |
| SHOPIFY_STORE_URL | Shopify store domain |
| SHOPIFY_API_KEY | Shopify API key (legacy private app) |
| SHOPIFY_API_SECRET | Shopify API secret |
| SHOPIFY_ACCESS_TOKEN | Shopify Admin API token (custom app alternative) |
| PINTEREST_APP_ID | Pinterest OAuth app ID |
| PINTEREST_APP_SECRET | Pinterest OAuth app secret |
| MAKE_PINTEREST_WEBHOOK_URL | Make.com webhook for Pinterest pin creation |
| CLOUDINARY_CLOUD_NAME | Cloudinary for image proxying (default: dhcwyis5i) |

### Tools & Services

| Variable | Purpose |
|----------|---------|
| GEMINI_API_KEY | Gemini image generation (nano-banana-pro) |
| TRELLO_API_KEY | Trello integration |
| TRELLO_TOKEN | Trello auth token |
| CANVA_EMAIL | Canva login (browser automation) |
| CANVA_PASSWORD | Canva password |
| VELA_EMAIL | Vela (legacy Etsy tool) login |
| VELA_PASSWORD | Vela password |
| ERANK_EMAIL | eRank login (browser automation) |
| ERANK_PASSWORD | eRank password |
| POSTMARK_TOKEN | Postmark email API (Facturino) |
| APOLLO_API_KEY | Apollo lead research (Pro tier) |
| ELEVENLABS_API_KEY | ElevenLabs TTS (free tier) |

### Infrastructure

| Variable | Purpose | Default |
|----------|---------|---------|
| CLAWDBOT_PUBLIC_PORT | Wrapper listen port | 8080 |
| PORT | Fallback port | 8080 |
| INTERNAL_GATEWAY_PORT | Gateway internal port | 18789 |
| CLAWDBOT_STATE_DIR | State directory | ~/.clawdbot |
| CLAWDBOT_WORKSPACE_DIR | Workspace directory | (state dir)/workspace |
| CLAWDBOT_GATEWAY_TOKEN | Gateway auth token | Auto-generated |
| CLAWDBOT_ENTRY | Gateway CLI entry point | /clawdbot/dist/entry.js |
| PUPPETEER_EXECUTABLE_PATH | Chromium path | /usr/bin/chromium |

---

## 10. Key Files

### Container Image

| File | Purpose |
|------|---------|
| Dockerfile | Multi-stage build: clawdbot from source + runtime with Chromium, Playwright, gog, ffmpeg, tini |
| package.json | Wrapper deps: express 5, http-proxy, puppeteer-core, tar |
| src/server.js | Express wrapper: setup UI, Etsy/Pinterest OAuth, gateway proxy, health check |
| scripts/entrypoint.sh | Container startup: gog auth, script symlinks, server launch |

### Workspace (deployed to /data/workspace/)

| File | Purpose |
|------|---------|
| PRD.md | This document -- single source of truth |
| MEMORY.md | Long-term memory (hard rules, facts, business state) |
| USER.md | User profiles and preferences |
| businesses.md | Business context and targets |
| HEARTBEAT.md | Hourly heartbeat instructions |
| CLAUDE.md | Tools/capabilities prompt (auto-copied from /app) |
| SUBAGENT-POLICY.md | When to spawn subagents vs work directly |
| .learnings/README.md | Self-improvement system documentation |

### Scripts (deployed to /app/scripts/)

See Section 3 for the complete table.

---

## 11. Known Issues

| Issue | Severity | Workaround | Status |
|-------|----------|-----------|--------|
| Moltbot browser service 15s timeout | Medium | Use direct Puppeteer script (`browser-automation.js`) instead of built-in browser tool | Known bug, workaround in place |
| Gateway crashes on redeploy | Medium | Auto-restart logic in server.js `ensureGatewayRunning()` | Fixed |
| WhatsApp session corruption after multiple deploys | Medium | Re-link via /setup/whatsapp-qr | Manual intervention required |
| Cloudflare blocks headless browser | Low | Use manual workaround or API endpoints instead | Expected behavior |
| Zombie processes from Chromium | Low | tini init in Dockerfile reaps them | Fixed |
| Gemini always outputs 2048x2048 square | Low | Use Canva or composite photos for non-square formats | Platform limitation |
| etsy.sh relative path errors | Low | Always use absolute paths: `/app/scripts/etsy.sh` or the PATH symlink `etsy.sh` | Fixed (2026-02-18) |
| Session compaction timing | Low | Compaction happens automatically when context fills; may briefly delay responses | By design |
| Etsy API no shipping addresses | Low | Check Etsy seller dashboard directly | Etsy policy for 3rd-party apps |
| Etsy API no analytics | Low | Use eRank for SEO data; Etsy Stats only in dashboard | Etsy API limitation |
| Trendyol API no ads/analytics | Low | Use Trendyol seller panel directly | Trendyol API limitation |
| ElevenLabs free tier | Low | 10K chars/month, NO video generation despite UI suggestion | Plan limitation |

---

## 12. Deployment

### Build & Deploy

```bash
# From the project root (clawdbot-railway-template/)
railway up --service clawdbot-va --detach
```

### Post-Deploy Checklist

1. Verify health: `curl https://clawdbot-va-production.up.railway.app/setup/healthz`
2. Check channels: `curl -u user:PASSWORD /setup/api/exec -d '{"args":["channels","status"]}'`
3. If WhatsApp down: visit `/setup/whatsapp-qr` and re-link
4. Verify cron jobs: `curl -u user:PASSWORD /setup/api/exec -d '{"args":["cron","list"]}'`

### Useful URLs

| URL | Purpose |
|-----|---------|
| https://clawdbot-va-production.up.railway.app/setup | Admin setup UI |
| https://clawdbot-va-production.up.railway.app/setup/healthz | Health check |
| https://clawdbot-va-production.up.railway.app/setup/whatsapp-qr | WhatsApp QR link |
| https://clawdbot-va-production.up.railway.app/clawdbot | Control UI |
| https://clawdbot-va-production.up.railway.app/setup/export | Download backup |
| https://clawdbot-va-production.up.railway.app/setup/etsy/auth | Etsy OAuth start |
| https://railway.com/project/caf84229-f6c4-4c09-9be4-c500ce217e40 | Railway project |
