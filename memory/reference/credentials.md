# API Credentials & Service Access

All credentials used by operational scripts. Keep this file updated when credentials
rotate or new services are added.

## E-commerce Integrations

| Service | Credential | Location |
|---------|-----------|----------|
| KolayXport (Etsy/Trendyol proxy) | API key + URL | `KOLAYXPORT_API_KEY`, `KOLAYXPORT_API_URL` env vars |
| eRank (Etsy SEO) | selmahodja353@gmail.com / Selmahodja.01 | Hardcoded in `erank.cjs` |

## Communication

| Service | Credential | Location |
|---------|-----------|----------|
| Postmark (outbound email) | Token: b3c9ef5b-f123-498a-8c57-878f61683161 | `POSTMARK_TOKEN` env var |
| Postmark senders | atilla@facturino.mk, partners@facturino.mk | — |

## Research & AI

| Service | Credential | Location |
|---------|-----------|----------|
| Apollo (VC/lead research) | API key: M5Ker5RzIA9flD0s_IONEA | `APOLLO_API_KEY` env var |
| ElevenLabs (TTS) | API key: sk_adfea57... (Free tier: 10K chars/mo) | `ELEVENLABS_API_KEY` env var |
| Gemini (image gen) | API key | `GEMINI_API_KEY` env var |

## Infrastructure

| Service | Credential | Location |
|---------|-----------|----------|
| Railway API | Token: 8e71a839-155e-4ca6-a8b6-dfe60364f45b | `RAILWAY_API_TOKEN` env var |
| OpenClaw setup | Password: pZMcVLVMcmLomrCQ | `SETUP_PASSWORD` env var |
| Anthropic auth | OAuth (auto-refresh via token-refresh.cjs) | `/data/.clawdbot/agents/main/agent/auth-profiles.json` |

## Google Workspace

| Service | Credential | Location |
|---------|-----------|----------|
| Google OAuth (gog CLI) | Client secret + token | `GOG_CREDENTIALS_JSON`, `GOG_TOKEN_JSON` env vars |

## Notes
- **NEVER share credentials in chat messages.** Point users to env vars or config files.
- eRank credentials are Merisa's account — do not change without her approval.
- Anthropic OAuth auto-refreshes every 2h via `token-refresh.cjs` in server.js.
