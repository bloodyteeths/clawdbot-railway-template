import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import * as tar from "tar";

// Railway deployments sometimes inject PORT=3000 by default. We want the wrapper to
// reliably listen on 8080 unless explicitly overridden.
//
// Prefer CLAWDBOT_PUBLIC_PORT (set in the Dockerfile / template) over PORT.
const PORT = Number.parseInt(process.env.CLAWDBOT_PUBLIC_PORT ?? process.env.PORT ?? "8080", 10);
const STATE_DIR = process.env.CLAWDBOT_STATE_DIR?.trim() || path.join(os.homedir(), ".clawdbot");
const WORKSPACE_DIR = process.env.CLAWDBOT_WORKSPACE_DIR?.trim() || path.join(STATE_DIR, "workspace");

// Protect /setup with a user-provided password.
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Gateway admin token (protects Clawdbot gateway + Control UI).
// Must be stable across restarts. If not provided via env, persist it in the state dir.
function resolveGatewayToken() {
  const envTok = process.env.CLAWDBOT_GATEWAY_TOKEN?.trim();
  if (envTok) return envTok;

  const tokenPath = path.join(STATE_DIR, "gateway.token");
  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    // ignore
  }

  const generated = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
  } catch {
    // best-effort
  }
  return generated;
}

const CLAWDBOT_GATEWAY_TOKEN = resolveGatewayToken();
process.env.CLAWDBOT_GATEWAY_TOKEN = CLAWDBOT_GATEWAY_TOKEN;

// Where the gateway will listen internally (we proxy to it).
const INTERNAL_GATEWAY_PORT = Number.parseInt(process.env.INTERNAL_GATEWAY_PORT ?? "18789", 10);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Always run the built-from-source CLI entry directly to avoid PATH/global-install mismatches.
const CLAWDBOT_ENTRY = process.env.CLAWDBOT_ENTRY?.trim() || "/clawdbot/dist/entry.js";
const CLAWDBOT_NODE = process.env.CLAWDBOT_NODE?.trim() || "node";

function clawArgs(args) {
  return [CLAWDBOT_ENTRY, ...args];
}

