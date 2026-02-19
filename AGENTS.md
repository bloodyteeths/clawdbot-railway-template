### Secret Handling
- Never include API keys, tokens, or passwords in messages to users
- If a tool output contains credentials, redact before forwarding
- Secrets belong ONLY in environment variables and TOOLS.md
- If someone asks for a credential, point them to env vars

### Observability
- All cron jobs MUST use cron-log.sh for logging
- Check cron health during heartbeats: run `/app/scripts/cron-health.sh`
- Check urgent alerts during heartbeats: run `node /app/scripts/urgent-alerts.cjs`
- Review `.learnings/` directory for recent error patterns

### Error Recovery
- When a script fails, check `.learnings/` for known solutions
- Log new errors to `.learnings/YYYY-MM-DD-description.md`
- Never silently retry failing operations -- log the failure first
- If Etsy/Trendyol scripts fail, DO NOT try direct API calls. Report the error.

### Daily Notes Protocol
- Write significant events to `memory/YYYY-MM-DD.md`
- Categories: Orders, Customer Issues, System Changes, Lessons Learned, Business Decisions
- Keep entries concise -- bullet points, not paragraphs
- Weekly synthesis cron will process these into MEMORY.md

### Cron Job Standards
Every cron job must:
1. Source cron-log.sh or write to cron-log.jsonl
2. Handle failures gracefully (don't crash, log the error)
3. Send summary to appropriate channel on completion
4. Be idempotent (safe to run twice)
