---
description: "Facturino.mk management — AI-powered accounting & e-invoicing SaaS for Macedonia"
activation: "facturino, invoice, fatura, e-faktura, accounting, bookkeeping, macedonia accounting"
---

# Facturino — AI Accounting SaaS

Facturino.mk is Atilla's AI-powered accounting and e-invoicing SaaS for Macedonia. It helps businesses manage invoicing, expenses, banking integrations, and tax compliance.

**URL:** https://facturino.mk
**Infrastructure:** Railway (same project as Clawd)
**Built on:** InvoiceShelf (AGPL-3.0) + Next.js
**Target:** Macedonian SMBs, freelancers, accountants

## Product Overview

| Feature | Details |
|---------|---------|
| E-Invoicing | UBL 2.1 e-Faktura, compliant with Macedonian regulations |
| Banking | PSD2 integrations with 9 Macedonian banks |
| AI Advisor | Financial insights, anomaly detection, cash flow forecasting |
| Multi-company | Manage multiple businesses from one account |
| Inventory | Stock tracking with automatic cost calculations |
| Year-end | Guided closing wizard for annual reporting |
| Partner program | 20% recurring commission for accountants |

## Pricing Tiers

| Plan | Price | Features |
|------|-------|----------|
| Free | 0 | Basic invoicing, 1 company |
| Starter | 29 EUR/mo | Banking, multi-currency |
| Professional | 79 EUR/mo | AI advisor, inventory, multi-company |
| Enterprise | 149 EUR/mo | API access, custom integrations, priority support |

## Monitoring

```bash
# Full health + events check (both apps)
node /app/scripts/saas-monitor.cjs

# Facturino only
node /app/scripts/saas-monitor.cjs --app facturino

# Quick uptime check (fallback)
node /app/scripts/browser-automation.cjs fetch "https://facturino.mk"
```

The saas-monitor polls `/api/v1/clawd/status` and returns: health checks (DB, Redis, queues, storage), new users, failed jobs, payment events. Real-time critical events (payment failures, system down) are also pushed via webhook to `/data/workspace/logs/saas-urgent.jsonl`.

## Common Tasks

When Atilla asks about Facturino:
- **Status check** — `node /app/scripts/saas-monitor.cjs --app facturino`
- **New users** — saas-monitor reports new signups in last 24h
- **Payment issues** — saas-monitor reports failed payments, cancellations
- **Customer inquiries** — check Gmail: `gog gmail list` and filter for facturino
- **Revenue tracking** — `node /app/scripts/financial-tracker.cjs`
- **Feature requests** — log to Trello board
- **Marketing** — generate social media content, compare with competitors

## Competitive Landscape

Facturino competes with:
- Manual Excel-based accounting (most common in Macedonia)
- Serbian/Croatian accounting tools adapted for Macedonia
- No direct AI-powered Macedonian accounting competitor exists

## Key Differentiators

1. Only AI-powered accounting tool built specifically for Macedonia
2. Native e-Faktura (UBL 2.1) support
3. PSD2 banking integrations with all major Macedonian banks
4. Macedonian language UI and tax compliance
5. Partner program for accountants (20% recurring)