function configPath() {
  return process.env.CLAWDBOT_CONFIG_PATH?.trim() || path.join(STATE_DIR, "clawdbot.json");
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${GATEWAY_TARGET}/clawdbot`, { method: "GET" });
      // Any HTTP response means the port is open.
      if (res) return true;
    } catch {
      // not ready
    }
    await sleep(250);
  }
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    CLAWDBOT_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(CLAWDBOT_NODE, clawArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      CLAWDBOT_STATE_DIR: STATE_DIR,
      CLAWDBOT_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
  });
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 20_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

async function restartGateway() {
  if (gatewayProc) {
    try {
      gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    // Give it a moment to exit and release the port.
    await sleep(750);
    gatewayProc = null;
  }
  return ensureGatewayRunning();
}

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send("SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.");
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Clawdbot Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (password !== SETUP_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="Clawdbot Setup"');
    return res.status(401).send("Invalid password");
  }
  return next();
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Minimal health endpoint for Railway.
app.get("/setup/healthz", (_req, res) => res.json({ ok: true }));

app.get("/setup/app.js", requireSetupAuth, (_req, res) => {
  // Serve JS for /setup (kept external to avoid inline encoding/template issues)
  res.type("application/javascript");
  res.send(fs.readFileSync(path.join(process.cwd(), "src", "setup-app.js"), "utf8"));
});

app.get("/setup", requireSetupAuth, (_req, res) => {
  // No inline <script>: serve JS from /setup/app.js to avoid any encoding/template-literal issues.
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clawdbot Setup</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; margin: 2rem; max-width: 900px; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 1.25rem; margin: 1rem 0; }
    label { display:block; margin-top: 0.75rem; font-weight: 600; }
    input, select { width: 100%; padding: 0.6rem; margin-top: 0.25rem; }
    button { padding: 0.8rem 1.2rem; border-radius: 10px; border: 0; background: #111; color: #fff; font-weight: 700; cursor: pointer; }
    code { background: #f6f6f6; padding: 0.1rem 0.3rem; border-radius: 6px; }
    .muted { color: #555; }
  </style>
</head>
<body>
  <h1>Clawdbot Setup</h1>
  <p class="muted">This wizard configures Clawdbot by running the same onboarding command it uses in the terminal, but from the browser.</p>

  <div class="card">
    <h2>Status</h2>
    <div id="status">Loading...</div>
    <div style="margin-top: 0.75rem">
      <a href="/clawdbot" target="_blank">Open Clawdbot UI</a>
      &nbsp;|&nbsp;
      <a href="/setup/export" target="_blank">Download backup (.tar.gz)</a>
    </div>
  </div>

  <div class="card">
    <h2>1) Model/auth provider</h2>
    <p class="muted">Matches the groups shown in the terminal onboarding.</p>
    <label>Provider group</label>
    <select id="authGroup"></select>

    <label>Auth method</label>
    <select id="authChoice"></select>

    <label>Key / Token (if required)</label>
    <input id="authSecret" type="password" placeholder="Paste API key / token if applicable" />

    <label>Wizard flow</label>
    <select id="flow">
      <option value="quickstart">quickstart</option>
      <option value="advanced">advanced</option>
      <option value="manual">manual</option>
    </select>
  </div>

  <div class="card">
    <h2>2) Optional: Channels</h2>
    <p class="muted">You can also add channels later inside Clawdbot, but this helps you get messaging working immediately.</p>

    <label>Telegram bot token (optional)</label>
    <input id="telegramToken" type="password" placeholder="123456:ABC..." />
    <div class="muted" style="margin-top: 0.25rem">
      Get it from BotFather: open Telegram, message <code>@BotFather</code>, run <code>/newbot</code>, then copy the token.
    </div>

    <label>Discord bot token (optional)</label>
    <input id="discordToken" type="password" placeholder="Bot token" />
    <div class="muted" style="margin-top: 0.25rem">
      Get it from the Discord Developer Portal: create an application, add a Bot, then copy the Bot Token.<br/>
      <strong>Important:</strong> Enable <strong>MESSAGE CONTENT INTENT</strong> in Bot → Privileged Gateway Intents, or the bot will crash on startup.
    </div>

    <label>Slack bot token (optional)</label>
    <input id="slackBotToken" type="password" placeholder="xoxb-..." />

    <label>Slack app token (optional)</label>
    <input id="slackAppToken" type="password" placeholder="xapp-..." />
  </div>

  <div class="card">
    <h2>3) Run onboarding</h2>
    <button id="run">Run setup</button>
    <button id="pairingApprove" style="background:#1f2937; margin-left:0.5rem">Approve pairing</button>
    <button id="reset" style="background:#444; margin-left:0.5rem">Reset setup</button>
    <pre id="log" style="white-space:pre-wrap"></pre>
    <p class="muted">Reset deletes the Clawdbot config file so you can rerun onboarding. Pairing approval lets you grant DM access when dmPolicy=pairing.</p>
  </div>

  <script src="/setup/app.js"></script>
</body>
</html>`);
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  const version = await runCmd(CLAWDBOT_NODE, clawArgs(["--version"]));
  const channelsHelp = await runCmd(CLAWDBOT_NODE, clawArgs(["channels", "add", "--help"]));

  // We reuse Clawdbot's own auth-choice grouping logic indirectly by hardcoding the same group defs.
  // This is intentionally minimal; later we can parse the CLI help output to stay perfectly in sync.
  const authGroups = [
    { value: "openai", label: "OpenAI", hint: "Codex OAuth + API key", options: [
      { value: "codex-cli", label: "OpenAI Codex OAuth (Codex CLI)" },
      { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
      { value: "openai-api-key", label: "OpenAI API key" }
    ]},
    { value: "anthropic", label: "Anthropic", hint: "Claude Code CLI + API key", options: [
      { value: "claude-cli", label: "Anthropic token (Claude Code CLI)" },
      { value: "token", label: "Anthropic token (paste setup-token)" },
      { value: "apiKey", label: "Anthropic API key" }
    ]},
    { value: "google", label: "Google", hint: "Gemini API key + OAuth", options: [
      { value: "gemini-api-key", label: "Google Gemini API key" },
      { value: "google-antigravity", label: "Google Antigravity OAuth" },
      { value: "google-gemini-cli", label: "Google Gemini CLI OAuth" }
    ]},
    { value: "openrouter", label: "OpenRouter", hint: "API key", options: [
      { value: "openrouter-api-key", label: "OpenRouter API key" }
    ]},
    { value: "ai-gateway", label: "Vercel AI Gateway", hint: "API key", options: [
      { value: "ai-gateway-api-key", label: "Vercel AI Gateway API key" }
    ]},
    { value: "moonshot", label: "Moonshot AI", hint: "Kimi K2 + Kimi Code", options: [
      { value: "moonshot-api-key", label: "Moonshot AI API key" },
      { value: "kimi-code-api-key", label: "Kimi Code API key" }
    ]},
    { value: "zai", label: "Z.AI (GLM 4.7)", hint: "API key", options: [
      { value: "zai-api-key", label: "Z.AI (GLM 4.7) API key" }
    ]},
    { value: "minimax", label: "MiniMax", hint: "M2.1 (recommended)", options: [
      { value: "minimax-api", label: "MiniMax M2.1" },
      { value: "minimax-api-lightning", label: "MiniMax M2.1 Lightning" }
    ]},
    { value: "qwen", label: "Qwen", hint: "OAuth", options: [
      { value: "qwen-portal", label: "Qwen OAuth" }
    ]},
    { value: "copilot", label: "Copilot", hint: "GitHub + local proxy", options: [
      { value: "github-copilot", label: "GitHub Copilot (GitHub device login)" },
      { value: "copilot-proxy", label: "Copilot Proxy (local)" }
    ]},
    { value: "synthetic", label: "Synthetic", hint: "Anthropic-compatible (multi-model)", options: [
      { value: "synthetic-api-key", label: "Synthetic API key" }
    ]},
    { value: "opencode-zen", label: "OpenCode Zen", hint: "API key", options: [
      { value: "opencode-zen", label: "OpenCode Zen (multi-model proxy)" }
    ]}
  ];

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    clawdbotVersion: version.output.trim(),
    channelsAddHelp: channelsHelp.output,
    authGroups,
  });
});

