---
description: "Nabavkidata.com management — AI-powered public procurement data platform for Macedonia"
activation: "nabavkidata, procurement, tender, nabavki, javni nabavki, public procurement, CPV"
---

# Nabavkidata — AI Procurement Intelligence

Nabavkidata.com is Atilla's AI-powered public procurement data platform for Macedonia. It analyzes government tenders and procurement data to help businesses win contracts.

**URL:** https://nabavkidata.com
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

Check Nabavkidata status:

```bash
# Screenshot the landing page
node /app/scripts/browser-automation.cjs screenshot "https://nabavkidata.com" "/tmp/nabavkidata-status.png"

# Check if the app is responding
node /app/scripts/browser-automation.cjs fetch "https://nabavkidata.com"
```

## Common Tasks

When Atilla asks about Nabavkidata:
- **Status check** — screenshot or fetch the URL to verify uptime
- **User inquiries** — check Gmail for support emails: `gog gmail list` and filter for nabavkidata
- **Revenue/usage** — check financial tracker: `node /app/scripts/financial-tracker.cjs`
- **Feature requests** — log to Trello board
- **Data questions** — use browser automation to search the platform
- **Marketing** — generate content about procurement intelligence, AI analysis

## Infrastructure Notes

- Hosted on AWS EC2 (not Railway)
- Separate from Clawd's Railway project
- Monitor via browser automation or external uptime checks
- Database contains sensitive government procurement data

## Competitive Advantage

1. Only AI-powered procurement platform for Macedonia
2. Bilingual AI (Macedonian + English)
3. Historical pricing database enables smarter bidding
4. Company win-rate tracking unique in the market
5. 40,000+ documents — largest analyzed dataset in Macedonia
