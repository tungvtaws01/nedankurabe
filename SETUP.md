# Environment Setup

All environment variables are managed in **Vercel Dashboard → Project → Settings → Environment Variables**.

## Required Variables

| Variable | Development | Preview | Production |
|---|---|---|---|
| `STAGE` | `local` | `acp` | `prod` |
| `AMAZON_ACCESS_KEY` | — | ✓ | ✓ |
| `AMAZON_SECRET_KEY` | — | ✓ | ✓ |
| `AMAZON_PARTNER_TAG` | — | ✓ | ✓ |
| `RAKUTEN_APP_ID` | — | ✓ | ✓ |
| `RAKUTEN_AFFILIATE_ID` | — | ✓ | ✓ |
| `ANTHROPIC_API_KEY` | — | ✓ | ✓ |
| `KV_REST_API_URL` | — | ✓ (auto) | ✓ (auto) |
| `KV_REST_API_TOKEN` | — | ✓ (auto) | ✓ (auto) |

**`KV_REST_API_URL` and `KV_REST_API_TOKEN`** are set automatically when you add a Vercel KV store (Storage tab).

## Local Development

```bash
# 1. Link project to Vercel
vercel link

# 2. Pull environment variables from Vercel Dashboard (Development scope)
vercel env pull .env.local   # creates .env.local — gitignored

# 3. Start dev server
vercel dev   # or: npm run dev
```

With `STAGE=local` (Development scope in Vercel), API calls return mock data so no real API keys are needed locally.

## Stages

| `STAGE` | Behaviour |
|---|---|
| `local` | Mock data — no API calls, instant response |
| `acp` | Real APIs — acceptance/staging environment |
| `prod` | Real APIs — production environment |
