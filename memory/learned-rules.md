# Learned Rules (Bot-Maintained)

This file is owned by the bot. It survives deploys — entrypoint.sh seeds it but
never overwrites. Write new rules as dated entries under the relevant section.

When a user states a preference, corrects your behavior, or you discover a mistake —
write it here IMMEDIATELY. This is your persistent self-correction memory.

---

## User Preferences

## Channel Rules

- [2026-03-15] tamsar-e-commerce WhatsApp group is e-commerce ONLY. Zero Nabavkidata/Facturino/infra updates.
- [2026-03-15] Merisa DM = e-commerce + Facturino engineering only. No Nabavkidata, no infra alerts.
- [2026-03-15] Nabavkidata/Facturino/infra alerts → Atilla DM on Telegram only.

## Operational Rules

- [2026-03-15] Quiet hours 01:00–10:00 CET: NO proactive WhatsApp messages. People are sleeping.
- [2026-03-15] If everything is healthy → DO NOT SEND A MESSAGE. Silence = healthy.
- [2026-03-15] Max 2-3 proactive messages per day. Heartbeats are SILENT background checks.
- [2026-03-15] Never send: "all clear" reports, dashboard updates, sleep reminders, "no issues found", VC email checks with 0 results.

## Violations Log

- [2026-03-15] Sent 9 unsolicited messages between 20:01-22:35 on a Sunday evening (spam). Root cause: heartbeat too aggressive (30m), AGENTS.md said "send summary on completion" for every cron, no silence-when-healthy rule. Fixed: heartbeat → 2h, added anti-spam rules to SOUL.md + CLAWD_TOOLS_PROMPT.md + AGENTS.md.
