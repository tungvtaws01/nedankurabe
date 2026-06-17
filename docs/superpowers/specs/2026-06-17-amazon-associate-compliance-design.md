# Amazon Associate Compliance Rewire — Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Goal:** Make nedankurabe compliant with the Amazon Associates Operating Agreement so the rejected account (`nedankurabe-22`) can be re-applied/approved, by serving Amazon products from the matching DB as **link-only** (no Amazon-sourced images or prices).

## Problem

The Amazon JP Associates application for `nedankurabe-22` was rejected for two policy violations, both traced to live code:

1. **Unauthorized use of Amazon trademarks/images/prices.** The site scrapes and hotlinks Amazon product images and prices at request time (`crawlers/amazon.ts` → `crawlAmazonProduct` / `crawlAmazonSearch`, rendered by `components/ProductCard.tsx`). The Operating Agreement only permits displaying Amazon images/prices obtained via the official product API. Scraped content = violation.
2. **Affiliate links missing the tracking ID.** `buildAmazonUrl` (`crawlers/amazon.ts`) falls back to an **untagged** URL when `AMAZON_PARTNER_TAG` is unset, so Amazon could not attribute traffic.

### The catch-22 (updated reality)

- **PA-API retired 2026-05-15**, replaced by the **Creators API** (OAuth2). The existing `platforms/amazon.ts` AWS-signature code is dead regardless of approval.
- **Creators API eligibility now requires ≥10 qualified Amazon referral sales in the previous 30 days** (steeper than the old 3 sales / 180 days).
- Therefore, in the gap between re-approval and Creators-API eligibility, Amazon **prices/images cannot be displayed compliantly** — only a tagged "View on Amazon" link.

### Why the matching DB solves it

The matching DB (Neon Postgres, harvest pipeline) stores:
- `products.image_url` → **100% Rakuten-sourced** (`thumbnail.image.rakuten.co.jp`), licensed for affiliate display via Rakuten's terms.
- Amazon side → stored only as an **ASIN** in `listings.platform_id`. No Amazon image stored.

Status at design time: 10,975 products, 1,443 matched on **both** Amazon + Rakuten, 1,469 active Amazon listings.

Serving Amazon from the DB is therefore inherently compliant: Rakuten image + product title + a tagged ASIN link, no Amazon-sourced content, no scrape at serve time.

## Scope

**This spec (Approach A):** compliance rewire — DB-backed serving, Amazon as link-only, no display-path scraping, proper disclosure.

**Next phase (Approach B), documented not built:** a browsable, category-indexed catalog of the 1,443 matched pairs (`/c/<category>`) to give the site original indexable content that strengthens re-approval and drives the traffic needed for sales.

## Architecture

**Core principle:** separate "data for comparison" from "data for display"; never let Amazon-sourced content or untagged links reach the page.

- **Rakuten** stays the priced side: live price via Rakuten API → full effective-price breakdown (unchanged).
- **Amazon** is display-free: read only the ASIN from the DB (→ tagged link) and reuse the product's Rakuten image + title for the thumbnail. No Amazon image, no Amazon price, no serve-time scrape.

**Pasted-but-unmatched Amazon URL — chosen handling: DB-only.** A matched ASIN shows the Rakuten match + tagged link; an unmatched ASIN shows a "not in catalog yet" state with only the tagged Amazon link. No scraping anywhere in the serving path.

## Components

1. **`matchRepo.findMatchByAsin(asin)`** — returns `{ product, rakutenListing }` or `null`. Wraps `findListingByPlatformId` + `findSiblingListings`. Used by lookup/preview paths.
2. **`matchRepo.findAmazonSibling(rakutenItemId)`** — returns matched ASIN or `null`. Used by the search path.
3. **`buildAmazonAffiliateUrl(asin)`** — the **only** emitter of Amazon URLs. Reads `AMAZON_PARTNER_TAG`; returns `null` if unset (caller renders no CTA). Replaces `buildAmazonUrl` and the PA-API affiliate string; the untagged branch is deleted.
4. **`ProductCard` Amazon variant** — for `platform === 'amazon'`: render Rakuten-sourced image + title, **no price, no `PriceBreakdown`**, and a tagged CTA rendered only when `affiliateUrl` is non-null. Price/points rows in `buildRows` are skipped for Amazon.
5. **`AffiliateDisclosure`** — visible disclosure placed near the comparison results (not only the footer), plus a disclosure/privacy page.

## Data flow

**Paste an Amazon URL (primary use case):**
```
URL → resolve ASIN (resolveAmazonShortLink for amzn.to) → findMatchByAsin(asin)
  ├─ match → Rakuten card (live price + full breakdown) + Amazon card (Rakuten image, tagged link, no price)
  └─ no match → "まだ登録されていません" + tagged Amazon link only (no scrape)
```

**Keyword search:**
```
query → Rakuten API (live prices) → per result: findAmazonSibling(itemId)
  → Rakuten card (full breakdown) + (if matched) Amazon link-only card
```

**Affected serving paths:** `/api/search`, `/api/lookup`, `/api/preview`, their `/stream` variants, and `lib/matching/find-equivalent.ts`.

**Dead code to retire:** `platforms/amazon.ts` (PA-API, dead endpoint) and the display use of `crawlers/amazon.ts`. Keep `resolveAmazonShortLink` (ASIN resolution) and the harvest-time crawler (backend matching, not display).

## Error handling & edge cases

- **No tag configured** → `buildAmazonAffiliateUrl` returns `null` → no Amazon CTA renders. Fail closed; never emit an untagged link. Startup logs a loud warning.
- **Unmatched ASIN** → "not in catalog yet" state with only the tagged Amazon link. No scrape.
- **Rakuten API failure** → existing graceful behavior; Amazon link-only card can still render from DB.
- **Stale match (ASIN delisted)** → link still resolves to Amazon's page; acceptable. Reconciliation is a backend harvest concern.
- **Short links (`amzn.to`)** → resolve to ASIN first, then DB lookup.

## Testing

- Unit: `buildAmazonAffiliateUrl` returns a tagged URL with tag set and `null` without (regression guard for the untagged-link bug).
- Unit: `findMatchByAsin` / `findAmazonSibling` against a seeded test DB.
- Component: `ProductCard` Amazon variant renders no price, no breakdown; CTA only when `affiliateUrl` is non-null; image src host is `rakuten.co.jp`.
- Guard test: assert no display-path module imports `crawlAmazonSearch` / `crawlAmazonProduct` (prevents re-introducing scraping).

## Re-application operational checklist (outside code)

1. Deploy the compliant build first — reviewers must see the clean site.
2. Confirm `AMAZON_PARTNER_TAG=nedankurabe-22` in Vercel prod env.
3. Visible affiliate disclosure live on results + a disclosure/privacy page.
4. Submit re-application (or the 異議申し立て appeal via the contact form linked in the rejection email), noting the site no longer displays Amazon imagery/prices and all links are properly tagged.
5. Post-approval, links accrue toward the **10 sales / 30 days** Creators-API threshold; only then revisit showing Amazon prices.

## Open items to verify

- Rakuten affiliate/API image-usage terms (standard, one-time confirm) before relying on Rakuten images next to an Amazon CTA.
- Harvest-time Amazon scraping is a separate, lower-priority ToS question (not visible to reviewers).