function buildOnboardArgs(payload) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    // The wrapper owns public networking; keep the gateway internal.
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    CLAWDBOT_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart"
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    // Map secret to correct flag for common choices.
    const secret = (payload.authSecret || "").trim();
    const map = {
      "openai-api-key": "--openai-api-key",
      "apiKey": "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key"
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }

    if (payload.authChoice === "token" && secret) {
      // This is the Anthropics setup-token flow.
      args.push("--token-provider", "anthropic", "--token", secret);
    }
  }

  return args;
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        CLAWDBOT_STATE_DIR: STATE_DIR,
        CLAWDBOT_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  try {
    if (isConfigured()) {
      await ensureGatewayRunning();
      return res.json({ ok: true, output: "Already configured.\nUse Reset setup if you want to rerun onboarding.\n" });
    }

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  const payload = req.body || {};
  const onboardArgs = buildOnboardArgs(payload);
  const onboard = await runCmd(CLAWDBOT_NODE, clawArgs(onboardArgs));

  let extra = "";

  const ok = onboard.code === 0 && isConfigured();

  // Optional channel setup (only after successful onboarding, and only if the installed CLI supports it).
  if (ok) {
    // Ensure gateway token is written into config so the browser UI can authenticate reliably.
    // (We also enforce loopback bind since the wrapper proxies externally.)
    await runCmd(CLAWDBOT_NODE, clawArgs(["config", "set", "gateway.auth.mode", "token"]));
    await runCmd(CLAWDBOT_NODE, clawArgs(["config", "set", "gateway.auth.token", CLAWDBOT_GATEWAY_TOKEN]));
    await runCmd(CLAWDBOT_NODE, clawArgs(["config", "set", "gateway.bind", "loopback"]));
    await runCmd(CLAWDBOT_NODE, clawArgs(["config", "set", "gateway.port", String(INTERNAL_GATEWAY_PORT)]));

    const channelsHelp = await runCmd(CLAWDBOT_NODE, clawArgs(["channels", "add", "--help"]));
    const helpText = channelsHelp.output || "";

    const supports = (name) => helpText.includes(name);

    if (payload.telegramToken?.trim()) {
      if (!supports("telegram")) {
        extra += "\n[telegram] skipped (this clawdbot build does not list telegram in `channels add --help`)\n";
      } else {
        // Avoid `channels add` here (it has proven flaky across builds); write config directly.
        const token = payload.telegramToken.trim();
        const cfgObj = {
          enabled: true,
          dmPolicy: "pairing",
          botToken: token,
          groupPolicy: "allowlist",
          streamMode: "partial",
        };
        const set = await runCmd(
          CLAWDBOT_NODE,
          clawArgs(["config", "set", "--json", "channels.telegram", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(CLAWDBOT_NODE, clawArgs(["config", "get", "channels.telegram"]));
        extra += `\n[telegram config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[telegram verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    if (payload.discordToken?.trim()) {
      if (!supports("discord")) {
        extra += "\n[discord] skipped (this clawdbot build does not list discord in `channels add --help`)\n";
      } else {
        const token = payload.discordToken.trim();
        const cfgObj = {
          enabled: true,
          token,
          groupPolicy: "allowlist",
          dm: {
            policy: "pairing",
          },
        };
        const set = await runCmd(
          CLAWDBOT_NODE,
          clawArgs(["config", "set", "--json", "channels.discord", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(CLAWDBOT_NODE, clawArgs(["config", "get", "channels.discord"]));
        extra += `\n[discord config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[discord verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
      if (!supports("slack")) {
        extra += "\n[slack] skipped (this clawdbot build does not list slack in `channels add --help`)\n";
      } else {
        const cfgObj = {
          enabled: true,
          botToken: payload.slackBotToken?.trim() || undefined,
          appToken: payload.slackAppToken?.trim() || undefined,
        };
        const set = await runCmd(
          CLAWDBOT_NODE,
          clawArgs(["config", "set", "--json", "channels.slack", JSON.stringify(cfgObj)]),
        );
        const get = await runCmd(CLAWDBOT_NODE, clawArgs(["config", "get", "channels.slack"]));
        extra += `\n[slack config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
        extra += `\n[slack verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
      }
    }

    // Apply changes immediately.
    await restartGateway();
  }

  return res.status(ok ? 200 : 500).json({
    ok,
    output: `${onboard.output}${extra}`,
  });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res.status(500).json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(CLAWDBOT_NODE, clawArgs(["--version"]));
  const help = await runCmd(CLAWDBOT_NODE, clawArgs(["channels", "add", "--help"]));
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(process.env.CLAWDBOT_GATEWAY_TOKEN?.trim()),
      gatewayTokenPersisted: fs.existsSync(path.join(STATE_DIR, "gateway.token")),
      railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
    clawdbot: {
      entry: CLAWDBOT_ENTRY,
      node: CLAWDBOT_NODE,
      version: v.output.trim(),
      channelsAddHelpIncludesTelegram: help.output.includes("telegram"),
    },
  });
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res.status(400).json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(CLAWDBOT_NODE, clawArgs(["pairing", "approve", String(channel), String(code)]));
  return res.status(r.code === 0 ? 200 : 500).json({ ok: r.code === 0, output: r.output });
});

// Execute arbitrary clawdbot commands (for config, etc.)
app.post("/setup/api/exec", requireSetupAuth, async (req, res) => {
  const { args } = req.body || {};
  if (!args || !Array.isArray(args)) {
    return res.status(400).json({ ok: false, error: "Missing args array" });
  }
  const r = await runCmd(CLAWDBOT_NODE, clawArgs(args.map(String)));
  return res.status(r.code === 0 ? 200 : 500).json({ ok: r.code === 0, output: r.output });
});

// WhatsApp QR code endpoint - streams terminal output with larger font
app.get("/setup/whatsapp-qr", requireSetupAuth, async (_req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WhatsApp QR Code</title>
  <style>
    body {
      background: #000;
      color: #fff;
      font-family: monospace;
      padding: 20px;
      margin: 0;
    }
    h1 { color: #25D366; }
    #qr {
      font-size: 8px;
      line-height: 8px;
      letter-spacing: 0px;
      white-space: pre;
      background: #fff;
      color: #000;
      padding: 20px;
      display: inline-block;
      margin: 20px 0;
    }
    #log {
      font-size: 12px;
      margin-top: 20px;
      padding: 10px;
      background: #111;
      max-height: 200px;
      overflow-y: auto;
    }
    .instructions {
      background: #222;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <h1>📱 WhatsApp QR Code</h1>
  <div class="instructions">
    <p><strong>Instructions:</strong></p>
    <ol>
      <li>Open WhatsApp on your phone</li>
      <li>Tap <strong>Settings → Linked Devices → Link a Device</strong></li>
      <li>Point your camera at the QR code below</li>
    </ol>
    <p><em>QR codes expire every ~30 seconds. Refresh the page if needed.</em></p>
  </div>
  <div id="qr">Loading QR code...</div>
  <div id="log"></div>
  <script>
    const qrEl = document.getElementById('qr');
    const logEl = document.getElementById('log');

    async function fetchQR() {
      qrEl.textContent = 'Starting WhatsApp link process...';
      try {
        const res = await fetch('/setup/api/whatsapp-qr-stream', { credentials: 'same-origin' });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Look for QR codes in the output
          const lines = buffer.split('\\n');
          let qrLines = [];
          let inQR = false;

          for (const line of lines) {
            if (line.includes('▄') || line.includes('█') || line.includes('▀')) {
              qrLines.push(line);
              inQR = true;
            } else if (inQR && qrLines.length > 5) {
              // End of QR
              break;
            }
          }

          if (qrLines.length > 10) {
            qrEl.textContent = qrLines.join('\\n');
          }

          if (buffer.includes('Successfully linked') || buffer.includes('connected')) {
            qrEl.innerHTML = '<span style="color:green;font-size:24px">✅ WhatsApp Connected!</span>';
            logEl.textContent = 'WhatsApp linked successfully. You can close this page.';
            return;
          }
        }
      } catch (e) {
        qrEl.textContent = 'Error: ' + e.message + '. Try refreshing.';
      }
    }

    fetchQR();
  </script>
</body>
</html>`);
});

app.get("/setup/api/whatsapp-qr-stream", requireSetupAuth, async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");

  const proc = childProcess.spawn(CLAWDBOT_NODE, clawArgs(["channels", "login", "--channel", "whatsapp", "--verbose"]), {
    env: {
      ...process.env,
      CLAWDBOT_STATE_DIR: STATE_DIR,
      CLAWDBOT_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  proc.stdout?.on("data", (d) => res.write(d));
  proc.stderr?.on("data", (d) => res.write(d));

  proc.on("close", () => res.end());
  proc.on("error", (err) => {
    res.write(`Error: ${err.message}\n`);
    res.end();
  });

  req.on("close", () => {
    try { proc.kill(); } catch {}
  });

  // Timeout after 3 minutes
  setTimeout(() => {
    try { proc.kill(); } catch {}
    res.end();
  }, 180000);
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  // Minimal reset: delete the config file so /setup can rerun.
  // Keep credentials/sessions/workspace by default.
  try {
    fs.rmSync(configPath(), { force: true });
    res.type("text/plain").send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

app.post("/setup/api/restart-gateway", requireSetupAuth, async (_req, res) => {
  try {
    await restartGateway();
    res.json({ ok: true, message: "Gateway restarted" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/setup/export", requireSetupAuth, async (_req, res) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader("content-type", "application/gzip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="clawdbot-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz"`,
  );

  // Prefer exporting from a common /data root so archives are easy to inspect and restore.
  // This preserves dotfiles like /data/.clawdbot/clawdbot.json.
  const stateAbs = path.resolve(STATE_DIR);
  const workspaceAbs = path.resolve(WORKSPACE_DIR);

  const dataRoot = "/data";
  const underData = (p) => p === dataRoot || p.startsWith(dataRoot + path.sep);

  let cwd = "/";
  let paths = [stateAbs, workspaceAbs].map((p) => p.replace(/^\//, ""));

  if (underData(stateAbs) && underData(workspaceAbs)) {
    cwd = dataRoot;
    // We export relative to /data so the archive contains: .clawdbot/... and workspace/...
    paths = [
      path.relative(dataRoot, stateAbs) || ".",
      path.relative(dataRoot, workspaceAbs) || ".",
    ];
  }

  const stream = tar.c(
    {
      gzip: true,
      portable: true,
      noMtime: true,
      cwd,
      onwarn: () => {},
    },
    paths,
  );

  stream.on("error", (err) => {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });

  stream.pipe(res);
});

// ============ ETSY OAUTH ============
const ETSY_API_KEY = process.env.ETSY_API_KEY || "hz8i5i4kopodt3sza52qoeuh";
const ETSY_API_SECRET = process.env.ETSY_API_SECRET || "32ig95w1w8";
const ETSY_REDIRECT_URI = process.env.ETSY_REDIRECT_URI || "https://clawdbot-va-production.up.railway.app/setup/etsy/callback";
const ETSY_TOKEN_PATH = path.join(STATE_DIR, "etsy-token.json");

// Store PKCE verifier temporarily (in production, use session/redis)
let etsyPkceVerifier = null;

function base64URLEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE() {
  const verifier = base64URLEncode(crypto.randomBytes(32));
  const challenge = base64URLEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function getEtsyToken() {
  try {
    if (fs.existsSync(ETSY_TOKEN_PATH)) {
      return JSON.parse(fs.readFileSync(ETSY_TOKEN_PATH, "utf8"));
    }
  } catch {}
  return null;
}

function saveEtsyToken(token) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(ETSY_TOKEN_PATH, JSON.stringify(token, null, 2), { mode: 0o600 });
}

async function refreshEtsyToken() {
  const token = getEtsyToken();
  if (!token?.refresh_token) return null;

  try {
    const res = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: ETSY_API_KEY,
        refresh_token: token.refresh_token,
      }),
    });

    if (res.ok) {
      const newToken = await res.json();
      newToken.obtained_at = Date.now();
      saveEtsyToken(newToken);
      return newToken;
    }
  } catch (err) {
    console.error("[etsy] refresh failed:", err);
  }
  return null;
}

