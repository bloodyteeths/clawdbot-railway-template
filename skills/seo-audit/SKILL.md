---
description: "Audit Etsy listing SEO — score, tags, title, description analysis via eRank"
activation: "audit listing, seo audit, listing audit, seo score, check listing, listing check, why no views, low views, bad ranking"
tools: ["node /app/scripts/erank.cjs", "/app/scripts/etsy.sh"]
---

# SEO Audit — Quick Listing Health Check

Run a fast SEO audit on any Etsy listing. For full optimization, see [[etsy-seo-optimizer]].

## Quick Audit (4 commands)

```bash
# 1. Get current listing data from Etsy
etsy.sh listing <listing_id>

# 2. Get eRank SEO audit page (grade, tags, visibility)
node /app/scripts/erank.cjs audit <listing_id>

# 3. Research the primary keyword to check volume
node /app/scripts/erank.cjs keyword "<main product keyword from title>"

# 4. Check health issues across all listings
node /app/scripts/erank.cjs health
```

## What to Check

| Check | Pass | Fail |
|-------|------|------|
| Title length | 110-140 chars | <100 chars |
| Tags used | 13/13 | <13 |
| Tag quality | Multi-word phrases | Single words, duplicates |
| Description starts with keyword | Yes | Generic opener |
| Images | 8-10 | <5 |
| Materials filled | Yes | Empty |
| Personalization (if applicable) | Enabled | Missing |
| Views (7 days) | >50 | <10 |

## After Audit

If issues found, run the full optimization workflow:
1. Read `skills/etsy-seo-optimizer/SKILL.md` for the complete methodology
2. Follow the step-by-step optimization workflow in `skills/etsy-manager/workflows.md`
3. Apply changes via `etsy.sh update <id>`
4. Report before/after to user
