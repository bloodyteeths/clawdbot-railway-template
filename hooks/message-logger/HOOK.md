---
name: message-logger
description: "Logs all inbound and outbound messages to daily JSONL files for persistent conversation history"
metadata:
  openclaw:
    events:
      - "command"
    always: true
---

# Message Logger

Captures every message (received and sent) and appends a structured JSON line to
`/data/workspace/memory/chat-logs/YYYY-MM-DD.jsonl`.

Used by the daily chat history summarizer (`chat-history-export.cjs`) to build
persistent conversation memory across session resets.