async function getValidEtsyToken() {
  let token = getEtsyToken();
  if (!token) return null;

  // Check if token is expired (expires_in is in seconds, obtained_at is ms)
  const expiresAt = (token.obtained_at || 0) + (token.expires_in || 3600) * 1000;
  if (Date.now() > expiresAt - 60000) {
    // Refresh if expires within 1 minute
    token = await refreshEtsyToken();
  }
  return token;
}

// Etsy OAuth - Start authorization
app.get("/setup/etsy/auth", requireSetupAuth, (_req, res) => {
  const { verifier, challenge } = generatePKCE();
  etsyPkceVerifier = verifier;

  const state = crypto.randomBytes(16).toString("hex");
  const scopes = "transactions_r transactions_w listings_r listings_w shops_r";

  const authUrl = new URL("https://www.etsy.com/oauth/connect");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", ETSY_API_KEY);
  authUrl.searchParams.set("redirect_uri", ETSY_REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.redirect(authUrl.toString());
});

// Etsy OAuth - Get auth URL for external use
app.get("/setup/api/etsy/auth-url", requireSetupAuth, (_req, res) => {
  const { verifier, challenge } = generatePKCE();
  etsyPkceVerifier = verifier;

  // Also save verifier to file in case server restarts
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, "etsy-pkce-verifier.txt"), verifier, { mode: 0o600 });

  const state = crypto.randomBytes(16).toString("hex");
  const scopes = "transactions_r transactions_w listings_r listings_w shops_r";

  const authUrl = new URL("https://www.etsy.com/oauth/connect");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", ETSY_API_KEY);
  authUrl.searchParams.set("redirect_uri", ETSY_REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.json({
    authUrl: authUrl.toString(),
    instructions: "Open this URL in a browser where you are logged into Etsy, authorize the app, then you will be redirected back."
  });
});

