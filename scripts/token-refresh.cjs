#!/usr/bin/env node
/**
 * Proactive OAuth Token Refresh for OpenClaw
 *
 * Runs as a cron job to refresh the Anthropic OAuth token BEFORE it expires.
 * OpenClaw's built-in refresh is unreliable — this script handles it independently.
 *
 * Usage:
 *   node /app/scripts/token-refresh.cjs          # Check and refresh if needed (<3h remaining)
 *   node /app/scripts/token-refresh.cjs --force   # Force refresh now
 *   node /app/scripts/token-refresh.cjs --status  # Show token status only
 *   node /app/scripts/token-refresh.cjs --json    # Structured JSON output (for server.js)
 *   node /app/scripts/token-refresh.cjs --force --json --retry  # Full auto-recovery mode
 *
 * Exit codes:
 *   0 = success (refreshed or no refresh needed)
 *   1 = failure (token expired AND refresh failed)
 *   2 = status check: token expired (--status mode only)
 */

const fs = require("fs");
const https = require("https");

const AUTH_PATH = "/data/.clawdbot/agents/main/agent/auth-profiles.json";
const PROFILE_ID = "anthropic:default";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
// Refresh when less than this many ms remaining (3 hours — wider safety margin)
const REFRESH_THRESHOLD_MS = 3 * 60 * 60 * 1000;
const RETRY_DELAYS = [30000, 60000, 120000]; // 30s, 60s, 120s backoff

const args = process.argv.slice(2);
const jsonMode = args.includes("--json");

function log(msg) {
  if (!jsonMode) {
    console.log(`[token-refresh] ${new Date().toISOString()} ${msg}`);
  }
}

function outputJson(obj) {
  console.log(JSON.stringify(obj));
}

function readAuth() {
  try {
    const raw = fs.readFileSync(AUTH_PATH, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    log(`ERROR: Cannot read auth file: ${err.message}`);
    return null;
  }
}

function saveAuth(store) {
  fs.writeFileSync(AUTH_PATH, JSON.stringify(store), "utf8");
}

function refreshToken(refreshTokenStr) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshTokenStr,
    });

    const options = {
      hostname: "console.anthropic.com",
      path: "/v1/oauth/token",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve({
              access: parsed.access_token,
              refresh: parsed.refresh_token,
              expires: Date.now() + parsed.expires_in * 1000 - 5 * 60 * 1000,
            });
          } catch (e) {
            reject(new Error(`Parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on("error", (e) => reject(new Error(`Network error: ${e.message}`)));
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timeout (15s)"));
    });
    req.write(body);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function refreshWithRetry(refreshTokenStr, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await refreshToken(refreshTokenStr);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = RETRY_DELAYS[attempt] || 120000;
        log(`Attempt ${attempt + 1} failed: ${err.message}. Retrying in ${delay / 1000}s...`);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

async function restartGateway() {
  return new Promise((resolve) => {
    const options = {
      hostname: "127.0.0.1",
      port: 8080,
      path: "/setup/api/restart-gateway",
      method: "POST",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from("user:" + process.env.SETUP_PASSWORD).toString("base64"),
      },
    };

    const req = require("http").request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        log(`Gateway restart response: ${res.statusCode}`);
        resolve(true);
      });
    });
    req.on("error", (e) => {
      if (
        e.message.includes("socket hang up") ||
        e.message.includes("ECONNRESET")
      ) {
        log("Gateway restart triggered (connection dropped as expected)");
        resolve(true);
      } else {
        log(`Gateway restart failed: ${e.message}`);
        resolve(false);
      }
    });
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  const forceRefresh = args.includes("--force");
  const statusOnly = args.includes("--status");
  const useRetry = args.includes("--retry");

  const store = readAuth();
  if (!store) {
    if (jsonMode) outputJson({ status: "error", error: "No auth store found" });
    else log("FATAL: No auth store found");
    process.exit(1);
  }

  const cred = store.profiles?.[PROFILE_ID];
  if (!cred || cred.type !== "oauth") {
    if (jsonMode)
      outputJson({
        status: "error",
        error: `Profile ${PROFILE_ID} not found or not OAuth type`,
      });
    else log(`FATAL: Profile ${PROFILE_ID} not found or not OAuth type`);
    process.exit(1);
  }

  const now = Date.now();
  const expiresIn = cred.expires - now;
  const expiresInHours = (expiresIn / (60 * 60 * 1000)).toFixed(1);
  const expiresAt = new Date(cred.expires).toISOString();

  log(`Token status: expires in ${expiresInHours}h (${expiresAt})`);
  log(`Access prefix: ${cred.access.substring(0, 20)}...`);

  if (statusOnly) {
    if (jsonMode) {
      outputJson({
        status: expiresIn <= 0 ? "expired" : expiresIn < REFRESH_THRESHOLD_MS ? "expiring_soon" : "ok",
        expiresIn: `${expiresInHours}h`,
        expiresAt,
        accessPrefix: cred.access.substring(0, 25),
      });
    }
    if (expiresIn <= 0) {
      log("STATUS: EXPIRED");
      process.exit(2);
    } else if (expiresIn < REFRESH_THRESHOLD_MS) {
      log("STATUS: EXPIRING SOON - needs refresh");
      process.exit(1);
    } else {
      log("STATUS: OK");
      process.exit(0);
    }
  }

  const needsRefresh = forceRefresh || expiresIn < REFRESH_THRESHOLD_MS;

  if (!needsRefresh) {
    log(`No refresh needed (${expiresInHours}h remaining > 3h threshold)`);
    if (jsonMode)
      outputJson({
        status: "ok",
        expiresIn: `${expiresInHours}h`,
        message: "no refresh needed",
      });
    return;
  }

  log(
    forceRefresh
      ? "Force refresh requested"
      : `Token expiring soon (${expiresInHours}h left), refreshing...`
  );

  try {
    const newCreds = useRetry
      ? await refreshWithRetry(cred.refresh)
      : await refreshToken(cred.refresh);
    const newExpiresInHours = (
      (newCreds.expires - Date.now()) /
      (60 * 60 * 1000)
    ).toFixed(1);

    store.profiles[PROFILE_ID] = {
      ...cred,
      access: newCreds.access,
      refresh: newCreds.refresh,
      expires: newCreds.expires,
    };
    saveAuth(store);

    log(`REFRESHED! New token expires in ${newExpiresInHours}h`);
    log(`New access prefix: ${newCreds.access.substring(0, 20)}...`);

    log("Restarting gateway...");
    const ok = await restartGateway();
    if (ok) {
      log("Gateway restarted successfully");
    } else {
      log("WARNING: Gateway restart failed - token saved but gateway may use old one");
    }

    if (jsonMode)
      outputJson({
        status: "refreshed",
        expiresIn: `${newExpiresInHours}h`,
        newAccessPrefix: newCreds.access.substring(0, 25),
        gatewayRestarted: ok,
      });
  } catch (err) {
    log(`REFRESH FAILED: ${err.message}`);

    if (jsonMode)
      outputJson({
        status: "failed",
        error: err.message,
        tokenExpired: expiresIn <= 0,
        expiresIn: `${expiresInHours}h`,
      });

    if (expiresIn > 0) {
      log(`Token still valid for ${expiresInHours}h - will retry next run`);
    } else {
      log(
        "CRITICAL: Token expired AND refresh failed! Manual intervention needed."
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  if (jsonMode) outputJson({ status: "error", error: err.message });
  else log(`FATAL: ${err.message}`);
  process.exit(1);
});
