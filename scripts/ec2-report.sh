#!/bin/bash
# EC2 Cron Reporter for Clawd Monitoring
#
# Deploy this file to /opt/clawd/ec2-report.sh on the EC2 instance.
# Source it in cron scripts to report success/failure to Clawd.
#
# Required env vars (set in /etc/environment or cron):
#   CLAWD_WEBHOOK_URL   - https://clawdbot-va-production.up.railway.app/webhooks/saas
#   CLAWD_MONITOR_TOKEN - same as SAAS_MONITOR_TOKEN on Railway
#
# Usage:
#   source /opt/clawd/ec2-report.sh
#
#   # After successful cron:
#   clawd_report_success "scraper-daily" "Scraped 150 new tenders"
#
#   # On failure:
#   clawd_report_failure "scraper-daily" "Connection refused to e-nabavki.gov.mk"

CLAWD_WEBHOOK_URL="${CLAWD_WEBHOOK_URL:-https://clawdbot-va-production.up.railway.app/webhooks/saas}"
CLAWD_MONITOR_TOKEN="${CLAWD_MONITOR_TOKEN:-}"

clawd_report_success() {
  local cron_name="$1"
  local detail="${2:-success}"
  curl -sf -X POST "$CLAWD_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Monitor-Token: $CLAWD_MONITOR_TOKEN" \
    -d "{\"type\":\"cron_heartbeat\",\"app\":\"nabavkidata\",\"cron_name\":\"$cron_name\",\"status\":\"success\",\"detail\":\"$detail\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    2>/dev/null || true
}

clawd_report_failure() {
  local cron_name="$1"
  local detail="${2:-unknown failure}"
  curl -sf -X POST "$CLAWD_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Monitor-Token: $CLAWD_MONITOR_TOKEN" \
    -d "{\"type\":\"cron_failed\",\"app\":\"nabavkidata\",\"cron_name\":\"$cron_name\",\"status\":\"failure\",\"detail\":\"$detail\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    2>/dev/null || true
}