// Etsy OAuth - Callback
app.get("/setup/etsy/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`Etsy OAuth error: ${error} - ${error_description}`);
  }

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  // Try to get verifier from memory or file
  let verifier = etsyPkceVerifier;
  if (!verifier) {
    try {
      verifier = fs.readFileSync(path.join(STATE_DIR, "etsy-pkce-verifier.txt"), "utf8").trim();
    } catch {}
  }

  if (!verifier) {
    return res.status(400).send("PKCE verifier not found. Please restart the OAuth flow.");
  }

  try {
    const tokenRes = await fetch("https://api.etsy.com/v3/public/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: ETSY_API_KEY,
        redirect_uri: ETSY_REDIRECT_URI,
        code: code,
        code_verifier: verifier,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return res.status(400).send(`Token exchange failed: ${errText}`);
    }

    const token = await tokenRes.json();
    token.obtained_at = Date.now();
    saveEtsyToken(token);

    // Clean up verifier
    etsyPkceVerifier = null;
    try { fs.rmSync(path.join(STATE_DIR, "etsy-pkce-verifier.txt"), { force: true }); } catch {}

    res.send(`
      <!doctype html>
      <html>
      <head><title>Etsy Connected!</title></head>
      <body style="font-family: sans-serif; text-align: center; padding: 50px;">
        <h1 style="color: green;">✅ Etsy Connected Successfully!</h1>
        <p>Clawd can now access your Etsy orders and listings.</p>
        <p>You can close this window.</p>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`Error: ${err.message}`);
  }
});

// Etsy API - Check status
app.get("/setup/api/etsy/status", requireSetupAuth, async (_req, res) => {
  const token = await getValidEtsyToken();
  if (!token) {
    return res.json({ connected: false, message: "Not connected. Use /setup/etsy/auth to connect." });
  }

  // Test the token by fetching shop info
  try {
    const shopRes = await fetch("https://openapi.etsy.com/v3/application/users/me", {
      headers: {
        "x-api-key": ETSY_API_KEY,
        "Authorization": `Bearer ${token.access_token}`,
      },
    });

    if (shopRes.ok) {
      const user = await shopRes.json();
      return res.json({
        connected: true,
        user_id: user.user_id,
        shop_id: user.shop_id,
        message: "Connected and working!"
      });
    } else {
      return res.json({ connected: false, message: "Token invalid, please reconnect." });
    }
  } catch (err) {
    return res.json({ connected: false, message: err.message });
  }
});

// ============ END ETSY OAUTH ============

// ============ PINTEREST OAUTH ============

const PINTEREST_APP_ID = process.env.PINTEREST_APP_ID;
const PINTEREST_APP_SECRET = process.env.PINTEREST_APP_SECRET;
const PINTEREST_TOKEN_PATH = path.join(WORKSPACE_DIR, 'pinterest-token.json');

// Pinterest OAuth callback - handles the redirect from Pinterest
app.get("/setup/api/pinterest/callback", async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(`
      <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>Pinterest Authorization Failed</h1>
        <p>Error: ${error}</p>
        <p><a href="/setup">Back to Setup</a></p>
      </body></html>
    `);
  }

  if (!code) {
    return res.send(`
      <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>Missing Authorization Code</h1>
        <p><a href="/setup">Back to Setup</a></p>
      </body></html>
    `);
  }

  if (!PINTEREST_APP_ID || !PINTEREST_APP_SECRET) {
    return res.status(500).send('Pinterest API credentials not configured');
  }

  try {
    // Exchange code for token
    const authHeader = Buffer.from(`${PINTEREST_APP_ID}:${PINTEREST_APP_SECRET}`).toString('base64');
    const callbackUrl = `https://${req.get('host')}/setup/api/pinterest/callback`;

    const tokenRes = await fetch('https://api.pinterest.com/v5/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: callbackUrl
      }).toString()
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[pinterest] Token exchange failed:', tokenData);
      return res.send(`
        <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>Token Exchange Failed</h1>
          <p>${tokenData.error_description || tokenData.error || 'Unknown error'}</p>
          <p><a href="/setup">Back to Setup</a></p>
        </body></html>
      `);
    }

    // Save token
    const token = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_type: tokenData.token_type,
      expires_at: Date.now() + (tokenData.expires_in * 1000),
      scope: tokenData.scope
    };

    await fs.promises.mkdir(path.dirname(PINTEREST_TOKEN_PATH), { recursive: true });
    await fs.promises.writeFile(PINTEREST_TOKEN_PATH, JSON.stringify(token, null, 2));

    // Get user info
    const userRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { 'Authorization': `Bearer ${token.access_token}` }
    });
    const userData = await userRes.json();

    console.log('[pinterest] Connected:', userData.username);

    return res.send(`
      <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>Pinterest Connected!</h1>
        <p>Account: <strong>${userData.username || 'Connected'}</strong></p>
        <p>Clawd can now create pins and manage boards.</p>
        <p style="margin-top: 20px;"><a href="/setup">Back to Setup</a></p>
      </body></html>
    `);

  } catch (err) {
    console.error('[pinterest] OAuth error:', err);
    return res.status(500).send(`
      <html><body style="font-family: system-ui; padding: 40px; text-align: center;">
        <h1>Pinterest Connection Error</h1>
        <p>${err.message}</p>
        <p><a href="/setup">Back to Setup</a></p>
      </body></html>
    `);
  }
});

