#!/bin/bash
# Setup cron job for Clawd Idea Machine
# Runs daily at 9 AM CET (Skopje time)

# Morning insights to WhatsApp (Atilla)
moltbot cron add --name "Morning Insights" \
  --cron "0 9 * * *" \
  --tz "Europe/Skopje" \
  --session isolated \
  --message "Run the idea machine and share today's e-commerce insights with screenshots. node /app/scripts/idea-machine.cjs" \
  --deliver \
  --channel whatsapp \
  --to "+905335010211"

# Also send to Telegram
moltbot cron add --name "Morning Insights Telegram" \
  --cron "0 9 * * *" \
  --tz "Europe/Skopje" \
  --session isolated \
  --message "Run the idea machine and share today's e-commerce insights. node /app/scripts/idea-machine.cjs" \
  --deliver \
  --channel telegram

# Nabavkidata EC2 uptime monitor — every 5 minutes
# No --deliver: script sends alerts itself only when something is wrong
moltbot cron add --name "nabavkidata-monitor" \
  --cron "*/5 * * * *" \
  --tz "Europe/Skopje" \
  --session isolated \
  --message "node /app/scripts/nabavkidata-monitor.cjs"

# EC2 cron watchdog (dead man's switch) — every 15 minutes
moltbot cron add --name "ec2-cron-watchdog" \
  --cron "*/15 * * * *" \
  --tz "Europe/Skopje" \
  --session isolated \
  --message "node /app/scripts/ec2-cron-watchdog.cjs"

echo "Cron jobs configured!"
echo "Daily insights will be sent at 9 AM CET to WhatsApp and Telegram"
echo "Nabavkidata monitor runs every 5 minutes"
echo "EC2 cron watchdog runs every 15 minutes"

# List configured cron jobs
moltbot cron list
