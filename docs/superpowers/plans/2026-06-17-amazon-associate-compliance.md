# Amazon Associate Compliance Rewire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make nedankurabe compliant with the Amazon Associates Operating Agreement by serving Amazon products from the matching DB as link-only — Rakuten image + product title + a tagged ASIN link, with **no Amazon-sourced images, no Amazon prices, and no serve-time Amazon scraping**.

**Architecture:** Introduce a `priceUnavailable` flag on `ProductResult`. Amazon results become link-only objects built from the matching DB (`products.image_url` is Rakuten-sourced; the Amazon side is just an ASIN → tagged link). All display-path Amazon scraping (`crawlAmazonSearch` / `crawlAmazonProduct`) is removed; Amazon equivalents come from DB sibling lookups. Sorting, the winner badge, and the price-difference explanation are gated so they only apply when both products have prices (which, during this gap, means they never apply cross-platform). The dead PA-API code is retired.

**Tech Stack:** Next.js 16 App Router (route handlers + SSE streams), React 19, TypeScript, Postgres (`pg`), Jest + ts-jest.

**Spec:** `docs/superpowers/specs/2026-06-17-amazon-associate-compliance-design.md`
**Working branch:** `feat/amazon-associate-compliance` (already created off `master`).

---

## File Structure

**New files:**
- `src/lib/platforms/amazon-link.ts` — the only emitter of Amazon affiliate URLs (`buildAmazonAffiliateUrl`) + the link-only result builder (`buildAmazonLinkResult`).
- `src/lib/platforms/amazon-link.test.ts` — unit tests for both.
- `src/components/AffiliateDisclosure.tsx` — visible affiliate disclosure shown near comparison results.
- `src/lib/matching/no-amazon-scrape.test.ts` — guard test asserting no display module imports the Amazon scraper.

**Modified files:**
- `src/lib/types.ts` — add `priceUnavailable?: boolean` to `ProductResult`.
- `src/lib/price/normalize.ts` — add `byEffectivePrice` comparator; make `recalcWithToggles` pass link-only items through and sort with it.
- `src/lib/price/explain.ts` — add `isComparablePair` helper.
- `src/lib/harvest/repo.ts` — add `findAmazonSiblingByRakuten` and `findMatchByAsin`.
- `src/lib/matching/find-equivalent.ts` — Amazon target becomes DB-only (no LLM, no crawl); retire the Amazon branch of `hydrateListing`.
- `src/app/api/search/route.ts`, `src/app/api/search/stream/route.ts` — drop Amazon crawl; Rakuten-only pick list.
- `src/app/api/lookup/route.ts`, `src/app/api/lookup/stream/route.ts` — drop Amazon crawl; build link-only Amazon from DB.
- `src/app/api/preview/route.ts` — drop Amazon crawl; preview Amazon from DB.
- `src/app/api/enrich-compare/route.ts` — gate the price-difference explanation.
- `src/app/api/find-amazon/route.ts` — gate the price-difference explanation.
- `src/components/ProductCard.tsx` — Amazon link-only variant (no price, no breakdown, CTA only when URL present).
- `src/components/KeywordResultsList.tsx` — hide price for link-only items.
- `src/app/results/page.tsx` — gate winner badge + `PriceExplanation`; fix the loading-skeleton check.
- `src/lib/mock-data.ts` — mark the mock Amazon entry `priceUnavailable` so local/STAGE renders match production.

**Retired:**
- `src/lib/platforms/amazon.ts` + `src/lib/platforms/amazon.test.ts` — dead PA-API (endpoint retired 2026-05-15).

---

## Phase 1 — Foundation: model, comparator, link builder, repo

### Task 1: Add `priceUnavailable` to the product model

**Files:**
- Modify: `src/lib/types.ts:3-20`

- [ ] **Step 1: Add the field**

In `src/lib/types.ts`, add the field to the `ProductResult` interface, immediately after `affiliateUrl`:

```ts
  affiliateUrl: string
  // True when this is a link-only listing whose price/points cannot be shown
  // compliantly (Amazon during the pre-Creators-API gap). Such results are
  // rendered without a price, excluded from the cheapest-of comparison, and
  // never marked the winner.
  priceUnavailable?: boolean
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The field is optional, so existing object literals stay valid.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add priceUnavailable flag for link-only listings"
```

---

### Task 2: Sort comparator + recalc pass-through for link-only items

**Files:**
- Modify: `src/lib/price/normalize.ts`
- Test: `src/lib/price/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/price/normalize.test.ts`:

```ts
import { byEffectivePrice, recalcWithToggles } from './normalize'
import { DEFAULT_TOGGLES, ProductResult } from '@/lib/types'

function priced(platform: 'amazon' | 'rakuten', effectivePrice: number, extra: Partial<ProductResult> = {}): ProductResult {
  return {
    platform, title: 't', imageUrl: '', shopName: '', salePrice: effectivePrice,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice,
    subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null,
    taxRate: 1.1, affiliateUrl: `u-${platform}-${effectivePrice}`, ...extra,
  }
}

describe('byEffectivePrice', () => {
  it('sorts priced items ascending and pushes link-only items last', () => {
    const linkOnly = priced('amazon', 0, { priceUnavailable: true, affiliateUrl: 'amz' })
    const cheap = priced('rakuten', 100)
    const dear = priced('rakuten', 200)
    const sorted = [linkOnly, dear, cheap].sort(byEffectivePrice)
    expect(sorted.map(r => r.affiliateUrl)).toEqual(['u-rakuten-100', 'u-rakuten-200', 'amz'])
  })
})

describe('recalcWithToggles link-only', () => {
  it('passes link-only items through unchanged and sorts them last', () => {
    const linkOnly = priced('amazon', 0, { priceUnavailable: true, affiliateUrl: 'amz', salePrice: 0 })
    const rakuten = priced('rakuten', 980)
    const out = recalcWithToggles([linkOnly, rakuten], DEFAULT_TOGGLES)
    expect(out[0].affiliateUrl).toBe('u-rakuten-980')
    expect(out[1].priceUnavailable).toBe(true)
    expect(out[1].effectivePrice).toBe(0) // not recomputed
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/price/normalize.test.ts -t "byEffectivePrice"`
Expected: FAIL — `byEffectivePrice is not a function`.

- [ ] **Step 3: Add the comparator and guard recalc**

In `src/lib/price/normalize.ts`, add this exported function (place it just above `recalcWithToggles`):

```ts
// Sort comparator: cheapest effectivePrice first; link-only items (no displayable
// price) always sort last so a real priced result is never out-ranked by a ¥0 placeholder.
export function byEffectivePrice(a: ProductResult, b: ProductResult): number {
  if (a.priceUnavailable && !b.priceUnavailable) return 1
  if (b.priceUnavailable && !a.priceUnavailable) return -1
  return a.effectivePrice - b.effectivePrice
}
```