// Pinterest auth URL generator
app.get("/setup/api/pinterest/auth-url", requireSetupAuth, (_req, res) => {
  if (!PINTEREST_APP_ID) {
    return res.json({ error: 'PINTEREST_APP_ID not configured' });
  }

  const callbackUrl = `https://clawdbot-va-production.up.railway.app/setup/api/pinterest/callback`;
  const scopes = 'boards:read,boards:write,pins:read,pins:write,user_accounts:read';
  const state = Math.random().toString(36).substring(7);

  const authUrl = `https://www.pinterest.com/oauth/?` + new URLSearchParams({
    client_id: PINTEREST_APP_ID,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: scopes,
    state: state
  }).toString();

  res.json({ auth_url: authUrl });
});

// Pinterest status check
app.get("/setup/api/pinterest/status", requireSetupAuth, async (_req, res) => {
  try {
    if (!fs.existsSync(PINTEREST_TOKEN_PATH)) {
      return res.json({ connected: false, message: 'Not connected' });
    }

    const token = JSON.parse(await fs.promises.readFile(PINTEREST_TOKEN_PATH, 'utf8'));
    if (!token.access_token) {
      return res.json({ connected: false, message: 'Invalid token' });
    }

    const userRes = await fetch('https://api.pinterest.com/v5/user_account', {
      headers: { 'Authorization': `Bearer ${token.access_token}` }
    });

    if (userRes.ok) {
      const userData = await userRes.json();
      return res.json({
        connected: true,
        username: userData.username,
        profile_url: `https://pinterest.com/${userData.username}`
      });
    } else {
      return res.json({ connected: false, message: 'Token expired' });
    }
  } catch (err) {
    return res.json({ connected: false, message: err.message });
  }
});

