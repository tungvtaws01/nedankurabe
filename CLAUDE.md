# ベビトク — CLAUDE.md

Baby-products price-comparison SaaS for Amazon JP + Rakuten Ichiba.  
Live site: https://nedankurabe.vercel.app | Associate ID: `nedankurabe-22`

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16, App Router, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Testing | Jest 29 (`npm test`) |
| DB | Neon Postgres (`pg`) — pooled by default, `USE_UNPOOLED=1` for migrations |
| Cache | Vercel KV (`@vercel/kv`) |
| Deploy | Vercel (`npx vercel --prod --yes --archive=tgz`) |
| LLM | Anthropic (`ANTHROPIC_API_KEY`) — used for keyword refinement + semantic matching |

---

## Local Development

```bash
vercel link                      # link to Vercel project once
vercel env pull .env.local       # pull dev env vars (gitignored)
npm run dev                      # or: vercel dev
npm test                         # run Jest suite (must stay green)
```

### STAGE behaviour

| `STAGE` | Behaviour |
|---|---|
| `local` | Mock data — no real API calls |
| `acp` | Real APIs — preview/acceptance |
| `prod` | Real APIs — production |

---

## Architecture

### Database (Neon Postgres)

Two tables:
- **`products`** — one row per JAN code: `jan`, `title`, `brand`, `category`, `image_url` (all Rakuten-sourced)
- **`listings`** — one row per platform listing: `platform` (`'amazon'`|`'rakuten'`), `platform_id` (ASIN for Amazon; `"shop:itemId"` for Rakuten), FK to `products`

Key repo functions in [src/lib/harvest/repo.ts](src/lib/harvest/repo.ts):
- `searchAmazonFromDb(keyword, limit)` — tokenized ILIKE-AND title search → `AmazonSibling[]`
- `findMatchByAsin(asin)` — ASIN → product row
- `findAmazonSiblingByRakuten(rakutenPlatformId)` — cross-platform sibling lookup

### Amazon — link-only model

PA-API retired 2026-05-15. Creators API requires ≥10 qualified sales/30 days (not yet met).  
**Amazon is served link-only** from the matching DB: Rakuten image + tagged ASIN link, no price.

- [src/lib/platforms/amazon-link.ts](src/lib/platforms/amazon-link.ts) — `buildAmazonAffiliateUrl(asin)`, `buildAmazonLinkResult({asin,title,imageUrl})`
- All Amazon links carry `?tag=nedankurabe-22`; if tag cannot be applied the link is suppressed (fail-closed)
- `ProductResult.priceUnavailable = true` marks link-only cards; they are excluded from winner/comparison logic

### Rakuten — live API

[src/lib/platforms/rakuten.ts](src/lib/platforms/rakuten.ts) — `lookupRakuten`, `searchRakutenKeyword`, `parseRakutenItem`

**Full header set is required** (Referer with trailing slash, Origin, Sec-Fetch-*, User-Agent) — bare Referer returns 403.

Shipping heuristic: `postageFlag === 0 || price >= 3980 → 0 yen, else 700 yen`  
Points formula: `floor(floor(price / taxRate) * pointRate / 100)`  
Tax rate: `1.08` for food genres (粉ミルク = `401171`), `1.1` otherwise

Genre fallback chain: `[specificGenre, "100533"]` — never falls back to `"0"` (all-genres), which leaks non-baby items.

### Search gating

[src/lib/search/baby-scope.ts](src/lib/search/baby-scope.ts) — `isBabyQuery(keyword): boolean`

All search and lookup routes gate on `isBabyQuery`. Non-baby queries return an empty result with a Japanese/English "baby-only" message. This is intentional and required for Amazon Associates compliance.

### Cache key prefixes

| Route | Prefix |
|---|---|
| `/api/search` | `kw6:` |
| `/api/lookup` | `lookup6:` |

Bump the number when the response shape changes.

---

## Key Source Files

| File | Purpose |
|---|---|
| [src/lib/types.ts](src/lib/types.ts) | `ProductResult`, `UserToggles`, `SearchResponse` — source of truth for shared types |
| [src/app/api/search/route.ts](src/app/api/search/route.ts) | Keyword search — Rakuten live + Amazon DB link-only |
| [src/app/api/lookup/route.ts](src/app/api/lookup/route.ts) | ASIN/URL lookup — DB match → link-only result |
| [src/components/ProductCard.tsx](src/components/ProductCard.tsx) | Renders both Rakuten and link-only Amazon cards |
| [src/app/results/page.tsx](src/app/results/page.tsx) | Comparison UI, winner logic, toggle state |
| [src/lib/matching/find-equivalent.ts](src/lib/matching/find-equivalent.ts) | JAN-keyed + LLM semantic matching |

---

## Harvest Pipeline

Scripts run with `USE_UNPOOLED=1` and require `.env.local`:

```bash
npm run harvest:migrate    # run DB migrations
npm run harvest:enumerate  # crawl Rakuten → populate products + listings
npm run harvest:amazon     # match Amazon ASINs → populate amazon listings
npm run harvest:report     # print match stats
```

Standalone scripts in [scripts/harvest/](scripts/harvest/) and [scripts/](scripts/).

---

