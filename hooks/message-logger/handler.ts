import fs from "node:fs";
import path from "node:path";

const CHAT_LOGS_DIR = "/data/workspace/memory/chat-logs";

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function todayStamp(): string {
  // Use CET/Skopje timezone for date boundaries
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Belgrade" });
}

const handler = async (event: any) => {
  try {
    ensureDir(CHAT_LOGS_DIR);

    const dateStr = todayStamp();
    const logFile = path.join(CHAT_LOGS_DIR, `${dateStr}.jsonl`);

    const record: Record<string, any> = {
      ts: new Date().toISOString(),
      event: event.action, // "received" or "sent"
    };

    if (event.action === "received") {
      record.from = event.from;
      record.content = event.content;
      record.channel = event.channelId;
      record.conversationId = event.conversationId;
      record.messageId = event.messageId;
      if (event.metadata?.senderName) {
        record.senderName = event.metadata.senderName;
      }
    } else if (event.action === "sent") {
      record.to = event.to;
      record.content = event.content;
      record.success = event.success;
      record.channel = event.channelId;
      record.conversationId = event.conversationId;
      record.messageId = event.messageId;
    }

    if (event.sessionKey) {
      record.sessionKey = event.sessionKey;
    }

    fs.appendFileSync(logFile, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    // Silent fail -- logging must never break message flow
    console.error("[message-logger] write error:", err);
  }
};

export default handler;