// ============ END PINTEREST OAUTH ============

// ============ ALERT SENDER ============
const SAAS_MONITOR_TOKEN = process.env.SAAS_MONITOR_TOKEN?.trim();

// Send an alert message to Atilla via Telegram (primary channel).
async function sendAlert(message, opts = {}) {
  const channels = opts.channels || ["telegram"];
  const results = [];

  for (const channel of channels) {
    const args = ["dm", "send", "--channel", channel];
    if (channel === "whatsapp") {
      args.push("--to", opts.whatsappTo || "+905335010211");
    }
    args.push("--message", message);
    const r = await runCmd(CLAWDBOT_NODE, clawArgs(args));
    results.push({ channel, code: r.code, output: r.output?.substring(0, 200) });
    console.log(`[alert] ${channel}: exit=${r.code}`);
  }

  return results;
}

// Internal endpoint for monitoring scripts to trigger alerts.
// Auth: X-Monitor-Token header (same as webhook endpoint).
app.post("/internal/alert", async (req, res) => {
  const token = req.headers["x-monitor-token"];
  if (!SAAS_MONITOR_TOKEN || token !== SAAS_MONITOR_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const { message, channels } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: "missing message" });
  }

  try {
    const results = await sendAlert(message, { channels });
    res.json({ ok: true, results });
  } catch (err) {
    console.error("[/internal/alert] error:", err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============ SAAS MONITORING WEBHOOKS ============

const EC2_HEARTBEAT_FILE = path.join(WORKSPACE_DIR, "logs", "ec2-heartbeats.json");

function updateEC2CronHeartbeat(event) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(EC2_HEARTBEAT_FILE, "utf8"));
  } catch {}

  const cronName = event.cron_name || "unknown";
  state[cronName] = {
    last_seen: event.timestamp || new Date().toISOString(),
    status: event.status || "success",
    detail: event.detail || "",
    received_at: new Date().toISOString()
  };

  try {
    const logDir = path.join(WORKSPACE_DIR, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    // Atomic write: write to temp file then rename
    const tmpFile = EC2_HEARTBEAT_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
    fs.renameSync(tmpFile, EC2_HEARTBEAT_FILE);
  } catch (err) {
    console.error("[ec2-heartbeat] write failed:", err);
  }
}

function formatWebhookAlert(event) {
  const appName = (event.app || "Unknown").toUpperCase();
  const type = event.type.replace(/_/g, " ").toUpperCase();
  const detail = event.detail || event.message || event.email || "";
  const cronName = event.cron_name ? ` (${event.cron_name})` : "";
  const ts = new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Belgrade", hour: "2-digit", minute: "2-digit" });
  return `${appName} ALERT: ${type}${cronName}\n${detail}\nReceived at ${ts} CET`;
}

app.post("/webhooks/saas", async (req, res) => {
  const token = req.headers["x-monitor-token"];
  if (!SAAS_MONITOR_TOKEN || token !== SAAS_MONITOR_TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const event = req.body;
  if (!event || !event.type) {
    return res.status(400).json({ error: "missing event type" });
  }

  const logDir = path.join(WORKSPACE_DIR, "logs");
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}

  const logLine = JSON.stringify({ ...event, received_at: new Date().toISOString() }) + "\n";
  fs.appendFileSync(path.join(logDir, "saas-webhooks.jsonl"), logLine);

  const urgentTypes = [
    "payment_failed", "subscription_cancelled", "bank_sync_error",
    "scraper_failed", "high_error_rate", "queue_stuck", "app_down",
    "support_ticket", "cron_failed"
  ];
  if (urgentTypes.includes(event.type)) {
    fs.appendFileSync(path.join(logDir, "saas-urgent.jsonl"), logLine);
    // Send alert to Telegram (fire-and-forget)
    const alertMsg = formatWebhookAlert(event);
    sendAlert(alertMsg, { channels: ["telegram"] }).catch(err => {
      console.error("[webhooks/saas] alert send failed:", err);
    });
  }

  // Track EC2 cron heartbeats (for dead man's switch)
  if (event.type === "cron_heartbeat" || event.type === "cron_failed") {
    updateEC2CronHeartbeat(event);
  }

  console.log(`[webhooks/saas] ${event.app || "unknown"}/${event.type}`);
  res.json({ ok: true });
});

