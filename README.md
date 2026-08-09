# AI Call Assistant

An AI call-forwarding assistant: Twilio answers your number, Google Gemini talks to the caller,
every turn is stored in MongoDB, and each finished call is analysed (summary, intent, sentiment,
urgency, action items, lead score). Everything — credentials, prompts, routing — is editable from
the dashboard.

```
frontend/   plain HTML + CSS + JS  ->  Vercel
backend/    4 files (Express)      ->  Render
MongoDB Atlas                      ->  data + settings
```

## Backend (Render)

| File | Purpose |
|---|---|
| `backend/server.js` | Express app: auth, settings, calls, analytics, templates, actions |
| `backend/db.js` | Mongo connection + models (Settings, Call, PromptTemplate) |
| `backend/ai.js` | Gemini: live replies, call analysis, "ask about my calls" |
| `backend/voice.js` | Twilio TwiML conversation loop, forwarding, voicemail, outbound calls/SMS |

1. New Web Service on Render, root directory `backend`.
2. Build command `npm install`, start command `npm start`.
3. Copy every variable from `backend/.env.example` into Render → Environment.
4. After the first deploy, set `PUBLIC_URL` to the service URL.

## Frontend (Vercel)

1. New Vercel project, root directory `frontend`, framework preset **Other** (no build step).
2. Edit `frontend/config.js` → `API_BASE_URL` = your Render URL. You can also override it from the
   login screen (stored in the browser).
3. Deploy. Sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Twilio

Phone number → Voice & Fax:

| Setting | Value |
|---|---|
| A call comes in | Webhook, **POST**, `https://<render-url>/api/voice/incoming` |
| Call status changes | `https://<render-url>/api/voice/status` (POST) |

The exact URLs are shown in the dashboard under **Setup & Webhooks**.

## Features

- AI phone conversation loop (Twilio speech recognition + Gemini + TTS)
- Three routing modes: AI answers, straight forward, AI then forward
- VIP list (instant forward) and blocklist (reject)
- Business hours with after-hours voicemail
- Optional call recording and SMS follow-up
- Full transcripts + AI analysis with re-analyse on demand
- Search, filter, star, tag, CSV export
- Analytics: 30-day volume, sentiment mix, top intents, avg duration, avg lead score
- "Ask AI about your calls" natural-language reporting
- Prompt template library (save/apply personas)
- Outbound AI calls and manual SMS from the dashboard
- All credentials editable in the UI, secrets masked on read

## Local development

```bash
cd backend && cp .env.example .env && npm install && npm run dev
cd frontend && npx serve .    # or any static server
```