## Amazon Associates Compliance

> **HARD RULE: Never implement a feature that violates the Amazon Associates Operating Agreement.**  
> When in doubt, don't ship it — ask first.

### What is and isn't allowed

| ✅ Allowed | ❌ Never do this |
|---|---|
| Text links to Amazon product pages with `tag=nedankurabe-22` | Display Amazon product images scraped from Amazon |
| Rakuten-sourced product images as a proxy | Show Amazon prices, reviews, or ratings on our pages |
| "View on Amazon" CTA buttons with the affiliate tag | Cache or store Amazon prices in our DB |
| Nominative use of the word "Amazon" (e.g. "compare on Amazon") | Use the Amazon logo or trademark badge without explicit permission |
| Showing Rakuten price only, linking out to Amazon for its price | Claim a price as Amazon's price when we fetched it ourselves |
| Disclosing the affiliate relationship clearly | Hide or obscure that Amazon links are affiliate links |
| Linking only to amazon.co.jp product pages (`/dp/ASIN`) | Deep-link to Amazon checkout or add-to-cart flows |

### Rules that apply to every PR

1. **Every Amazon link must include `?tag=nedankurabe-22`.**  
   `buildAmazonAffiliateUrl(asin)` in [src/lib/platforms/amazon-link.ts](src/lib/platforms/amazon-link.ts) handles this and returns `null` if the tag cannot be applied — callers must suppress the link, not show a bare URL.

2. **No Amazon data may be displayed on our pages.**  
   This means no Amazon prices, no Amazon images (even via `<img src="...images-amazon.com/...">`), no star ratings, no review counts fetched from Amazon.

3. **Disclosure must remain visible.**  
   The "Amazonアソシエイト・プログラムの参加者" disclosure on the results page and footer must not be removed or hidden.

4. **Baby-scope gating must stay.**  
   `isBabyQuery` blocks non-baby searches. Do not widen or remove this gate — a reviewer searching a non-baby term and getting results would be a grounds for rejection.

5. **Do not use PA-API or any scraping of Amazon pages.**  
   PA-API was retired 2026-05-15 and our account is not yet approved for Creators API. Any feature that fetches live Amazon data (prices, availability, images) is blocked until that changes.

### When Creators API becomes available

> **When Creators API is unlocked, Amazon prices CAN be displayed — but only if fetched live from the API.**  
> Scraping Amazon pages or caching stale prices remains forbidden even with API access.

Once the Associates account is approved and reaches ≥10 qualified sales/30 days, Creators API unlocks. At that point:

- Amazon prices **may** be fetched and displayed — from the Creators API response only, never from scraped HTML or a cached DB value
- Amazon images served via the API **may** be displayed — do not hotlink `images-amazon.com` URLs directly
- The `priceUnavailable` link-only model in [src/lib/platforms/amazon-link.ts](src/lib/platforms/amazon-link.ts) can be replaced with real prices

**Price display rules from the Operating Agreement (non-negotiable):**
1. **Caching is allowed and normal** — most price-comparison services cache for hours or even days. What matters is disclosure.
2. Always show when the price was last fetched (e.g. "Amazon価格: ¥1,980 ※2026-06-19 時点"). This protects users and satisfies the agreement.
3. Always link to Amazon so users can verify the current price — the CTA button already does this.
4. Refresh the cache regularly (aim for ≤24 h for products with active price changes; longer is fine for stable items).
5. If the API returns no price, show nothing — never display a scraped or manually entered fallback price.
6. Must include a disclaimer like "価格は表示時点のものです / Prices may have changed" near displayed prices.

**Before implementing:** re-read the full [Operating Agreement](https://affiliate.amazon.co.jp/help/operating/agreement) price-display section. It changes and violations can trigger another rejection.

---

- Associate account `nedankurabe-22` is under appeal (rejected → rebrand + compliance fixes applied 2026-06-18)

---

## Testing

```bash
npm test              # full suite (~245 tests, must be 0 failures before any merge)
npm test -- --watch   # watch mode
```

Key test files:
- [src/lib/crawlers/rakuten.test.ts](src/lib/crawlers/rakuten.test.ts) — crawlRakutenSearch (mocked API JSON), crawlRakutenProduct (mocked HTML)
- [src/lib/platforms/rakuten.test.ts](src/lib/platforms/rakuten.test.ts) — parseRakutenItem, isTrialOrSamplePack, getGenreId
- [src/lib/platforms/amazon-link.test.ts](src/lib/platforms/amazon-link.test.ts) — buildAmazonAffiliateUrl
- [src/lib/search/baby-scope.test.ts](src/lib/search/baby-scope.test.ts) — isBabyQuery

**Shipping is 490 yen nowhere in the codebase** — if you see a test asserting 490 it is stale; the correct value is 700.

---

## Conventions

- Price arithmetic: always `floor()`, never `round()` — matches Rakuten's displayed values
- `postageFlag === 0` means the *seller* offers free shipping; `price >= 3980` is our own free-shipping heuristic
- localStorage key for UI toggles: `bebitoku_toggles`
- Do not fall back to genre `"0"` in Rakuten genre chains — it leaks non-baby results
- Do not display Amazon prices or images — link-only is required until Creators API is unlocked