// ============ END SAAS MONITORING ============

// ============ EMERGENCY SESSION RESET ============
// Works even when the bot agent is completely stuck/frozen.
// Two access methods:
//   1. POST /api/emergency-reset  (Basic auth with SETUP_PASSWORD)
//   2. GET  /api/emergency-reset?token=<SETUP_PASSWORD>  (bookmarkable on phone)

function emergencyAuth(req, res, next) {
  // Method 1: query param token (for phone bookmarks)
  if (req.query.token && SETUP_PASSWORD && req.query.token === SETUP_PASSWORD) {
    return next();
  }
  // Method 2: Basic auth (same as setup endpoints)
  return requireSetupAuth(req, res, next);
}

async function doEmergencyReset() {
  const sessionsDir = path.join(STATE_DIR, "agents", "main", "sessions");
  const results = { deleted: [], reset: false, error: null };

  // Step 1: Find and delete oversized session files (>500KB = likely stuck)
  try {
    if (fs.existsSync(sessionsDir)) {
      const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
      for (const file of files) {
        const filePath = path.join(sessionsDir, file);
        const stat = fs.statSync(filePath);
        const sizeKB = Math.round(stat.size / 1024);
        if (stat.size > 512 * 1024) {
          fs.rmSync(filePath, { force: true });
          results.deleted.push({ file, sizeKB });
        }
      }
    }
  } catch (err) {
    console.error("[emergency-reset] session cleanup error:", err);
  }

  // Step 2: Run moltbot sessions reset
  try {
    const r = await runCmd(CLAWDBOT_NODE, clawArgs(["sessions", "reset"]));
    results.reset = r.code === 0;
    results.resetOutput = r.output?.substring(0, 500);
  } catch (err) {
    results.error = String(err);
  }

  // Step 3: Send Telegram confirmation
  const deletedInfo = results.deleted.length > 0
    ? `Deleted ${results.deleted.length} oversized session(s): ${results.deleted.map(d => `${d.file} (${d.sizeKB}KB)`).join(", ")}`
    : "No oversized sessions found";
  const alertMsg = `EMERGENCY RESET completed\n${deletedInfo}\nSession reset: ${results.reset ? "OK" : "failed"}`;
  sendAlert(alertMsg, { channels: ["telegram"] }).catch(() => {});

  return results;
}

app.all("/api/emergency-reset", emergencyAuth, async (_req, res) => {
  try {
    const results = await doEmergencyReset();
    // If accessed via browser (GET), show a simple HTML page
    if (_req.method === "GET") {
      const status = results.reset ? "Reset successful" : "Reset had issues";
      const deleted = results.deleted.length > 0
        ? results.deleted.map(d => `<li>${d.file} (${d.sizeKB}KB)</li>`).join("")
        : "<li>None (all sessions were normal size)</li>";
      return res.type("html").send(`<!doctype html>
<html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto">
<h1>${results.reset ? "&#9989;" : "&#9888;&#65039;"} Emergency Reset</h1>
<h2>${status}</h2>
<h3>Deleted oversized sessions:</h3><ul>${deleted}</ul>
<p>A confirmation was sent to Telegram.</p>
<p><a href="javascript:history.back()">Back</a></p>
</body></html>`);
    }
    return res.json({ ok: true, ...results });
  } catch (err) {
    console.error("[emergency-reset] error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

// ============ END EMERGENCY RESET ============

// Proxy everything else to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

proxy.on("error", (err, _req, _res) => {
  console.error("[proxy]", err);
});

app.use(async (req, res) => {
  // If not configured, force users to /setup for any non-setup routes.
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      return res.status(503).type("text/plain").send(`Gateway not ready: ${String(err)}`);
    }
  }

  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

const server = app.listen(PORT, "0.0.0.0", async () => {
  console.log(`[wrapper] listening on :${PORT}`);
  console.log(`[wrapper] state dir: ${STATE_DIR}`);
  console.log(`[wrapper] workspace dir: ${WORKSPACE_DIR}`);
  console.log(`[wrapper] gateway token: ${CLAWDBOT_GATEWAY_TOKEN ? "(set)" : "(missing)"}`);
  console.log(`[wrapper] gateway target: ${GATEWAY_TARGET}`);
  if (!SETUP_PASSWORD) {
    console.warn("[wrapper] WARNING: SETUP_PASSWORD is not set; /setup will error.");
  }
  // Auto-start gateway on boot if configured (for Railway - channels need to connect immediately)
  if (isConfigured()) {
    console.log("[wrapper] auto-starting gateway...");
    try {
      await ensureGatewayRunning();
      console.log("[wrapper] gateway started successfully");
    } catch (err) {
      console.error("[wrapper] failed to auto-start gateway:", err);
    }
  }
});

server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }
  proxy.ws(req, socket, head, { target: GATEWAY_TARGET });
});

process.on("SIGTERM", () => {
  // Best-effort shutdown
  try {
    if (gatewayProc) gatewayProc.kill("SIGTERM");
  } catch {
    // ignore
  }
  process.exit(0);
});