Then change `recalcWithToggles` so it skips recompute for link-only items and uses the comparator. Replace its body:

```ts
export function recalcWithToggles(results: ProductResult[], toggles: UserToggles): ProductResult[] {
  return results
    .map(r => {
      if (r.priceUnavailable) return r // no compliant price to recompute
      const effectivePrice =
        r.platform === 'amazon'
          ? calcAmazonEffectivePrice(
              r.salePrice,
              r.couponDiscount,
              toggles.amazonSubscribeSave && r.subscribeAvailable,
              toggles.amazonPrimeBulk,
            )
          : calcRakutenEffectivePrice(
              r.salePrice,
              r.shippingCost,
              r.couponDiscount,
              r.pointRate,
              toggles.rakutenSPU,
              toggles.rakutenCard && r.rakutenCardEligible,
              r.subscribeAvailable ? toggles.rakutenTeiki : 'off',
              r.teikiRates,
              r.taxRate,
            )
      return { ...r, effectivePrice }
    })
    .sort(byEffectivePrice)
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest src/lib/price/normalize.test.ts`
Expected: PASS (existing tests + the two new blocks).

- [ ] **Step 5: Commit**

```bash
git add src/lib/price/normalize.ts src/lib/price/normalize.test.ts
git commit -m "feat(price): byEffectivePrice comparator + link-only recalc pass-through"
```

---

### Task 3: Amazon affiliate-URL builder + link-only result builder

**Files:**
- Create: `src/lib/platforms/amazon-link.ts`
- Test: `src/lib/platforms/amazon-link.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/platforms/amazon-link.test.ts`:

```ts
import { buildAmazonAffiliateUrl, buildAmazonLinkResult } from './amazon-link'

describe('buildAmazonAffiliateUrl', () => {
  const ORIG = process.env.AMAZON_PARTNER_TAG
  afterEach(() => { process.env.AMAZON_PARTNER_TAG = ORIG })

  it('returns a tagged /dp/ URL when the tag is set', () => {
    process.env.AMAZON_PARTNER_TAG = 'nedankurabe-22'
    expect(buildAmazonAffiliateUrl('B0C7GQGGXK'))
      .toBe('https://www.amazon.co.jp/dp/B0C7GQGGXK?tag=nedankurabe-22')
  })

  it('returns null when the tag is missing (never emit an untagged link)', () => {
    delete process.env.AMAZON_PARTNER_TAG
    expect(buildAmazonAffiliateUrl('B0C7GQGGXK')).toBeNull()
  })
})

describe('buildAmazonLinkResult', () => {
  const ORIG = process.env.AMAZON_PARTNER_TAG
  beforeEach(() => { process.env.AMAZON_PARTNER_TAG = 'nedankurabe-22' })
  afterEach(() => { process.env.AMAZON_PARTNER_TAG = ORIG })

  it('builds a link-only Amazon result with a tagged URL and no price', () => {
    const r = buildAmazonLinkResult({ asin: 'B0C7GQGGXK', title: 'メリーズ M 64枚', imageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg' })
    expect(r.platform).toBe('amazon')
    expect(r.priceUnavailable).toBe(true)
    expect(r.salePrice).toBe(0)
    expect(r.effectivePrice).toBe(0)
    expect(r.imageUrl).toBe('https://thumbnail.image.rakuten.co.jp/x.jpg')
    expect(r.affiliateUrl).toBe('https://www.amazon.co.jp/dp/B0C7GQGGXK?tag=nedankurabe-22')
  })

  it('emits an empty affiliateUrl when no tag is configured', () => {
    delete process.env.AMAZON_PARTNER_TAG
    const r = buildAmazonLinkResult({ asin: 'B0C7GQGGXK', title: 't', imageUrl: '' })
    expect(r.affiliateUrl).toBe('')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/platforms/amazon-link.test.ts`
Expected: FAIL — cannot find module `./amazon-link`.

- [ ] **Step 3: Implement the builder**

Create `src/lib/platforms/amazon-link.ts`:

```ts
import { ProductResult } from '@/lib/types'

// The ONLY place that emits an Amazon affiliate URL. Returns null when no partner
// tag is configured so callers can render no CTA — we must never emit an untagged
// link (that was one of the two Associate-rejection causes).
export function buildAmazonAffiliateUrl(asin: string): string | null {
  const tag = process.env.AMAZON_PARTNER_TAG
  if (!tag) {
    console.warn('[amazon] AMAZON_PARTNER_TAG is not set — Amazon CTA will be suppressed')
    return null
  }
  return `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`
}

// Build a link-only Amazon ProductResult from a matched DB record. The image is the
// product's Rakuten-sourced image (licensed for affiliate display); no Amazon image
// or price is used. Renders as a "view on Amazon" card with no price/breakdown.
export function buildAmazonLinkResult(input: { asin: string; title: string; imageUrl: string }): ProductResult {
  return {
    platform: 'amazon',
    title: input.title,
    imageUrl: input.imageUrl,
    shopName: 'Amazon.co.jp',
    salePrice: 0,
    shippingCost: 0,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned: 0,
    effectivePrice: 0,
    subscribeAvailable: false,
    rakutenCardEligible: false,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: buildAmazonAffiliateUrl(input.asin) ?? '',
    priceUnavailable: true,
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest src/lib/platforms/amazon-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/amazon-link.ts src/lib/platforms/amazon-link.test.ts
git commit -m "feat(amazon): tagged link builder + link-only result builder (fail closed)"
```

---

### Task 4: DB lookups for matched Amazon ↔ Rakuten pairs

**Files:**
- Modify: `src/lib/harvest/repo.ts`
- Test: `src/lib/harvest/repo.test.ts`

- [ ] **Step 1: Write the failing test**

The existing `src/lib/harvest/repo.test.ts` mocks `../db`'s `query`. Open it to confirm the mock pattern, then append:

