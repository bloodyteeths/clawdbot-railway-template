import fs from "node:fs";
import path from "node:path";

const CHAT_LOGS_DIR = "/data/workspace/memory/chat-logs";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function todayStamp() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Belgrade" });
}

const handler = async (event) => {
  try {
    ensureDir(CHAT_LOGS_DIR);

    const dateStr = todayStamp();
    const logFile = path.join(CHAT_LOGS_DIR, `${dateStr}.jsonl`);

    const record = {
      ts: new Date().toISOString(),
      event: event.action || event.type || "command",
      channel: event.channelId,
      conversationId: event.conversationId,
      sessionKey: event.sessionKey,
      command: event.command,
    };

    fs.appendFileSync(logFile, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("[message-logger] write error:", err);
  }
};

export default handler;
