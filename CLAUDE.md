# Clawd VA - Project Context

## Overview
Clawd is a personal AI assistant for **Atilla** and **Merisa**, built on Moltbot/Clawdbot framework, deployed on Railway.

**Deployment URL:** https://clawdbot-va-production.up.railway.app
**Setup URL:** https://clawdbot-va-production.up.railway.app/setup
**Setup Password:** `pZMcVLVMcmLomrCQ`

---

## Business Context

### Users
- **Atilla** (primary) - atillatkulu@gmail.com, +905335010211
- **Merisa** (wife) - selmahodja353@gmail.com, +905335683366

### Location
- Skopje, Macedonia (CET timezone)
- Languages: Turkish, Macedonian, English

### Business Assets
1. **Facturino.mk** - Accounting/invoicing SaaS (Railway)
2. **Nabavkidata.com** - Procurement/tender data SaaS (EC2)
3. **BelleCoutureGifts** - Etsy shop (managed via Vela)
4. **KolayXport** - Trendyol order management (Vercel) - https://kolayxport.com

---

## Channels Configured

| Channel | Status | Account |
|---------|--------|---------|
| Telegram | ✅ Active | @biberovic_bot |
| WhatsApp | ✅ Active | +905425683362 |
| Slack | ✅ Active | Configured |

**DM Policy:** Open (no pairing required for new contacts)
**Group Policy:** Open with `requireMention: true`

---

## Integrations & Skills

### Ready Skills
| Skill | Status | Notes |
|-------|--------|-------|
| gog (Google Workspace) | ✅ Ready | Gmail, Calendar, Drive, Sheets, Docs |
| nano-banana-pro | ✅ Ready | Gemini image generation |
| weather | ✅ Ready | No API key needed |
| trello | ✅ Ready | API key configured |
| slack | ✅ Ready | Bot & app tokens set |
| video-frames | ✅ Ready | ffmpeg installed |
| skill-creator | ✅ Ready | Create custom skills |
| bluebubbles | ✅ Ready | iMessage bridge |

### Environment Variables (Railway)
```
ANTHROPIC_API_KEY     - Claude API
GEMINI_API_KEY        - Image generation
TRELLO_API_KEY        - Trello integration
TRELLO_TOKEN          - Trello auth
CANVA_EMAIL           - atillatkulu@gmail.com
CANVA_PASSWORD        - [set]
VELA_EMAIL            - selmahodja353@gmail.com
VELA_PASSWORD         - [set]
GOG_CREDENTIALS_JSON  - Google OAuth client
GOG_TOKEN_JSON        - Google OAuth token
KOLAYXPORT_API_KEY    - KolayXport orders API
KOLAYXPORT_API_URL    - https://kolayxport.com/api/clawd
SETUP_PASSWORD        - pZMcVLVMcmLomrCQ
```

---

## Browser Automation

### Status
- **Playwright Chromium:** Installed at `/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome`
- **Moltbot browser service:** Has 15s timeout issue (known bug)
- **Workaround:** Use direct Puppeteer script at `/app/scripts/browser-automation.cjs`

### Browser Config
```json
{
  "browser": {
    "headless": true,
    "noSandbox": true,
    "defaultProfile": "clawd",
    "executablePath": "/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome"
  }
}
```

### Direct Script Usage
```bash
# Screenshot
node /app/scripts/browser-automation.cjs screenshot "<url>" "/tmp/output.png"

# PDF
node /app/scripts/browser-automation.cjs pdf "<url>" "/tmp/output.pdf"

# Fetch text
node /app/scripts/browser-automation.cjs fetch "<url>"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │              clawdbot-va service                 │    │
│  │  ┌─────────────┐     ┌─────────────────────┐   │    │
│  │  │   Wrapper   │────►│  Moltbot Gateway    │   │    │
│  │  │  (Express)  │     │  (port 18789)       │   │    │
│  │  │  port 8080  │     │                     │   │    │
│  │  └─────────────┘     └─────────────────────┘   │    │
│  │                              │                  │    │
│  │         ┌────────────────────┼────────────┐    │    │
│  │         ▼                    ▼            ▼    │    │
│  │    Telegram            WhatsApp        Slack   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  Volume: /data (persistent state)                        │
│    - /data/.clawdbot/moltbot.json (config)              │
│    - /data/workspace (agent workspace)                   │
└─────────────────────────────────────────────────────────┘
```