```ts
import { findAmazonSiblingByRakuten, findMatchByAsin } from './repo'
import { query as _query } from '../db'
const query = _query as jest.Mock

describe('findAmazonSiblingByRakuten', () => {
  it('maps a row to the AmazonSibling shape', async () => {
    query.mockResolvedValueOnce([{ asin: 'B0ABC12345', title: 'メリーズ M', image_url: 'https://thumbnail.image.rakuten.co.jp/a.jpg' }])
    const r = await findAmazonSiblingByRakuten('shop:item1')
    expect(r).toEqual({ asin: 'B0ABC12345', productTitle: 'メリーズ M', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg' })
  })
  it('returns null when there is no match', async () => {
    query.mockResolvedValueOnce([])
    expect(await findAmazonSiblingByRakuten('shop:none')).toBeNull()
  })
})

describe('findMatchByAsin', () => {
  it('maps a row including the rakuten sibling code', async () => {
    query.mockResolvedValueOnce([{ title: 'メリーズ M', image_url: 'https://thumbnail.image.rakuten.co.jp/a.jpg', rakuten_code: 'shop:item1' }])
    const r = await findMatchByAsin('B0ABC12345')
    expect(r).toEqual({ productTitle: 'メリーズ M', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/a.jpg', rakutenItemCode: 'shop:item1' })
  })
  it('returns null when the ASIN is not in the table', async () => {
    query.mockResolvedValueOnce([])
    expect(await findMatchByAsin('B0NONE00000')).toBeNull()
  })
})
```

> If `repo.test.ts` does not already mock `../db`, add at the top of the file (before imports of `./repo`):
> ```ts
> jest.mock('../db', () => ({ query: jest.fn() }))
> ```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/harvest/repo.test.ts -t "findAmazonSiblingByRakuten"`
Expected: FAIL — `findAmazonSiblingByRakuten is not a function`.

- [ ] **Step 3: Implement the lookups**

Append to `src/lib/harvest/repo.ts`:

```ts
export interface AmazonSibling { asin: string; productTitle: string; productImageUrl: string }

// Given a Rakuten listing's platform_id ("shop:itemId"), return the matched Amazon
// ASIN plus the product's title and Rakuten-sourced image. DB-only; no scraping.
export async function findAmazonSiblingByRakuten(rakutenItemCode: string): Promise<AmazonSibling | null> {
  const rows = await query<{ asin: string; title: string; image_url: string }>(
    `SELECT la.platform_id AS asin, p.title, p.image_url
       FROM listings lr
       JOIN products p ON p.id = lr.product_id
       JOIN listings la ON la.product_id = p.id AND la.platform='amazon' AND la.is_active
      WHERE lr.platform='rakuten' AND lr.platform_id=$1 AND lr.is_active
      LIMIT 1`,
    [rakutenItemCode],
  )
  return rows[0]
    ? { asin: rows[0].asin, productTitle: rows[0].title, productImageUrl: rows[0].image_url }
    : null
}

export interface AmazonMatch { productTitle: string; productImageUrl: string; rakutenItemCode: string | null }

