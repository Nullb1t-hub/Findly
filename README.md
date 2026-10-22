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

## Deployment checklist

1. Import `Nullb1t-hub/Findly` into Vercel when ready to deploy.
2. Add environment variables in Vercel Project Settings:
   - `TELEGRAM_BOT_TOKEN`: token from BotFather (server-only; never use a `NEXT_PUBLIC_` prefix).
   - `GEMINI_API_KEY`: key for Gemini API image understanding and Google Search grounding.
   - `DATABASE_URL`: connection string for a PostgreSQL-compatible provider if you want collection sync across devices and shared collections.
   - `DATABASE_SSL=true` when required by the provider.
3. Redeploy after setting variables. The database tables are created on first authenticated API use.
4. Set the Telegram bot's Mini App URL to the deployed HTTPS URL in BotFather.
5. Open the app from Telegram and verify scanning, saving, re-opening cards, and sharing an invite.

## Storage and service notes

- Without `DATABASE_URL`, saved items remain in that browser's local storage. They do not sync between devices and shared collections are unavailable.
- Without `GEMINI_API_KEY`, the app shell and local collection remain usable, but AI research cannot run.
- API keys belong only in Vercel environment variables or local `.env.local`; never commit them.
- Google Search grounding and third-party marketplace coverage depend on provider quotas and the public data available for each site. Prices are estimates, not guaranteed sale proceeds.
