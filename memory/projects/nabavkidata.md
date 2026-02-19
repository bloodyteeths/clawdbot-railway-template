# Nabavkidata — Public Procurement Data SaaS

## Company
- **URL:** https://nabavkidata.com
- **API:** https://api.nabavkidata.com
- **Infrastructure:** AWS EC2 (18.197.185.30), FastAPI + PostgreSQL
- **Target:** Macedonian businesses monitoring public procurement tenders

## Product
- AI-powered public procurement data platform for Macedonia
- Scrapes and indexes government tender data (javni nabavki)
- Users can search, filter, and get alerts on tenders matching their CPV codes
- Corruption detection and anomaly flagging

## Clawd Operational Capabilities

For detailed commands, read skill: `skills/nabavkidata/SKILL.md`

| Capability | How |
|-----------|-----|
| Health check | `node /app/scripts/saas-monitor.cjs --app nabavkidata` |
| New user signups | saas-monitor reports new_users_24h |
| Scraper health | saas-monitor checks scraper status (ok/stale/failed) |
| Error rates | saas-monitor reports error_rate_1h |
| System health | DB, API, scraper checks |
| Revenue tracking | `node /app/scripts/financial-tracker.cjs` |

## Deployment
- **NOT git-deployed** — manual SCP/SSH to EC2
- Server: `ubuntu@18.197.185.30`
- Process: raw uvicorn (no systemd/docker)
- Key: `~/.ssh/nabavki-key.pem`