// Given an Amazon ASIN, return the product's title + Rakuten-sourced image and the
// matched Rakuten listing's platform_id (null if no Rakuten sibling). DB-only.
export async function findMatchByAsin(asin: string): Promise<AmazonMatch | null> {
  const rows = await query<{ title: string; image_url: string; rakuten_code: string | null }>(
    `SELECT p.title, p.image_url,
            (SELECT lr.platform_id FROM listings lr
              WHERE lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active
              LIMIT 1) AS rakuten_code
       FROM listings la
       JOIN products p ON p.id = la.product_id
      WHERE la.platform='amazon' AND la.platform_id=$1 AND la.is_active
      LIMIT 1`,
    [asin],
  )
  return rows[0]
    ? { productTitle: rows[0].title, productImageUrl: rows[0].image_url, rakutenItemCode: rows[0].rakuten_code }
    : null
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npx jest src/lib/harvest/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/harvest/repo.ts src/lib/harvest/repo.test.ts
git commit -m "feat(repo): DB lookups for matched Amazon<->Rakuten pairs"
```

---

## Phase 2 — Matching: Amazon target becomes DB-only

### Task 5: `findEquivalent` Amazon target = DB link-only (no LLM, no crawl)

**Files:**
- Modify: `src/lib/matching/find-equivalent.ts`
- Test: `src/lib/matching/find-equivalent.test.ts`

- [ ] **Step 1: Update the test mocks and add a DB-only Amazon test**

In `src/lib/matching/find-equivalent.test.ts`, extend the `@/lib/harvest/repo` mock so the new function is mockable. Find the existing `jest.mock('@/lib/harvest/repo', ...)` (or add one) and ensure it includes `findAmazonSiblingByRakuten`. Add this mock block near the other mocks:

```ts
jest.mock('@/lib/platforms/amazon-link', () => ({
  buildAmazonLinkResult: (i: { asin: string; title: string; imageUrl: string }) => ({
    platform: 'amazon', title: i.title, imageUrl: i.imageUrl, shopName: 'Amazon.co.jp',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: `https://www.amazon.co.jp/dp/${i.asin}?tag=t`, priceUnavailable: true,
  }),
}))
```

Then add a test (the existing repo mock must expose `findAmazonSiblingByRakuten`; declare it in that mock factory as `jest.fn()`):

```ts
import { findAmazonSiblingByRakuten } from '@/lib/harvest/repo'

it('returns a DB link-only Amazon result for a Rakuten source, without crawling', async () => {
  ;(findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue({
    asin: 'B0ABC12345', productTitle: 'メリーズ M 64枚', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg',
  })
  const source: ProductResult = {
    platform: 'rakuten', title: 'メリーズ M', imageUrl: '', shopName: '', salePrice: 1000,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
    subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1,
    affiliateUrl: 'https://item.rakuten.co.jp/shop/item1/',
  }
  const r = await findEquivalent(source, 'amazon')
  expect(r?.platform).toBe('amazon')
  expect(r?.priceUnavailable).toBe(true)
  expect(r?.affiliateUrl).toContain('B0ABC12345')
  expect(crawlAmazonSearch).not.toHaveBeenCalled()
})
```

> Adjust the `@/lib/harvest/repo` mock factory to include all functions `find-equivalent.ts` imports after the edit in Step 3: `findListingByPlatformId`, `findSiblingListings`, `upsertProduct`, `upsertListing`, `findAmazonSiblingByRakuten` — each `jest.fn()` (give `findListingByPlatformId`/`findSiblingListings` default resolved values matching existing tests).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/matching/find-equivalent.test.ts -t "DB link-only Amazon"`
Expected: FAIL — Amazon path still crawls / `crawlAmazonSearch` was called.

- [ ] **Step 3: Implement DB-only Amazon target**

In `src/lib/matching/find-equivalent.ts`:

(a) Update the repo import to add the new function:

```ts
import { findListingByPlatformId, findSiblingListings, upsertProduct, upsertListing, findAmazonSiblingByRakuten } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
```

(b) At the very top of `findEquivalent`, before the existing fast-path block, add a DB-only short-circuit for the Amazon target:

```ts
  // Amazon target is link-only and DB-sourced: no LLM, no scraping. We find the
  // matched ASIN for this Rakuten source and return a link-only result (Rakuten
  // image + tagged Amazon link). No DB match → no Amazon card.
  if (targetPlatform === 'amazon') {
    if (source.platform !== 'rakuten') return null
    const rktCode = sourcePlatformId(source)
    if (!rktCode) return null
    const sib = await findAmazonSiblingByRakuten(rktCode).catch(() => null)
    if (!sib) return null
    return buildAmazonLinkResult({ asin: sib.asin, title: sib.productTitle, imageUrl: sib.productImageUrl })
  }
```

(c) Retire the Amazon branch of `hydrateListing` (the only remaining Amazon-target caller is now gone). Replace `hydrateListing` with a Rakuten-only version:

```ts
// Re-fetch a Rakuten listing's full ProductResult by its platform id. (Amazon
// equivalents are built link-only from the DB above; this is Rakuten-only now.)
async function hydrateListing(platformId: string, platform: 'amazon' | 'rakuten'): Promise<ProductResult | null> {
  if (platform !== 'rakuten') return null
  return lookupRakuten(platformId)
}
```

(d) Remove the now-unused top-level import of `crawlAmazonSearch` **only if** nothing else in the file uses it. `searchTargeted` still calls `crawlAmazonSearch` for the `targetPlatform === 'amazon'` branch — but that branch is now unreachable because Amazon returns early in (b). Simplify `searchTargeted` to Rakuten-only and drop the import:

Replace the `searchTargeted` body's results line:

```ts
  const results = await crawlRakutenSearch(keyword).catch(() => [] as ProductResult[])
```

And delete the line `import { crawlAmazonSearch } from '@/lib/crawlers/amazon'`. Keep the lazy `import('@/lib/crawlers/amazon')` removed too (it was only in `hydrateListing`, now gone).

- [ ] **Step 4: Run the full find-equivalent test file**

Run: `npx jest src/lib/matching/find-equivalent.test.ts`
Expected: PASS. (The existing Rakuten-target tests still exercise the LLM flow; the new test covers Amazon DB-only.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `crawlAmazonSearch` is reported unused anywhere, remove its import.

- [ ] **Step 6: Commit**

```bash
git add src/lib/matching/find-equivalent.ts src/lib/matching/find-equivalent.test.ts
git commit -m "feat(match): Amazon target is DB-only link-only (no LLM/crawl)"
```

---

## Phase 3 — Serving routes: stop scraping Amazon

### Task 6: Keyword search — Rakuten-only pick list

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/app/api/search/stream/route.ts`

- [ ] **Step 1: Rewrite `search/route.ts` to drop the Amazon crawl**

Replace the whole `POST` crawl section. The full new file:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { query?: string }
    if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
    return NextResponse.json({
      mode: 'keyword-list',
      rakutenResults: MOCK_RESULTS.filter(r => r.platform === 'rakuten'),
      amazonResults: [],
      results: [],
      query: body.query.trim(),
      cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
  const query = body.query.trim()
  // kw4: prefix — busts kw3 entries that contained scraped Amazon results.
  const cacheKey = makeCacheKey(`kw4:${query}`)

  const cached = await getCached<{ rakutenResults: ProductResult[] }>(cacheKey).catch(() => null)
  if (cached && cached.rakutenResults.length > 0) {
    return NextResponse.json({
      mode: 'keyword-list', rakutenResults: cached.rakutenResults, amazonResults: [],
      results: [], query, cached: true,
    } satisfies SearchResponse)
  }

  // Rakuten only. Amazon is not searched/scraped; it appears only as the matched
  // link-only sibling once the user opens a comparison.
  const rakutenResults = await crawlRakutenSearch(query).catch(() => [] as ProductResult[])
  if (rakutenResults.length > 0) {
    await setCached(cacheKey, { rakutenResults }).catch(() => {})
  }

  return NextResponse.json({
    mode: 'keyword-list', rakutenResults, amazonResults: [], results: [], query, cached: false,
  } satisfies SearchResponse)
}
```

- [ ] **Step 2: Rewrite `search/stream/route.ts` to drop the Amazon crawl**

Full new file:

```ts
import { NextRequest } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: 'query required' }), { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw4:${query}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const cached = await getCached<{ rakutenResults: ProductResult[] }>(cacheKey).catch(() => null)
      if (cached && cached.rakutenResults.length > 0) {
        send({ type: 'rakuten', results: cached.rakutenResults, cached: true })
        send({ type: 'amazon', results: [], cached: true })
        send({ type: 'done' })
        controller.close()
        return
      }

      const rakutenResults = await crawlRakutenSearch(query).catch(() => [] as ProductResult[])
      send({ type: 'rakuten', results: rakutenResults })
      // No Amazon search. Emit an empty amazon event to keep the SSE shape the client expects.
      send({ type: 'amazon', results: [] })

      if (rakutenResults.length > 0) {
        await setCached(cacheKey, { rakutenResults }).catch(() => {})
      }

      send({ type: 'done' })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/search/route.ts src/app/api/search/stream/route.ts
git commit -m "feat(search): Rakuten-only pick list; remove Amazon scraping from search"
```

---

### Task 7: URL lookup (non-stream) — build link-only Amazon from DB

**Files:**
- Modify: `src/app/api/lookup/route.ts`

- [ ] **Step 1: Rewrite the lookup route**

Full new file:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { findMatchByAsin } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
import { byEffectivePrice } from '@/lib/price/normalize'
import { MOCK_RESULTS } from '@/lib/mock-data'

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const sizesWithWord = decoded.match(/[A-Z0-9]{1,3}サイズ/g) ?? []
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? [])
      .filter(w => w.length >= 2 && w !== 'サイズ')
    const parts = [...sizesWithWord, ...jpWords].slice(0, 4)
    return parts.join(' ').trim() || null
  } catch { return null }
}

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized }
    }
  } catch { /* invalid URL */ }
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { url?: string }
    if (!body.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [],
      results: MOCK_RESULTS, query: body.url.trim(), cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const url = body.url.trim()
  const resolvedUrl = await resolveAmazonShortLink(url)
  const parsed = parseProductUrl(resolvedUrl)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(`lookup6:${url}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached && cached.length > 0) {
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [], results: cached, query: url, cached: true,
    } satisfies SearchResponse)
  }

  let results: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    // DB-only: build a link-only Amazon card; if matched, add the priced Rakuten sibling.
    const match = await findMatchByAsin(parsed.id).catch(() => null)
    const title = match?.productTitle ?? extractTitleFromAmazonUrl(resolvedUrl) ?? ''
    if (!title && !match) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonCard = buildAmazonLinkResult({ asin: parsed.id, title, imageUrl: match?.productImageUrl ?? '' })
    const rakuten = match?.rakutenItemCode ? await lookupRakuten(match.rakutenItemCode).catch(() => null) : null
    results = [amazonCard, ...(rakuten ? [rakuten] : [])].sort(byEffectivePrice)
  } else {
    const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
    if (!rakutenProduct) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonMatch = await findEquivalent(rakutenProduct, 'amazon').catch(() => null)
    results = [rakutenProduct, ...(amazonMatch ? [amazonMatch] : [])].sort(byEffectivePrice)
  }

  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})

  // Price-difference explanation only when BOTH sides have a real price (never for a
  // link-only Amazon card). During the gap this is effectively cross-platform-off.
  let explanation: string | undefined
  if (results.length === 2 && isComparablePair(results[0], results[1])) {
    const { winner, loser } = pickWinnerLoser(results[0], results[1])
    explanation = (await explainPriceDifference(winner, loser).catch(() => null)) ?? undefined
  }
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [], results, query: url, cached: false, explanation,
  } satisfies SearchResponse)
}
```

- [ ] **Step 2: Typecheck (depends on Task 8's `isComparablePair`)**

`isComparablePair` is added in Task 8; if running this task first, add a temporary stub or do Task 8 Step 1-3 first. Run: `npx tsc --noEmit` after Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lookup/route.ts
git commit -m "feat(lookup): DB-backed link-only Amazon; no Amazon scraping"
```

---

### Task 8: `isComparablePair` helper + gate the two explanation routes

**Files:**
- Modify: `src/lib/price/explain.ts`
- Test: `src/lib/price/explain.test.ts`
- Modify: `src/app/api/find-amazon/route.ts`
- Modify: `src/app/api/enrich-compare/route.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/price/explain.test.ts`:

```ts
import { isComparablePair } from './explain'
import { ProductResult } from '@/lib/types'

const mk = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'rakuten', title: 't', imageUrl: '', shopName: '', salePrice: 100, shippingCost: 0,
  couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 100, subscribeAvailable: false,
  rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: 'u', ...over,
})

describe('isComparablePair', () => {
  it('is true when both have prices', () => {
    expect(isComparablePair(mk({}), mk({ platform: 'amazon' }))).toBe(true)
  })
  it('is false when either is link-only', () => {
    expect(isComparablePair(mk({}), mk({ platform: 'amazon', priceUnavailable: true }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/price/explain.test.ts -t "isComparablePair"`
Expected: FAIL — `isComparablePair is not a function`.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/price/explain.ts`:

```ts
// A pair can be compared (winner badge, price-difference explanation) only when
// BOTH products have a displayable price. Link-only listings (Amazon during the
// pre-Creators-API gap) are never comparable.
export function isComparablePair(a: ProductResult, b: ProductResult): boolean {
  return !a.priceUnavailable && !b.priceUnavailable
}
```

- [ ] **Step 4: Gate `find-amazon/route.ts`**

In `src/app/api/find-amazon/route.ts`, replace the explanation block:

```ts
  const result = await findEquivalent(body.source, 'rakuten', body.candidates ?? []).catch(() => null)
  let explanation: string | null = null
  if (result && isComparablePair(body.source, result)) {
    const { winner, loser } = pickWinnerLoser(body.source, result)
    explanation = await explainPriceDifference(winner, loser).catch(() => null)
  }
```

And add to its imports:

```ts
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
```

(remove the now-duplicate `pickWinnerLoser` import line if present).

- [ ] **Step 5: Gate `enrich-compare/route.ts`**

In `src/app/api/enrich-compare/route.ts`, update the import:

```ts
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
```

And replace the explanation block near the end:

```ts
        if (match && isComparablePair(enrichedSource, match)) {
          const { winner, loser } = pickWinnerLoser(enrichedSource, match)
          const explanation = await explainPriceDifference(winner, loser).catch(() => null)
          if (explanation) send({ type: 'explanation', text: explanation })
        }
```

Also change the two `.sort((a, b) => a.effectivePrice - b.effectivePrice)` calls in this file to `.sort(byEffectivePrice)` and add `import { byEffectivePrice } from '@/lib/price/normalize'`.

- [ ] **Step 6: Run tests + typecheck**

Run: `npx jest src/lib/price/explain.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/price/explain.ts src/lib/price/explain.test.ts src/app/api/find-amazon/route.ts src/app/api/enrich-compare/route.ts
git commit -m "feat(price): isComparablePair gate for winner/explanation; no compare for link-only"
```

---

### Task 9: URL lookup (stream) — link-only Amazon, no Amazon scraping

**Files:**
- Modify: `src/app/api/lookup/stream/route.ts`

- [ ] **Step 1: Rewrite the stream route**

Full new file:

```ts
import { NextRequest } from 'next/server'
import { crawlRakutenProductFast, crawlRakutenProductLive } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { findMatchByAsin } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
import { byEffectivePrice } from '@/lib/price/normalize'

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized }
    }
  } catch { /* invalid URL */ }
  return null
}

function extractItemUrl(affiliateUrl: string): string {
  try {
    const u = new URL(affiliateUrl)
    if (u.hostname.includes('afl.rakuten.co.jp')) {
      const pc = u.searchParams.get('pc')
      if (pc) return decodeURIComponent(pc)
    }
  } catch {}
  return affiliateUrl
}

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const sizesWithWord = decoded.match(/[A-Z0-9]{1,3}サイズ/g) ?? []
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? [])
      .filter(w => w.length >= 2 && w !== 'サイズ')
    const parts = [...sizesWithWord, ...jpWords].slice(0, 4)
    return parts.join(' ').trim() || null
  } catch { return null }
}

function applyLivePoints(
  base: ProductResult,
  live: { pointRate: number; pointsEarned: number; couponDiscount: number; shippingCost: number | null },
): ProductResult {
  const shipping = live.shippingCost !== null ? live.shippingCost : base.shippingCost
  return {
    ...base,
    pointRate: live.pointRate,
    pointsEarned: live.pointsEarned,
    couponDiscount: live.couponDiscount,
    shippingCost: shipping,
    effectivePrice: base.salePrice + shipping - live.couponDiscount - live.pointsEarned,
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400 })
  }
  const url = body.url.trim()
  const resolvedUrl = await resolveAmazonShortLink(url)
  const parsed = parseProductUrl(resolvedUrl)
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: 'Amazon または楽天の商品URLを入力してください。' }),
      { status: 400 },
    )
  }

  const cacheKey = makeCacheKey(`lookup6:${url}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          if (cached.length === 2 && isComparablePair(cached[0], cached[1])) {
            const { winner, loser } = pickWinnerLoser(cached[0], cached[1])
            const explanation = await explainPriceDifference(winner, loser).catch(() => null)
            if (explanation) send({ type: 'explanation', text: explanation })
          }
          send({ type: 'done' })
          controller.close()
          return
        }

        let finalResults: ProductResult[] = []

        if (parsed.platform === 'rakuten') {
          // ── Rakuten URL ──────────────────────────────────────────────────
          send({ type: 'status', message: '楽天の商品情報を取得中…' })
          const rakutenProduct = await crawlRakutenProductFast(parsed.id).catch(() => null)
          if (!rakutenProduct) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }
          send({ type: 'partial', results: [rakutenProduct] })

          let latestRakuten: ProductResult = rakutenProduct
          let basicResults: ProductResult[] = [rakutenProduct]

          await Promise.all([
            // Amazon equivalent — DB link-only, no scraping.
            (async () => {
              send({ type: 'status', message: 'Amazonの同等商品を確認中…' })
              const amazonMatch = await findEquivalent(rakutenProduct, 'amazon').catch(() => null)
              basicResults = [latestRakuten, ...(amazonMatch ? [amazonMatch] : [])].sort(byEffectivePrice)
              send({ type: 'basic', results: basicResults })
            })(),
            // Live points for the Rakuten side.
            (async () => {
              const live = await crawlRakutenProductLive(parsed.id, rakutenProduct.salePrice, rakutenProduct.taxRate).catch(() => null)
              if (live) {
                latestRakuten = applyLivePoints(rakutenProduct, live)
                send({ type: 'live-points', result: latestRakuten })
                basicResults = basicResults.map(r => r.platform === 'rakuten' ? latestRakuten : r)
              }
            })(),
          ])
          finalResults = basicResults

        } else {
          // ── Amazon URL ───────────────────────────────────────────────────
          // DB-only: build a link-only Amazon card immediately, then add the priced
          // Rakuten sibling (with live points) if the ASIN is matched.
          send({ type: 'status', message: '商品情報を確認中…' })
          const match = await findMatchByAsin(parsed.id).catch(() => null)
          const title = match?.productTitle ?? extractTitleFromAmazonUrl(resolvedUrl) ?? ''
          const amazonCard = buildAmazonLinkResult({ asin: parsed.id, title, imageUrl: match?.productImageUrl ?? '' })
          send({ type: 'partial', results: [amazonCard] })

          let results: ProductResult[] = [amazonCard]
          if (match?.rakutenItemCode) {
            send({ type: 'status', message: '楽天の同等商品を取得中…' })
            const rakuten = await lookupRakuten(match.rakutenItemCode).catch(() => null)
            if (rakuten) {
              results = [amazonCard, rakuten].sort(byEffectivePrice)
              send({ type: 'basic', results })
              // Live points for the Rakuten match.
              const itemUrl = extractItemUrl(rakuten.affiliateUrl)
              const live = await crawlRakutenProductLive(itemUrl, rakuten.salePrice, rakuten.taxRate).catch(() => null)
              if (live) {
                const updated = applyLivePoints(rakuten, live)
                send({ type: 'live-points', result: updated })
                results = results.map(r => r.platform === 'rakuten' ? updated : r)
              }
            } else {
              send({ type: 'basic', results })
            }
          } else {
            send({ type: 'basic', results })
          }
          finalResults = results
        }

        if (finalResults.length > 0) await setCached(cacheKey, finalResults).catch(() => {})
        if (finalResults.length === 2 && isComparablePair(finalResults[0], finalResults[1])) {
          const { winner, loser } = pickWinnerLoser(finalResults[0], finalResults[1])
          const explanation = await explainPriceDifference(winner, loser).catch(() => null)
          if (explanation) send({ type: 'explanation', text: explanation })
        }
        send({ type: 'done' })
        controller.close()
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'エラーが発生しました。' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lookup/stream/route.ts
git commit -m "feat(lookup-stream): DB-backed link-only Amazon; remove Amazon scraping"
```

---

### Task 10: Preview route — DB-backed Amazon, no scraping

**Files:**
- Modify: `src/app/api/preview/route.ts`

- [ ] **Step 1: Rewrite the Amazon branch**

Full new file:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProductFast } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findMatchByAsin } from '@/lib/harvest/repo'

function parseUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string; fullUrl: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1], fullUrl: normalized }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized, fullUrl: normalized }
    }
  } catch { /* invalid */ }
  return null
}

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? []).filter(w => w.length >= 2)
    return jpWords.slice(0, 4).join(' ').trim() || null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url?: string }
  if (!url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const resolved = await resolveAmazonShortLink(url.trim())
  const parsed = parseUrl(resolved)
  if (!parsed) return NextResponse.json({ error: 'invalid url' }, { status: 400 })

  if (parsed.platform === 'rakuten') {
    const product = await crawlRakutenProductFast(parsed.id).catch(() => null)
    if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({
      platform: 'rakuten', title: product.title, salePrice: product.salePrice,
      imageUrl: product.imageUrl, shopName: product.shopName,
    })
  }

  // Amazon — DB only, no scraping, no price. Title/image from the matched product
  // (Rakuten-sourced) or a best-effort title from the URL slug.
  const match = await findMatchByAsin(parsed.id).catch(() => null)
  return NextResponse.json({
    platform: 'amazon',
    title: match?.productTitle ?? extractTitleFromAmazonUrl(resolved) ?? '',
    salePrice: null,
    imageUrl: match?.productImageUrl ?? '',
    shopName: 'Amazon.co.jp',
    priceUnavailable: true,
  })
}
```

- [ ] **Step 2: Update the preview consumer (`SearchBox.tsx`)**

`src/components/SearchBox.tsx` defines a `Preview` interface with `salePrice: number` and renders `¥{preview.salePrice.toLocaleString()}` (line ~144), which would crash on the new `salePrice: null`. Make two edits:

(a) Widen the type (line 12-18):

```tsx
interface Preview {
  platform: 'amazon' | 'rakuten'
  title: string
  salePrice: number | null
  imageUrl: string
  shopName: string
  priceUnavailable?: boolean
}
```

(b) Guard the price render (the `<p className="text-sm font-black text-[var(--red)]">…` line ~144):

```tsx
                  {preview.priceUnavailable || preview.salePrice == null ? (
                    <p className="text-[10px] text-[var(--ink-soft)]">Amazonで価格を確認</p>
                  ) : (
                    <p className="text-sm font-black text-[var(--red)]">¥{preview.salePrice.toLocaleString()}</p>
                  )}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/api/preview/route.ts src/components/SearchBox.tsx
git commit -m "feat(preview): DB-backed Amazon preview, no scraping or price"
```

---

## Phase 4 — Frontend: link-only rendering

### Task 11: `ProductCard` link-only Amazon variant

**Files:**
- Modify: `src/components/ProductCard.tsx`

- [ ] **Step 1: Skip price rows for link-only in `buildRows`**

At the top of `buildRows`, return no rows for a link-only product:

```ts
function buildRows(r: ProductResult, t: UserToggles, pointsLoading: boolean): Row[] {
  if (r.priceUnavailable) return []
  const rows: Row[] = [{ labelJP: '定価', labelEN: 'List price', value: `¥${r.salePrice.toLocaleString()}` }]
```

- [ ] **Step 2: Render the link-only body**

In the main `return` of `ProductCard`, replace the price block + `PriceBreakdown` + the Rakuten campaign notice section with a branch. Specifically, replace the block that starts at `<div className="flex items-baseline gap-2 mb-3">` … through the `<PriceBreakdown … />` line with:

```tsx
      {result.priceUnavailable ? (
        <div className="bg-[var(--cream)] border border-[var(--border)] rounded-lg px-3 py-2 mb-3">
          <p className="text-[11px] text-[var(--ink-soft)] leading-relaxed">
            価格はAmazonでご確認ください
            <span className="italic ml-1">Check the current price on Amazon</span>
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-black text-[var(--red)]"
              style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
              ¥{result.effectivePrice.toLocaleString()}
            </span>
            <span className="text-[10px] text-[var(--ink-soft)]">
              実質価格 <span className="italic">Effective price</span>
              {!isAmazon && !pointsLoading && result.pointRate <= 1 && result.couponDiscount === 0 && (
                <span className="ml-1 text-amber-600 font-medium not-italic">(キャンペーン除く)</span>
              )}
            </span>
          </div>
          <PriceBreakdown rows={buildRows(result, toggles, !isAmazon && !!pointsLoading)} total={result.effectivePrice} />
        </>
      )}
```

> Keep the existing Rakuten-only campaign-notice and `pointsLoading` blocks below as-is — they are already guarded by `!isAmazon`, so they never render for the link-only Amazon card.

- [ ] **Step 3: Guard the CTA — render only when a tagged URL exists**

Replace the final `<a … >` CTA block with a conditional:

```tsx
      {result.affiliateUrl ? (
        <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored"
          className={`block w-full text-center py-3 rounded-xl text-xs font-bold ${isAmazon
            ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
            : 'bg-[var(--red)] text-white'}`}>
          {isAmazon ? 'Amazonで見る' : '楽天で購入する'} →
          <span className="italic ml-1 opacity-70 font-normal">
            {isAmazon ? 'View on Amazon' : 'Buy on Rakuten'}
          </span>
        </a>
      ) : (
        <p className="text-[10px] text-[var(--ink-soft)] text-center py-2">リンクは現在利用できません</p>
      )}
```

> Note `rel="…sponsored"` — affiliate links should carry `rel="sponsored"`.

- [ ] **Step 4: Build the app to verify the component compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProductCard.tsx
git commit -m "feat(ui): ProductCard link-only Amazon variant (no price, sponsored CTA)"
```

---

### Task 12: `KeywordResultsList` — hide price for link-only items

**Files:**
- Modify: `src/components/KeywordResultsList.tsx:51-56`

- [ ] **Step 1: Guard the price block**

Replace the right-hand price `<div>`:

```tsx
              <div className="text-right shrink-0">
                {r.priceUnavailable ? (
                  <p className="text-[10px] text-[var(--ink-soft)]">Amazonで<br />価格を確認</p>
                ) : (
                  <>
                    <p className="text-base font-black text-[var(--red)]">¥{r.salePrice.toLocaleString()}</p>
                    {r.shippingCost === 0 && (
                      <p className="text-[9px] text-green-600">送料無料</p>
                    )}
                  </>
                )}
              </div>
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/KeywordResultsList.tsx
git commit -m "feat(ui): hide price for link-only items in keyword list"
```

---

### Task 13: Results page — gate winner badge + explanation, fix skeleton check

**Files:**
- Modify: `src/app/results/page.tsx`

- [ ] **Step 1: Import the comparability helper**

Add to the imports at the top:

```ts
import { isComparablePair } from '@/lib/price/explain'
```

- [ ] **Step 2: Compute a `comparable` flag and use it for winner + explanation**

Replace the block computing `winnerUnchanged` / `showSentence` (lines ~326-331) with:

```ts
  const comparable = ranked.length === 2 && isComparablePair(ranked[0], ranked[1])
  // The bundled sentence reflects DEFAULT toggle settings. If a toggle changes the
  // winner or the gap, the sentence's numbers would be stale → fall back to bullets.
  const winnerUnchanged =
    ranked.length === 2 && defaultRanked.length === 2 &&
    ranked[0].affiliateUrl === defaultRanked[0].affiliateUrl
  const defaultGap = defaultRanked.length === 2 ? defaultRanked[1].effectivePrice - defaultRanked[0].effectivePrice : null
  const currentGap = ranked.length === 2 ? ranked[1].effectivePrice - ranked[0].effectivePrice : null
  const showSentence = comparable && !!explanation && winnerUnchanged && defaultGap === currentGap
```

- [ ] **Step 3: Gate `PriceExplanation` on `comparable`**

Replace `{ranked.length === 2 && (` (the `PriceExplanation` wrapper) with:

```tsx
          {comparable && (
            <PriceExplanation
              winner={ranked[0]}
              loser={ranked[1]}
              explanation={showSentence && explanation ? explanation : undefined}
            />
          )}
```

- [ ] **Step 4: Gate the winner badge and fix the loading-skeleton check**

Replace the `ranked.map(...)` ProductCard render with:

```tsx
          {ranked.map((r, i) => (
            <ProductCard
              key={`${r.platform}:${r.affiliateUrl || r.title}`}
              result={r}
              isWinner={comparable && i === 0}
              toggles={toggles}
              pointsLoading={livePointsLoading && r.platform === 'rakuten'}
              loading={r.salePrice === 0 && !r.priceUnavailable}
            />
          ))}
```

> The `loading` fix is critical: a link-only Amazon card has `salePrice === 0`, which without the `!r.priceUnavailable` guard would render the loading skeleton forever.

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/results/page.tsx
git commit -m "feat(ui): gate winner/explanation on comparability; fix link-only skeleton"
```

---

### Task 14: Affiliate disclosure component + placement

**Files:**
- Create: `src/components/AffiliateDisclosure.tsx`
- Modify: `src/app/results/page.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/AffiliateDisclosure.tsx`:

```tsx
// Affiliate disclosure shown near comparison results. Amazon's Operating Agreement
// requires a clear, proximate disclosure of the Associate relationship.
export default function AffiliateDisclosure() {
  return (
    <p className="text-[9px] text-[var(--ink-soft)] leading-relaxed bg-[var(--cream)] border border-[var(--border)] rounded-lg px-3 py-2 mb-3">
      当サイトはAmazonアソシエイト・プログラムおよび楽天アフィリエイトの参加者です。
      リンクから商品が購入されると当サイトが収益を得る場合があります。
      <span className="italic block mt-0.5">
        As an Amazon Associate and Rakuten Affiliate, we earn from qualifying purchases.
      </span>
    </p>
  )
}
```

- [ ] **Step 2: Render it above the comparison cards**

In `src/app/results/page.tsx`, import it:

```ts
import AffiliateDisclosure from '@/components/AffiliateDisclosure'
```

And place it immediately after the opening `<TogglePanel … />` inside the `mode === 'comparison'` block (before the `ranked.length === 1` notices):

```tsx
          <AffiliateDisclosure />
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/components/AffiliateDisclosure.tsx src/app/results/page.tsx
git commit -m "feat(ui): visible affiliate disclosure near comparison results"
```

---

## Phase 5 — Cleanup & guards

### Task 15: Update mock data so local/STAGE matches production

**Files:**
- Modify: `src/lib/mock-data.ts`

- [ ] **Step 1: Mark the mock Amazon entry link-only**

In `src/lib/mock-data.ts`, the first entry (`platform: 'amazon'`, lines 16-34) currently uses an `m.media-amazon.com` image and `?tag=mock-22`. Update it so local/STAGE renders match production — reuse the Rakuten entry's image, add `priceUnavailable: true`, and use the production tag. Replace the Amazon entry's `imageUrl` and `affiliateUrl` lines and append the flag:

```ts
    imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/rakuten24/cabinet/gu3/4987176206206.jpg',
```
```ts
    affiliateUrl: 'https://www.amazon.co.jp/dp/B0CCJ3KBN3?tag=nedankurabe-22',
    priceUnavailable: true,
```

> The mock comment block (lines 3-13) describes Amazon-vs-Rakuten winner math that no longer applies (Amazon has no price). Replace that comment with a one-line note: `// Mock pair: a priced Rakuten item + a link-only Amazon item (no price shown).`

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add src/lib/mock-data.ts
git commit -m "chore(mock): mark mock Amazon entries link-only"
```

---

### Task 16: Guard test — no display module imports the Amazon scraper

**Files:**
- Create: `src/lib/matching/no-amazon-scrape.test.ts`

- [ ] **Step 1: Write the guard test**

Create `src/lib/matching/no-amazon-scrape.test.ts`:

```ts
import { readFileSync } from 'fs'
import { join } from 'path'

// These display/serving modules must NOT scrape Amazon. The only legitimate Amazon
// crawler use is the harvest pipeline (scripts/harvest) and short-link resolution.
const DISPLAY_FILES = [
  'src/app/api/search/route.ts',
  'src/app/api/search/stream/route.ts',
  'src/app/api/lookup/route.ts',
  'src/app/api/lookup/stream/route.ts',
  'src/app/api/preview/route.ts',
  'src/lib/matching/find-equivalent.ts',
]

describe('no Amazon scraping in display paths', () => {
  for (const rel of DISPLAY_FILES) {
    it(`${rel} does not import crawlAmazonSearch/crawlAmazonProduct`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src).not.toMatch(/crawlAmazonSearch/)
      expect(src).not.toMatch(/crawlAmazonProduct/)
    })
  }
})
```

- [ ] **Step 2: Run it**

Run: `npx jest src/lib/matching/no-amazon-scrape.test.ts`
Expected: PASS (all six files are clean after Phase 2-3). If any fails, remove the offending import.

- [ ] **Step 3: Commit**

```bash
git add src/lib/matching/no-amazon-scrape.test.ts
git commit -m "test(guard): assert no Amazon scraping in display paths"
```

---

### Task 17: Retire the dead PA-API module

**Files:**
- Delete: `src/lib/platforms/amazon.ts`
- Delete: `src/lib/platforms/amazon.test.ts`

- [ ] **Step 1: Confirm nothing imports it**

Run: `grep -rn "platforms/amazon'" src | grep -v "platforms/amazon-link"`
Expected: no results (the link-only builder lives in `amazon-link.ts`; `searchAmazon`/`lookupAmazon`/`parseAmazonItem` are unused).

- [ ] **Step 2: Delete the dead files**

```bash
git rm src/lib/platforms/amazon.ts src/lib/platforms/amazon.test.ts
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git commit -m "chore: retire dead PA-API module (endpoint retired 2026-05-15)"
```

---

## Phase 6 — Verification

### Task 18: Full test + build + manual smoke

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS (all suites). Pay attention to `find-equivalent`, `normalize`, `explain`, `repo`, `amazon-link`, and the new guard test.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then in a browser:
- Paste a known matched Amazon URL (pick an ASIN present in the DB) → expect: an Amazon card with the Rakuten image, **no price**, a "Amazonで見る" button whose href contains `?tag=nedankurabe-22`, plus a priced Rakuten card. No 🏆 winner badge, no price-difference sentence.
- Paste an unmatched Amazon URL → expect: a single Amazon link-only card (title from slug), no Rakuten card, no infinite skeleton.
- Keyword search → expect: Rakuten-only results in the pick list; tapping one shows the comparison with a link-only Amazon card if matched.
- Confirm the affiliate disclosure renders above the comparison cards.
- View source / network: confirm **no** request to `amazon.co.jp/s` or product pages is made during a comparison (only short-link resolution on paste).

- [ ] **Step 4: Set the env var (operational, outside code)**

Confirm in Vercel prod: `AMAZON_PARTNER_TAG=nedankurabe-22`. Locally, ensure `.env.local` has it so links render tagged during the smoke test. If unset, the CTA correctly disappears — verify that fail-closed behavior too by temporarily unsetting it.

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix: verification fixups for Amazon compliance rewire"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** link-only serve (Tasks 5,7,9,10), no untagged links (Task 3 fail-closed + Task 11 CTA guard), no display-path scraping (Tasks 5-10 + guard Task 16), Rakuten image reuse (Task 3 builder + Task 4 DB), disclosure (Task 14), dead PA-API retired (Task 17). Winner/explanation gating (Tasks 8,13) is the ripple-effect work the spec implies by removing Amazon prices.
- **`isComparablePair`** is introduced in Task 8 but referenced by Tasks 7 and 9 — do Task 8 before 7 and 9 (or stub it). The phase ordering already lists 7→8→9; reorder to 8→7→9 if you prefer strict compile-at-each-step.
- **Cache prefixes** were bumped (`kw4:`, `lookup6:`) so stale entries containing scraped Amazon data are not served post-deploy. Do not skip this.
- **Rakuten itemCode** stored in `listings.platform_id` is `"shop:itemId"`; `lookupRakuten` accepts that form. If a smoke test returns no Rakuten card for a matched ASIN, log the code being passed.
