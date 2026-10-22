# Findly

Findly is a Telegram Mini App for identifying objects, researching resale prices, and managing personal or shared collections.

## Stack
- Next.js App Router + TypeScript
- Telegram Mini App SDK (Telegram WebApp init data verification on the server)
- Gemini API for image understanding and grounded web research
- PostgreSQL-compatible storage via `DATABASE_URL` (optional for local-only preview)
- Vercel deployment

## Environment variables
- `TELEGRAM_BOT_TOKEN` — required to verify Telegram Mini App users
- `GEMINI_API_KEY` — enables AI identification and market research
- `DATABASE_URL` — PostgreSQL connection string for cross-device persistent collections
- `DATABASE_SSL` — set to `true` when required by the database provider

The UI can be previewed without credentials; AI research and cloud persistence require configured services. Do not commit secrets.

## Local development
1. `npm install`
2. Copy `.env.example` to `.env.local` and configure the available services.
3. `npm run dev`

## Telegram
Set the bot's Mini App URL to the deployed HTTPS URL. Telegram identity is verified server-side from `initData`; the client-supplied user ID is never trusted.
