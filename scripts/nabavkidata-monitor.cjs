#!/usr/bin/env node
/**
 * Nabavkidata EC2 Uptime Monitor
 *
 * Polls api.nabavkidata.com every 5 minutes (via moltbot cron).
 * Sends Telegram alerts on state transitions (up->down, down->up)
 * and periodic reminders while down (every 30 minutes).
 *
 * Usage:
 *   node /app/scripts/nabavkidata-monitor.cjs
 *
 * Environment:
 *   NABAVKIDATA_URL     - default: https://api.nabavkidata.com
 *   SAAS_MONITOR_TOKEN  - shared secret for alert endpoint
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const LOG_DIR = '/data/workspace/logs';
const STATE_FILE = path.join(LOG_DIR, 'nabavkidata-monitor-state.json');
const LOG_FILE = path.join(LOG_DIR, 'nabavkidata-monitor.jsonl');

const NABAVKIDATA_URL = process.env.NABAVKIDATA_URL || 'https://api.nabavkidata.com';
const TOKEN = process.env.SAAS_MONITOR_TOKEN || '';
const ALERT_URL = 'http://127.0.0.1:8080/internal/alert';

// Alert cooldowns (ms)
const REMINDER_INTERVAL = 30 * 60 * 1000; // 30 minutes
const DEGRADED_COOLDOWN = 30 * 60 * 1000; // 30 minutes

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function appendLog(entry) {
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {
      status: 'unknown',
      since: null,
      last_alert_at: null,
      consecutive_failures: 0,
      last_check_at: null,
      health_details: null,
      degraded_alerts: {}
    };
  }
}

function writeState(state) {
  ensureLogDir();
  const tmpFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, STATE_FILE);
}

function nowISO() {
  return new Date().toISOString();
}

function timeCET() {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit'
  });
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function curlFetch(url, timeoutSec = 10) {
  const headers = TOKEN ? `-H "X-Monitor-Token: ${TOKEN}"` : '';
  try {
    const raw = execSync(
      `curl -sf --connect-timeout 5 --max-time ${timeoutSec} ${headers} "${url}" 2>/dev/null`,
      { encoding: 'utf8', timeout: (timeoutSec + 5) * 1000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return raw;
  } catch {
    return null;
  }
}

function tryParseJson(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Send alert via the internal alert endpoint
function sendAlertMessage(message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message, channels: ['telegram'] });
    const req = http.request(ALERT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Monitor-Token': TOKEN
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`[alert] sent (status=${res.statusCode})`);
        resolve({ ok: res.statusCode === 200, response: data });
      });
    });
    req.on('error', (err) => {
      console.error(`[alert] failed: ${err.message}`);
      resolve({ ok: false, error: err.message });
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Health checks
// ---------------------------------------------------------------------------

function checkHealth() {
  const result = {
    reachable: false,
    status: 'down',
    health: null,
    metrics: null,
    error: null
  };

  // Try rich status endpoint first
  const statusRaw = curlFetch(`${NABAVKIDATA_URL}/api/clawd/status`);
  const statusData = tryParseJson(statusRaw);

  if (statusData) {
    result.reachable = true;
    result.health = statusData.health || null;
    result.metrics = statusData.metrics || null;

    if (statusData.status === 'ok' || statusData.status === 'healthy') {
      result.status = 'up';
    } else {
      result.status = 'degraded';
    }
    return result;
  }

  // Fallback: basic /health endpoint
  const healthRaw = curlFetch(`${NABAVKIDATA_URL}/health`);
  const healthData = tryParseJson(healthRaw);

  if (healthData) {
    result.reachable = true;
    result.health = healthData.health || healthData;
    if (healthData.status === 'ok' || healthData.status === 'healthy' || healthData.status === 'up') {
      result.status = 'up';
    } else {
      result.status = 'degraded';
    }
    return result;
  }

  // Last resort: just check if the URL responds at all
  const anyResponse = curlFetch(`${NABAVKIDATA_URL}/`, 5);
  if (anyResponse !== null) {
    result.reachable = true;
    result.status = 'up';
    return result;
  }

  result.status = 'down';
  result.error = `Cannot reach ${NABAVKIDATA_URL}`;
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = Date.now();
  const state = readState();
  const check = checkHealth();
  const previousStatus = state.status;
  const currentStatus = check.status === 'up' ? 'up' : 'down'; // treat degraded as down for alerting

  let alertMessage = null;

  // State transition: UP -> DOWN
  if (previousStatus !== 'down' && currentStatus === 'down') {
    const reason = check.error || (check.status === 'degraded' ? 'service is DEGRADED' : 'unreachable');
    alertMessage = [
      'NABAVKIDATA DOWN',
      `api.nabavkidata.com is ${reason} as of ${timeCET()} CET.`,
      check.health ? `Health: ${JSON.stringify(check.health)}` : '',
      'Will check again in 5 minutes.'
    ].filter(Boolean).join('\n');

    state.status = 'down';
    state.since = nowISO();
    state.last_alert_at = nowISO();
    state.consecutive_failures = 1;
  }
  // State: DOWN -> still DOWN (reminder every 30 min)
  else if (previousStatus === 'down' && currentStatus === 'down') {
    state.consecutive_failures = (state.consecutive_failures || 0) + 1;
    const lastAlert = state.last_alert_at ? new Date(state.last_alert_at).getTime() : 0;
    if (now - lastAlert >= REMINDER_INTERVAL) {
      const downSince = state.since ? new Date(state.since).getTime() : now;
      const duration = formatDuration(now - downSince);
      alertMessage = [
        `NABAVKIDATA STILL DOWN (${duration})`,
        `api.nabavkidata.com has been unreachable since ${new Date(state.since).toLocaleTimeString('en-GB', { timeZone: 'Europe/Belgrade', hour: '2-digit', minute: '2-digit' })} CET.`,
        `Total downtime: ${duration}. Consecutive check failures: ${state.consecutive_failures}.`
      ].join('\n');
      state.last_alert_at = nowISO();
    }
  }
  // State transition: DOWN -> UP (recovery)
  else if (previousStatus === 'down' && currentStatus === 'up') {
    const downSince = state.since ? new Date(state.since).getTime() : now;
    const duration = formatDuration(now - downSince);
    const healthSummary = check.health
      ? Object.entries(check.health).map(([k, v]) => `${k}: ${v ? 'ok' : 'FAIL'}`).join(', ')
      : 'basic check only';

    alertMessage = [
      'NABAVKIDATA RECOVERED',
      `api.nabavkidata.com is back online at ${timeCET()} CET.`,
      `Was down for ${duration}.`,
      `Health: ${healthSummary}`
    ].join('\n');

    state.status = 'up';
    state.since = nowISO();
    state.last_alert_at = nowISO();
    state.consecutive_failures = 0;
  }
  // State: UP -> still UP
  else if (currentStatus === 'up') {
    state.status = 'up';
    state.consecutive_failures = 0;

    // Check for degraded metrics even when up
    if (check.metrics) {
      const m = check.metrics;
      const alerts = [];

      if (m.scraper_status === 'failed') {
        const key = 'scraper_failed';
        const lastAlert = state.degraded_alerts?.[key] ? new Date(state.degraded_alerts[key]).getTime() : 0;
        if (now - lastAlert >= DEGRADED_COOLDOWN) {
          alerts.push(`Scraper status: FAILED (last run: ${m.scraper_last_run || 'unknown'})`);
          state.degraded_alerts = state.degraded_alerts || {};
          state.degraded_alerts[key] = nowISO();
        }
      }

      if (m.error_rate_1h > 0.05) {
        const key = 'high_error_rate';
        const lastAlert = state.degraded_alerts?.[key] ? new Date(state.degraded_alerts[key]).getTime() : 0;
        if (now - lastAlert >= DEGRADED_COOLDOWN) {
          alerts.push(`Error rate: ${(m.error_rate_1h * 100).toFixed(1)}% in last hour`);
          state.degraded_alerts = state.degraded_alerts || {};
          state.degraded_alerts[key] = nowISO();
        }
      }

      if (m.failed_jobs_24h > 0) {
        const key = 'failed_jobs';
        const lastAlert = state.degraded_alerts?.[key] ? new Date(state.degraded_alerts[key]).getTime() : 0;
        if (now - lastAlert >= DEGRADED_COOLDOWN) {
          alerts.push(`${m.failed_jobs_24h} failed job(s) in last 24h`);
          state.degraded_alerts = state.degraded_alerts || {};
          state.degraded_alerts[key] = nowISO();
        }
      }

      if (alerts.length > 0) {
        alertMessage = [
          'NABAVKIDATA ALERT',
          `api.nabavkidata.com is reachable but has issues:`,
          ...alerts.map(a => `- ${a}`),
          `Detected at ${timeCET()} CET`
        ].join('\n');
        state.last_alert_at = nowISO();
      }
    }
  }

  // Update state
  if (state.status === 'unknown') {
    state.status = currentStatus;
    state.since = nowISO();
  }
  state.last_check_at = nowISO();
  state.health_details = check.health;

  // Send alert if needed
  if (alertMessage) {
    console.log(`[nabavkidata-monitor] Sending alert:\n${alertMessage}`);
    await sendAlertMessage(alertMessage);
  } else {
    console.log(`[nabavkidata-monitor] ${currentStatus} (no alert needed)`);
  }

  // Write state and log
  writeState(state);
  appendLog({
    timestamp: nowISO(),
    status: currentStatus,
    previous_status: previousStatus,
    reachable: check.reachable,
    health: check.health,
    metrics: check.metrics,
    alerted: !!alertMessage,
    consecutive_failures: state.consecutive_failures
  });
}

main().catch(err => {
  console.error('[nabavkidata-monitor] Fatal error:', err);
  process.exit(1);
});