---

## Common Commands

### Check Status
```bash
curl -s -u user:pZMcVLVMcmLomrCQ "https://clawdbot-va-production.up.railway.app/setup/api/exec" \
  -X POST -H "Content-Type: application/json" \
  -d '{"args": ["channels", "status"]}'
```

### Run Moltbot Command
```bash
curl -s -u user:pZMcVLVMcmLomrCQ "https://clawdbot-va-production.up.railway.app/setup/api/exec" \
  -X POST -H "Content-Type: application/json" \
  -d '{"args": ["<command>", "<args>"]}'
```

### Check Skills
```bash
curl -s -u user:pZMcVLVMcmLomrCQ "https://clawdbot-va-production.up.railway.app/setup/api/exec" \
  -X POST -H "Content-Type: application/json" \
  -d '{"args": ["skills", "list"]}'
```

### Approve Pairing
```bash
curl -s -u user:pZMcVLVMcmLomrCQ "https://clawdbot-va-production.up.railway.app/setup/api/pairing/approve" \
  -X POST -H "Content-Type: application/json" \
  -d '{"channel": "whatsapp", "code": "<CODE>"}'
```

### Check KolayXport Orders
```bash
# Via SSH
railway ssh --service=dda20e46-0d46-4e1f-a3f4-d9f85e328f9c -- /app/scripts/kolayxport.sh orders --limit 5

# Via exec API
curl -s -u user:pZMcVLVMcmLomrCQ "https://clawdbot-va-production.up.railway.app/setup/api/exec" \
  -X POST -H "Content-Type: application/json" \
  -d '{"args": ["exec", "/app/scripts/kolayxport.sh", "orders"]}'
```

---

## Key Files

| File | Purpose |
|------|---------|
| `Dockerfile` | Container build with Chromium, Playwright, gog, jq, tini |
| `src/server.js` | Express wrapper with setup API endpoints |
| `scripts/entrypoint.sh` | Container startup (gog auth setup) |
| `scripts/browser-automation.cjs` | Direct Puppeteer script (bypass Moltbot) |
| `scripts/kolayxport.sh` | KolayXport orders API helper |
| `package.json` | Dependencies: express, http-proxy, puppeteer-core, tar |

---

## Known Issues

1. **Moltbot browser service 15s timeout** - Use direct Puppeteer script as workaround
2. **Gateway goes down on redeploy** - Fixed with auto-start in server.js
3. **WhatsApp session corruption** - Re-link via /setup/whatsapp-qr after multiple deploys
4. **Cloudflare blocks browser** - Expected for protected sites, use manual workaround
5. **Zombie processes from browser** - Fixed with tini init in Dockerfile

---

## Future Enhancements

- [ ] n8n integration for workflow automation
- [ ] Uptime monitoring for Facturino/Nabavkidata
- [ ] Customer support automation
- [ ] Daily business reports cron
- [ ] Etsy API (when approved)

---

## Deploy Command
```bash
railway up --service clawdbot-va --detach
```

---

## Useful Links

- **Moltbot Docs:** https://docs.molt.bot
- **Railway Project:** https://railway.com/project/caf84229-f6c4-4c09-9be4-c500ce217e40
- **Control UI:** https://clawdbot-va-production.up.railway.app/clawdbot
- **WhatsApp QR:** https://clawdbot-va-production.up.railway.app/setup/whatsapp-qr
