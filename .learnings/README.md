# .learnings/ -- Self-Improvement System

This directory captures mistakes, corrections, and lessons learned.
Each file is a specific learning that prevents repeating errors.

## How It Works

1. When you make a mistake, create a file: `.learnings/YYYY-MM-DD-short-description.md`
2. Document: what went wrong, why, and the correct approach
3. During heartbeats, scan this directory for recent learnings
4. Apply lessons to prevent repeating mistakes

## Format

Each learning file should contain:

- **What happened:** Brief description of the error
- **Root cause:** Why it happened
- **Correct approach:** What to do instead
- **Applied to:** Which files/configs were updated to prevent recurrence

## When to Create a Learning

- You gave incorrect information and were corrected
- A command failed because you used it wrong
- A user explicitly told you "do not do X" or "always do Y"
- You tried something multiple times before finding the right approach
- An API call failed due to a misunderstanding of how the system works

## Naming Convention

```
YYYY-MM-DD-short-kebab-description.md
```

Examples:
- `2026-02-18-etsy-relative-path.md`
- `2026-02-15-never-send-email-without-approval.md`
- `2026-02-12-gemini-square-images-only.md`
- `2026-02-10-trendyol-batch-async.md`

## Retention

Learning files are never deleted. They accumulate over time and serve as a permanent
record of corrections. During weekly memory synthesis, key patterns from learnings
may be promoted to MEMORY.md hard rules if they represent recurring issues.

## Integration with Heartbeat

During each hourly heartbeat, scan `.learnings/` for files created in the last 24 hours.
Briefly review them to reinforce the corrections before proceeding with other heartbeat tasks.
