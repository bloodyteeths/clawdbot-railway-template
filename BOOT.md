# BOOT.md — Gateway Startup Checklist

Run these checks silently on every gateway startup. Do NOT message anyone unless something is broken.

## 1. Read Your Memory
- Read `memory/MEMORY.md` for hard rules and active context
- Read `memory/learned-rules.md` for self-corrections
- Skim `memory/tasks.md` for any pending tasks

## 2. Verify Google Drive Access
- Run `gog drive ls` to confirm authentication works
- If auth fails, log the error to `.learnings/` — do NOT message about it

## 3. Check Key Google Sheets
These are the operational sheets you manage:
- Kargolar (Orders): `1B2BuygRHhAUL06LswOWfMy9geqgMZ9ypqDiIFmwAhi0`
- Facturino CRM: `1uw65zVPVtvZHrgU-WytPwUgxHhXRia3c6iRZvva81A4`
- Investor Tracker: `1rHbBpdlQb8Z_6tZvuTEjDSbSv2neEDL-ZG0E3K4g7Vc`
- Etsy Audit: `1jc5d5q3601uCnJnsd29lVIV3mpgwVI-SvF028SeUkk0`

Confirm at least one sheet is readable. If Google auth is broken, that's worth alerting Atilla on Telegram.

## 4. Check E-Commerce Scripts
Verify these are accessible (just check file exists, don't run them):
- `/app/scripts/etsy.sh`
- `/app/scripts/ebay.sh`
- `/app/scripts/trendyol.sh`
- `/app/scripts/erank.cjs`

## 5. Review Yesterday's Chat Summary
- Check if `memory/chat-summaries/` has yesterday's date file
- If missing, note it — the daily summarizer may have failed

## RULES
- This runs SILENTLY. No messages to anyone unless something is critically broken.
- "All checks passed" is NOT a message. Log it and move on.
- Only alert on: Google auth broken, workspace files missing, critical scripts missing.
