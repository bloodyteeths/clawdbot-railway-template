#!/usr/bin/env node
/**
 * EC2 Cron Watchdog (Dead Man's Switch)
 *
 * Runs every 15 minutes via moltbot cron. Reads the EC2 heartbeat file
 * written by the webhook handler and alerts if expected crons are missing.
 *
 * Usage:
 *   node /app/scripts/ec2-cron-watchdog.cjs
 *
 * Environment:
 *   SAAS_MONITOR_TOKEN - shared secret for alert endpoint
 *
 * Expected crons are auto-discovered from the heartbeat file.
 * A cron is considered stale if it hasn't reported in longer than its
 * configured max_stale_hours (default 26h for daily crons).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const LOG_DIR = '/data/workspace/logs';
const HEARTBEAT_FILE = path.join(LOG_DIR, 'ec2-heartbeats.json');
const STATE_FILE = path.join(LOG_DIR, 'ec2-watchdog-state.json');
const LOG_FILE = path.join(LOG_DIR, 'ec2-watchdog.jsonl');
const CONFIG_FILE = path.join(LOG_DIR, 'ec2-watchdog-config.json');

const TOKEN = process.env.SAAS_MONITOR_TOKEN || '';
const ALERT_URL = 'http://127.0.0.1:8080/internal/alert';

// Alert cooldown: don't re-alert for the same cron within 1 hour
const ALERT_COOLDOWN = 60 * 60 * 1000;

// Default staleness thresholds (hours). Override via ec2-watchdog-config.json.
const DEFAULT_MAX_STALE_HOURS = {
  // Add known crons here with their expected intervals.
  // These are defaults; actual crons auto-register when they first report in.
  // Daily crons: 26h (24h + 2h grace)
  // Hourly crons: 2h (1h + 1h grace)
  '_default_daily': 26,
  '_default_hourly': 2
};

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

function readJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  ensureLogDir();
  const tmpFile = STATE_FILE + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, STATE_FILE);
}

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
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = Date.now();
  const heartbeats = readJSON(HEARTBEAT_FILE);

  if (!heartbeats || Object.keys(heartbeats).length === 0) {
    console.log('[ec2-watchdog] No heartbeats recorded yet. Nothing to check.');
    appendLog({ timestamp: nowISO(), status: 'no_data', crons_checked: 0 });
    return;
  }

  // Load optional config for per-cron staleness thresholds
  const config = readJSON(CONFIG_FILE) || {};
  // config format: { "scraper-daily": { "max_stale_hours": 26 }, ... }

  // Load alert state (tracks last alert time per cron)
  const state = readJSON(STATE_FILE) || {};

  const alerts = [];
  const results = {};

  for (const [cronName, hb] of Object.entries(heartbeats)) {
    const lastSeen = new Date(hb.last_seen || hb.received_at).getTime();
    const ageSec = (now - lastSeen) / 1000;
    const ageHours = ageSec / 3600;

    // Determine max staleness for this cron
    const cronConfig = config[cronName] || {};
    const maxStaleHours = cronConfig.max_stale_hours || DEFAULT_MAX_STALE_HOURS[cronName] || 26;

    const isStale = ageHours > maxStaleHours;
    const isFailed = hb.status === 'failure';

    results[cronName] = {
      last_seen: hb.last_seen,
      age: formatDuration(now - lastSeen),
      status: hb.status,
      stale: isStale,
      failed: isFailed
    };

    if (isStale || isFailed) {
      // Check cooldown
      const lastAlertTime = state[cronName]?.last_alert_at
        ? new Date(state[cronName].last_alert_at).getTime()
        : 0;

      if (now - lastAlertTime >= ALERT_COOLDOWN) {
        if (isStale) {
          alerts.push(`${cronName}: STALE (last seen ${formatDuration(now - lastSeen)} ago, max ${maxStaleHours}h)`);
        }
        if (isFailed) {
          alerts.push(`${cronName}: FAILED — ${hb.detail || 'no details'}`);
        }

        state[cronName] = state[cronName] || {};
        state[cronName].last_alert_at = nowISO();
      }
    }
  }

  // Send combined alert if there are issues
  if (alerts.length > 0) {
    const message = [
      'EC2 CRON ALERT',
      `Watchdog detected issues at ${timeCET()} CET:`,
      '',
      ...alerts.map(a => `- ${a}`)
    ].join('\n');

    console.log(`[ec2-watchdog] Sending alert:\n${message}`);
    await sendAlertMessage(message);
  } else {
    console.log(`[ec2-watchdog] All ${Object.keys(heartbeats).length} cron(s) healthy.`);
  }

  // Save state and log
  writeState(state);
  appendLog({
    timestamp: nowISO(),
    crons_checked: Object.keys(heartbeats).length,
    alerts_sent: alerts.length,
    results
  });
}

main().catch(err => {
  console.error('[ec2-watchdog] Fatal error:', err);
  process.exit(1);
});
