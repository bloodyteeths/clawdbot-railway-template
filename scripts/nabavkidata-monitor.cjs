#!/usr/bin/env node
/**
 * Nabavkidata EC2 Full Monitor
 *
 * Polls api.nabavkidata.com/api/clawd/status every 5 minutes (via moltbot cron).
 * Implements all 14 monitoring rules from the spec:
 *
 * Polling checks (1-10):
 *  1. status == "degraded"
 *  2. system.memory.used_percent > 85 (warn)
 *  3. system.memory.available_mb < 300 (alert)
 *  4. system.disk.free_gb < 5 (alert)
 *  5. metrics.scraper_status == "stale" (alert)
 *  6. metrics.scraper_status == "timeout" (warn)
 *  7. metrics.error_rate_1h > 0.5 (alert)
 *  8. metrics.documents_processed_24h == 0 (warn)
 *  9. scrapy_processes with elapsed_s > 10800 (alert)
 * 10. watchdog_updated_at older than 15 min (alert)
 *
 * Webhook checks (11-14) are handled in server.js /webhooks/saas endpoint.
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

// Cooldowns (ms)
const COOLDOWN_30M = 30 * 60 * 1000;
const COOLDOWN_1H = 60 * 60 * 1000;
const COOLDOWN_4H = 4 * 60 * 60 * 1000;
const REMINDER_INTERVAL = 30 * 60 * 1000; // down reminders

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
      degraded_alerts: {},
      last_system_snapshot: null
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

// Check if a cooldown has elapsed for a given alert key
function cooldownElapsed(state, key, cooldownMs) {
  const now = Date.now();
  const lastAlert = state.degraded_alerts?.[key]
    ? new Date(state.degraded_alerts[key]).getTime()
    : 0;
  return now - lastAlert >= cooldownMs;
}

// Mark an alert key as just fired
function markAlerted(state, key) {
  state.degraded_alerts = state.degraded_alerts || {};
  state.degraded_alerts[key] = nowISO();
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
    system: null,
    recent_events: [],
    error: null
  };

  // Try rich status endpoint first
  const statusRaw = curlFetch(`${NABAVKIDATA_URL}/api/clawd/status`);
  const statusData = tryParseJson(statusRaw);

  if (statusData) {
    result.reachable = true;
    result.health = statusData.health || null;
    result.metrics = statusData.metrics || null;
    result.system = statusData.system || null;
    result.recent_events = statusData.recent_events || [];

    if (statusData.status === 'ok' || statusData.status === 'healthy') {
      result.status = 'up';
    } else if (statusData.status === 'degraded') {
      result.status = 'degraded';
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
// Evaluate all metric/system checks (rules 1-10)
// Returns array of { key, severity, message }
// ---------------------------------------------------------------------------

function evaluateChecks(check, state) {
  const issues = [];
  const now = Date.now();

  // Rule 1: status == "degraded" — health checks failing
  if (check.status === 'degraded' && check.health) {
    const failedSystems = Object.entries(check.health)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (failedSystems.length > 0 && cooldownElapsed(state, 'degraded_status', COOLDOWN_30M)) {
      issues.push({
        key: 'degraded_status',
        severity: 'alert',
        message: `Service DEGRADED — failing: ${failedSystems.join(', ')}`
      });
    }
  }

  // System checks (rules 2-4)
  const sys = check.system;
  if (sys) {
    const mem = sys.memory;
    if (mem) {
      // Rule 2: memory used > 85% (warn)
      if (mem.used_percent > 85 && mem.available_mb >= 300 && cooldownElapsed(state, 'memory_warn', COOLDOWN_30M)) {
        issues.push({
          key: 'memory_warn',
          severity: 'warn',
          message: `Memory high: ${mem.used_percent.toFixed(1)}% used (${mem.available_mb}MB available)`
        });
      }

      // Rule 3: memory available < 300MB (alert)
      if (mem.available_mb < 300 && cooldownElapsed(state, 'memory_critical', COOLDOWN_30M)) {
        issues.push({
          key: 'memory_critical',
          severity: 'alert',
          message: `Memory CRITICAL: ${mem.available_mb}MB available (${mem.used_percent.toFixed(1)}% used)`
        });
      }
    }

    const disk = sys.disk;
    if (disk) {
      // Rule 4: disk free < 5GB (alert)
      if (disk.free_gb < 5 && cooldownElapsed(state, 'disk_low', COOLDOWN_30M)) {
        issues.push({
          key: 'disk_low',
          severity: 'alert',
          message: `Disk LOW: ${disk.free_gb.toFixed(1)}GB free (${disk.used_percent.toFixed(1)}% used)`
        });
      }
    }

    // Rule 9: scrapy_processes with elapsed_s > 10800 (3 hours = stuck)
    if (Array.isArray(sys.scrapy_processes)) {
      for (const proc of sys.scrapy_processes) {
        if (proc.elapsed_s > 10800 && cooldownElapsed(state, `stuck_scraper_${proc.pid}`, COOLDOWN_1H)) {
          issues.push({
            key: `stuck_scraper_${proc.pid}`,
            severity: 'alert',
            message: `Stuck scraper: PID ${proc.pid} running ${formatDuration(proc.elapsed_s * 1000)} (${proc.cmd || 'unknown'})`
          });
        }
      }
    }

    // Rule 10: watchdog_updated_at older than 15 minutes
    if (sys.watchdog_updated_at) {
      const watchdogAge = now - new Date(sys.watchdog_updated_at).getTime();
      if (watchdogAge > 15 * 60 * 1000 && cooldownElapsed(state, 'watchdog_stale', COOLDOWN_30M)) {
        issues.push({
          key: 'watchdog_stale',
          severity: 'alert',
          message: `EC2 watchdog not running — last update ${formatDuration(watchdogAge)} ago`
        });
      }
    }
  }

  // Metrics checks (rules 5-8)
  const m = check.metrics;
  if (m) {
    // Rule 5: scraper_status == "stale" (no scraper in 26+ hours)
    if (m.scraper_status === 'stale' && cooldownElapsed(state, 'scraper_stale', COOLDOWN_1H)) {
      issues.push({
        key: 'scraper_stale',
        severity: 'alert',
        message: `Scraper STALE — no scraper has run in 26+ hours (last: ${m.scraper_last_run || 'unknown'})`
      });
    }

    // Rule 6: scraper_status == "timeout" (last scraper was killed)
    if (m.scraper_status === 'timeout' && cooldownElapsed(state, 'scraper_timeout', COOLDOWN_30M)) {
      issues.push({
        key: 'scraper_timeout',
        severity: 'warn',
        message: `Scraper TIMEOUT — last scraper was killed as stuck (${m.scraper_dataset || 'unknown'} dataset)`
      });
    }

    // Also check for failed scraper (existing check, kept for backward compat)
    if (m.scraper_last_status === 'failed' && cooldownElapsed(state, 'scraper_failed', COOLDOWN_30M)) {
      issues.push({
        key: 'scraper_failed',
        severity: 'alert',
        message: `Scraper FAILED — last run failed (${m.scraper_dataset || 'unknown'} dataset, ${m.scraper_last_run || 'unknown'})`
      });
    }

    // Rule 7: error_rate_1h > 0.5 (50% — critical)
    if (m.error_rate_1h > 0.5 && cooldownElapsed(state, 'error_rate_critical', COOLDOWN_30M)) {
      issues.push({
        key: 'error_rate_critical',
        severity: 'alert',
        message: `Error rate CRITICAL: ${(m.error_rate_1h * 100).toFixed(1)}% in last hour`
      });
    }
    // Also warn at > 5% (existing behavior)
    else if (m.error_rate_1h > 0.05 && cooldownElapsed(state, 'error_rate_warn', COOLDOWN_30M)) {
      issues.push({
        key: 'error_rate_warn',
        severity: 'warn',
        message: `Error rate elevated: ${(m.error_rate_1h * 100).toFixed(1)}% in last hour`
      });
    }

    // Rule 8: documents_processed_24h == 0 (pipeline stalled)
    if (m.documents_processed_24h === 0 && cooldownElapsed(state, 'doc_pipeline_stalled', COOLDOWN_4H)) {
      issues.push({
        key: 'doc_pipeline_stalled',
        severity: 'warn',
        message: `Document pipeline stalled — 0 documents processed in 24h`
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const now = Date.now();
  const state = readState();
  const check = checkHealth();
  const previousStatus = state.status;

  // For up/down state machine, treat 'degraded' as reachable (not down)
  const isDown = check.status === 'down';
  let alertMessage = null;

  // ---- State machine: UP/DEGRADED <-> DOWN ----

  // Transition: was UP/DEGRADED/UNKNOWN -> now DOWN
  if (previousStatus !== 'down' && isDown) {
    const reason = check.error || 'unreachable';
    alertMessage = [
      'NABAVKIDATA DOWN',
      `api.nabavkidata.com is ${reason} as of ${timeCET()} CET.`,
      'Will check again in 5 minutes.'
    ].join('\n');

    state.status = 'down';
    state.since = nowISO();
    state.last_alert_at = nowISO();
    state.consecutive_failures = 1;
  }
  // Still DOWN (reminder every 30 min)
  else if (previousStatus === 'down' && isDown) {
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
  // Recovery: DOWN -> UP or DEGRADED (reachable again)
  else if (previousStatus === 'down' && !isDown) {
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

    state.status = check.status; // 'up' or 'degraded'
    state.since = nowISO();
    state.last_alert_at = nowISO();
    state.consecutive_failures = 0;
  }
  // UP or DEGRADED (reachable) — run all metric/system checks
  else if (!isDown) {
    state.status = check.status;
    state.consecutive_failures = 0;

    const issues = evaluateChecks(check, state);

    if (issues.length > 0) {
      // Mark all issues as alerted
      for (const issue of issues) {
        markAlerted(state, issue.key);
      }

      const alerts = issues.filter(i => i.severity === 'alert');
      const warns = issues.filter(i => i.severity === 'warn');

      const lines = [];
      if (alerts.length > 0) {
        lines.push('NABAVKIDATA ALERT');
      } else {
        lines.push('NABAVKIDATA WARNING');
      }

      for (const issue of [...alerts, ...warns]) {
        const icon = issue.severity === 'alert' ? '!' : '~';
        lines.push(`${icon} ${issue.message}`);
      }

      // Add system summary if available
      if (check.system) {
        const sys = check.system;
        const summary = [];
        if (sys.memory) summary.push(`RAM: ${sys.memory.available_mb}MB free`);
        if (sys.disk) summary.push(`Disk: ${sys.disk.free_gb.toFixed(1)}GB free`);
        if (sys.load_avg) summary.push(`Load: ${sys.load_avg['1min'].toFixed(2)}`);
        if (summary.length) lines.push(`[${summary.join(' | ')}]`);
      }

      lines.push(`Detected at ${timeCET()} CET`);
      alertMessage = lines.join('\n');
      state.last_alert_at = nowISO();
    }
  }

  // Update state
  if (state.status === 'unknown') {
    state.status = check.status;
    state.since = nowISO();
  }
  state.last_check_at = nowISO();
  state.health_details = check.health;
  if (check.system) {
    state.last_system_snapshot = {
      memory: check.system.memory,
      disk: check.system.disk,
      load_avg: check.system.load_avg,
      scrapy_process_count: Array.isArray(check.system.scrapy_processes) ? check.system.scrapy_processes.length : 0,
      watchdog_updated_at: check.system.watchdog_updated_at,
      captured_at: nowISO()
    };
  }

  // Send alert if needed
  if (alertMessage) {
    console.log(`[nabavkidata-monitor] Sending alert:\n${alertMessage}`);
    await sendAlertMessage(alertMessage);
  } else {
    console.log(`[nabavkidata-monitor] ${check.status} (no alert needed)`);
  }

  // Write state and log
  writeState(state);
  appendLog({
    timestamp: nowISO(),
    status: check.status,
    previous_status: previousStatus,
    reachable: check.reachable,
    health: check.health,
    metrics: check.metrics,
    system: check.system ? {
      memory_available_mb: check.system.memory?.available_mb,
      memory_used_pct: check.system.memory?.used_percent,
      disk_free_gb: check.system.disk?.free_gb,
      load_1m: check.system.load_avg?.['1min'],
      scrapy_count: Array.isArray(check.system.scrapy_processes) ? check.system.scrapy_processes.length : 0,
      watchdog_updated_at: check.system.watchdog_updated_at
    } : null,
    alerted: !!alertMessage,
    consecutive_failures: state.consecutive_failures
  });
}

main().catch(err => {
  console.error('[nabavkidata-monitor] Fatal error:', err);
  process.exit(1);
});
