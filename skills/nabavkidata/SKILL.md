---
description: "Nabavkidata.com management — AI-powered public procurement data platform for Macedonia"
activation: "nabavkidata, procurement, tender, nabavki, javni nabavki, public procurement, CPV"
---

# Nabavkidata — AI Procurement Intelligence

Nabavkidata.com is Atilla's AI-powered public procurement data platform for Macedonia. It analyzes government tenders and procurement data to help businesses win contracts.

**URL:** https://nabavkidata.com
**API:** https://api.nabavkidata.com
**Infrastructure:** AWS EC2
**Target:** Macedonian businesses bidding on public contracts, procurement analysts

## Product Overview

| Feature | Details |
|---------|---------|
| Document Analysis | 40,000+ procurement documents analyzed by AI |
| Product Database | 7,597 products with historical pricing |
| Company Tracking | 1,873 companies with win rates and market share |
| CPV Analysis | Win rate and market share by CPV (Common Procurement Vocabulary) code |
| AI Search | Understands queries in Macedonian and English |
| Price Intelligence | Historical pricing trends for bidding optimization |

## Core Capabilities

### For Bidders
- Search tenders by keyword, CPV code, or contracting authority
- See historical prices for similar procurements
- Analyze competitor win rates and pricing strategies
- Get AI-powered bid price recommendations

### For Analysts
- Market share analysis by sector
- Company performance tracking
- Spending patterns by government institution
- Trend analysis across procurement categories

### Corruption Detection (flagship feature)
- Analyzes 15,000+ government tenders using 50+ risk indicators
- Based on World Bank, OECD, and Ukraine's Dozorro methodology
- Detects: single-bidder tenders, repeat winners, price anomalies, bid clustering, connected companies, specification rigging
- Pre-computed risk scores across 8 flag types with overall risk rating

## Tech Stack

- **Frontend:** Next.js (React)
- **Backend:** FastAPI (Python)
- **Database:** PostgreSQL with materialized views for risk scoring
- **Scraping:** Scrapy + Playwright from e-nabavki.gov.mk
- **AI:** Gemini embeddings for semantic search, OCR for PDF extraction
- **Users:** 4,500+ companies and citizens

## Monitoring

### Uptime Monitor (every 5 min)
`nabavkidata-monitor.cjs` runs every 5 minutes via cron. It checks `/health` and `/api/clawd/status`, sends **Telegram alerts** on state transitions:
- **DOWN** — immediate alert when api.nabavkidata.com becomes unreachable
- **STILL DOWN** — reminder every 30 minutes while down
- **RECOVERED** — alert when service comes back online with downtime duration
- **Degraded metrics** — alerts for scraper failures, high error rates, failed jobs (30min cooldown)

```bash
# Manual run
node /app/scripts/nabavkidata-monitor.cjs

# State file (tracks up/down transitions)
cat /data/workspace/logs/nabavkidata-monitor-state.json

# Logs
cat /data/workspace/logs/nabavkidata-monitor.jsonl
```

### EC2 Cron Watchdog (every 15 min)
`ec2-cron-watchdog.cjs` monitors EC2 cron jobs via dead man's switch. EC2 crons report heartbeats via webhook; watchdog alerts if a cron goes stale (default 26h for daily, 2h for hourly).

```bash
# Manual run
node /app/scripts/ec2-cron-watchdog.cjs

# See registered cron heartbeats
cat /data/workspace/logs/ec2-heartbeats.json

# Configure per-cron thresholds (optional)
# Create /data/workspace/logs/ec2-watchdog-config.json:
# { "scraper-daily": { "max_stale_hours": 26 } }
```

### General SaaS Monitor (on-demand)
```bash
# Full health + events check (both apps)
node /app/scripts/saas-monitor.cjs

# Nabavkidata only
node /app/scripts/saas-monitor.cjs --app nabavkidata
```

The saas-monitor polls `/api/clawd/status` and returns: health checks (DB, API, scraper), new users, scraper status, error rates. Real-time critical events (scraper failures, high error rates, cron failures) are pushed via webhook and trigger Telegram alerts.

## Common Tasks

When Atilla asks about Nabavkidata:
- **Status check** — `node /app/scripts/nabavkidata-monitor.cjs` (or `saas-monitor.cjs --app nabavkidata`)
- **Is it down?** — check `/data/workspace/logs/nabavkidata-monitor-state.json` for current status
- **New users** — saas-monitor reports new signups in last 24h
- **Scraper health** — saas-monitor reports scraper status (ok/stale/failed)
- **EC2 cron status** — `node /app/scripts/ec2-cron-watchdog.cjs` or check `ec2-heartbeats.json`
- **User inquiries** — check Gmail: `gog gmail list` and filter for nabavkidata
- **Revenue/usage** — `node /app/scripts/financial-tracker.cjs`
- **Feature requests** — log to Trello board
- **Data questions** — use browser automation to search the platform
- **Marketing** — generate content about procurement intelligence, AI analysis

## Infrastructure Notes

- Hosted on AWS EC2 at 18.197.185.30 (not Railway)
- Backend: FastAPI with uvicorn (raw process, no systemd/docker)
- Database: RDS PostgreSQL
- Frontend: Vercel (auto-deploys on git push)
- Monitored via nabavkidata-monitor.cjs (every 5min) + ec2-cron-watchdog.cjs (every 15min) + saas-monitor.cjs (on-demand)
- EC2 crons report heartbeats to Clawd via `/opt/clawd/ec2-report.sh` webhook calls
- Alerts sent to Telegram on downtime, recovery, scraper failures, stale crons

## Competitive Advantage

1. Only AI-powered procurement platform for Macedonia
2. Bilingual AI (Macedonian + English)
3. Historical pricing database enables smarter bidding
4. Company win-rate tracking unique in the market
5. 40,000+ documents — largest analyzed dataset in Macedonia
