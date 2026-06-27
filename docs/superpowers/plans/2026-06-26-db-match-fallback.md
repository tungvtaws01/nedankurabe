# DB-Match Fallback for Cross-Platform Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pasted product URL's exact platform id is not in our DB, find the cross-platform equivalent by matching the resolved product against our own DB products with the existing matcher, behind a conservative precision gate.

**Architecture:** A new `matchAgainstDb` matcher retrieves DB products that have a listing on the target platform and share title tokens with the source, ranks them (`rankBySimilarity`), confirms with `semanticMatch`, and accepts only above a tuned similarity floor. It is wired into `findEquivalent` (Rakuten-paste → Amazon) and a new `resolveAmazonPaste` helper the lookup route calls (Amazon-paste → Rakuten). Confirmed matches are written back into `listings` as `matchSource='llm'`.

**Tech Stack:** TypeScript, Next.js 16 App Router, Jest 29, Neon Postgres (`pg`), Vercel KV.

## Global Constraints

- Amazon stays link-only: no Amazon scraping, price, or image. Amazon cards use `buildAmazonLinkResult` and carry `priceUnavailable: true`. (CLAUDE.md HARD RULE.)
- Candidates come from our own DB only. Never scrape the other platform to build a match.
- Every Amazon link must carry the partner tag via `buildAmazonAffiliateUrl`; suppress the link if no tag. (Already enforced inside `buildAmazonLinkResult`.)
- Precision target ≥ 95% for the fallback gate; precision is preferred over coverage.
- Write-back rows use `matchSource: 'llm'` so they stay separable from vision-verified rows.
- Price arithmetic always `floor()`, never `round()`. (Not exercised by new code, but keep if touched.)
- Full Jest suite must be 0 failures before any commit (`npm test`).
- All fallback steps are best-effort: any failure degrades to current behavior (source alone, no sibling card). The fallback must never throw into the user request path.

---

### Task 1: DB candidate retrieval + write-back (repo)

**Files:**
- Modify: `src/lib/harvest/repo.ts` (add two exports + one interface near the existing `searchAmazonFromDb`, end of file)
- Test: `src/lib/harvest/repo.test.ts` (append new `describe` blocks)

**Interfaces:**
- Consumes: existing `query` from `../db`, existing `upsertListing` (same file).
- Produces:
  - `interface ProductCandidate { productId: number; title: string; imageUrl: string; targetListingId: string }`
  - `findProductCandidatesByTokens(keyword: string, targetPlatform: 'amazon' | 'rakuten', limit?: number): Promise<ProductCandidate[]>`
  - `linkSlugToProduct(productId: number, platform: 'amazon' | 'rakuten', platformId: string, title: string, confidence: number): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/harvest/repo.test.ts` (the file already imports `* as db from '../db'` and uses `jest.spyOn(db, 'query')` — reuse that pattern):

```ts
import {
  findProductCandidatesByTokens,
  linkSlugToProduct,
} from './repo'

describe('findProductCandidatesByTokens', () => {
  let querySpy: jest.SpyInstance
  beforeEach(() => { querySpy = jest.spyOn(db, 'query') })
  afterEach(() => querySpy.mockRestore())

  it('tokenizes, ANDs ILIKE conditions, filters by target platform, maps rows', async () => {
    querySpy.mockResolvedValue([
      { product_id: 688, title: 'P&G パンパース M46', image_url: 'http://x/i.jpg', target_id: 'B0FTFXNGFS' },
    ])
    const out = await findProductCandidatesByTokens('パンパース M46', 'amazon')
    const [sql, params] = querySpy.mock.calls[0]
    expect(sql).toContain('p.title ILIKE $1')
    expect(sql).toContain('p.title ILIKE $2')
    expect(sql).toContain('lt.platform = $3')
    expect(sql).toContain("lt.platform = $3 AND lt.is_active")
    expect(params).toEqual(['%パンパース%', '%M46%', 'amazon', 10])
    expect(out).toEqual([
      { productId: 688, title: 'P&G パンパース M46', imageUrl: 'http://x/i.jpg', targetListingId: 'B0FTFXNGFS' },
    ])
  })

  it('returns [] and does not query for an empty keyword', async () => {
    expect(await findProductCandidatesByTokens('   ', 'amazon')).toEqual([])
    expect(querySpy).not.toHaveBeenCalled()
  })
})

describe('linkSlugToProduct', () => {
  it('upserts a listing row with matchSource=llm and packCount 1', async () => {
    const querySpy = jest.spyOn(db, 'query').mockResolvedValue([])
    await linkSlugToProduct(688, 'rakuten', 'jetprice:x392sh', 'P&G パンパース', 0.8)
    const [sql, params] = querySpy.mock.calls[0]
    expect(sql).toContain('INSERT INTO listings')
    expect(params).toEqual([688, 'rakuten', 'jetprice:x392sh', 'P&G パンパース', 1, 'llm', 0.8, null])
    querySpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/harvest/repo.test.ts`
Expected: FAIL — `findProductCandidatesByTokens is not a function` / `linkSlugToProduct is not a function`.

- [ ] **Step 3: Implement the two functions**

Append to `src/lib/harvest/repo.ts` (after `searchAmazonFromDb`):

```ts
export interface ProductCandidate {
  productId: number
  title: string
  imageUrl: string
  targetListingId: string // ASIN or "shop:itemId" on the target platform
}

// Candidates for cross-platform DB matching: products that already have an active
// listing on `targetPlatform` and whose title contains every query token (ILIKE-AND).
// Returns the target-platform listing id so the caller can build the result card.
// Generalizes searchAmazonFromDb to either platform.
export async function findProductCandidatesByTokens(
  keyword: string,
  targetPlatform: 'amazon' | 'rakuten',
  limit = 10,
): Promise<ProductCandidate[]> {
  const tokens = keyword.trim().split(/[\s　]+/).filter(Boolean).slice(0, 6)
  if (!tokens.length) return []
  const conds = tokens.map((_, i) => `p.title ILIKE $${i + 1}`).join(' AND ')
  const params = [...tokens.map((t) => `%${t}%`), targetPlatform, limit]
  const rows = await query<{ product_id: number; title: string; image_url: string; target_id: string }>(
    `SELECT p.id AS product_id, p.title, p.image_url, lt.platform_id AS target_id
       FROM products p
       JOIN listings lt ON lt.product_id = p.id AND lt.platform = $${tokens.length + 1} AND lt.is_active
      WHERE ${conds} AND p.image_url <> ''
      LIMIT $${tokens.length + 2}`,
    params,
  )
  return rows.map((r) => ({
    productId: r.product_id, title: r.title, imageUrl: r.image_url, targetListingId: r.target_id,
  }))
}

// Write-back: link a pasted slug/ASIN to an already-known product so the next paste
// of the same URL hits the instant exact-id path. matchSource='llm' keeps these
// rows separable from vision-verified matches. Idempotent via upsertListing's
// ON CONFLICT (platform, platform_id).
export async function linkSlugToProduct(
  productId: number,
  platform: 'amazon' | 'rakuten',
  platformId: string,
  title: string,
  confidence: number,
): Promise<void> {
  await upsertListing({
    productId, platform, platformId, title, packCount: 1, matchSource: 'llm', confidence,
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/harvest/repo.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/harvest/repo.ts src/lib/harvest/repo.test.ts
git commit -m "feat(repo): cross-platform DB candidate retrieval + slug write-back"
```

---

### Task 2: `matchAgainstDb` matcher + similarity gate

**Files:**
- Create: `src/lib/matching/db-fallback.ts`
- Test: `src/lib/matching/db-fallback.test.ts`

**Interfaces:**
- Consumes:
  - `findProductCandidatesByTokens(keyword, targetPlatform): Promise<ProductCandidate[]>` and `type ProductCandidate` from Task 1 (`@/lib/harvest/repo`)
  - `semanticMatch(source, candidates, opts?): Promise<number | null>` from `@/lib/llm/openrouter`
  - `rankBySimilarity(source, candidates): ProductResult[]` and `similarity(a, b): number` from `@/lib/matching/rank`
  - `type Category` from `@/lib/llm/category-prompts`
- Produces:
  - `const SIMILARITY_FLOOR: number`
  - `interface DbMatch { productId: number; targetListingId: string; productTitle: string; productImageUrl: string; similarity: number }`
  - `matchAgainstDb(source: ProductResult, target: 'amazon' | 'rakuten', category?: Category): Promise<DbMatch | null>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/matching/db-fallback.test.ts`:

```ts
jest.mock('@/lib/harvest/repo', () => ({ findProductCandidatesByTokens: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ semanticMatch: jest.fn() }))
// rank.ts is NOT mocked — we exercise the real similarity gate.

import { findProductCandidatesByTokens } from '@/lib/harvest/repo'
import { semanticMatch } from '@/lib/llm/openrouter'
import { matchAgainstDb } from './db-fallback'
import { ProductResult } from '@/lib/types'

const src = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => jest.clearAllMocks())

it('returns the match when confirmed AND above the similarity floor', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 688, title: 'パンパース はじめての肌いち テープ スーパージャンボM46枚', imageUrl: 'i', targetListingId: 'B0FTFXNGFS' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(0)
  const m = await matchAgainstDb(src('パンパース はじめての肌いち テープ スーパージャンボM46枚 おむつ'), 'amazon')
  expect(m).not.toBeNull()
  expect(m!.productId).toBe(688)
  expect(m!.targetListingId).toBe('B0FTFXNGFS')
  expect(m!.productImageUrl).toBe('i')
})

it('returns null when semanticMatch does not confirm', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: 'パンパース M46枚', imageUrl: 'i', targetListingId: 'A' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(null)
  expect(await matchAgainstDb(src('パンパース M46枚'), 'amazon')).toBeNull()
})

it('returns null when confirmed but below the similarity floor', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 2, title: '全く別の商品 哺乳瓶 240ml ガラス製', imageUrl: 'i', targetListingId: 'B' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(0)
  expect(await matchAgainstDb(src('パンパース おむつ テープ スーパージャンボM46枚'), 'amazon')).toBeNull()
})

it('returns null and does not call semanticMatch on an empty candidate pool', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('x'), 'amazon')).toBeNull()
  expect(semanticMatch).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/matching/db-fallback.test.ts`
Expected: FAIL — `Cannot find module './db-fallback'`.

- [ ] **Step 3: Implement `matchAgainstDb`**

Create `src/lib/matching/db-fallback.ts`:

```ts
import { ProductResult } from '@/lib/types'
import { type Category } from '@/lib/llm/category-prompts'
import { semanticMatch } from '@/lib/llm/openrouter'
import { rankBySimilarity, similarity } from '@/lib/matching/rank'
import { findProductCandidatesByTokens, type ProductCandidate } from '@/lib/harvest/repo'

// Minimum rankBySimilarity score for an LLM-confirmed candidate to be accepted.
// Provisional value; locked empirically by scripts/tuning/tune-db-fallback.ts to
// hit precision >= 95% (see Task 5). The numeric-token-weighted similarity for a
// true same-product pair is typically >= 0.15; loosely-related pairs score < 0.1.
export const SIMILARITY_FLOOR = 0.12

export interface DbMatch {
  productId: number
  targetListingId: string
  productTitle: string
  productImageUrl: string
  similarity: number
}

// Adapt a DB product candidate into the minimal ProductResult that
// rankBySimilarity / semanticMatch consume. No live price → effectivePrice 0, so
// semanticMatch's cheapest-tiebreak returns the highest-ranked confirmed match.
function toResult(c: ProductCandidate, platform: 'amazon' | 'rakuten'): ProductResult {
  return {
    platform, title: c.title, imageUrl: c.imageUrl, shopName: '',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

// Find the cross-platform equivalent of `source` among our own DB products that
// already have a listing on `target`. DB-only (no scraping). Returns a match only
// when semanticMatch confirms AND the rank similarity clears SIMILARITY_FLOOR.
// Best-effort: any failure returns null so the caller degrades to no sibling card.
export async function matchAgainstDb(
  source: ProductResult,
  target: 'amazon' | 'rakuten',
  category?: Category,
): Promise<DbMatch | null> {
  const candidates = await findProductCandidatesByTokens(source.title, target).catch(() => [] as ProductCandidate[])
  if (!candidates.length) return null

  // Keep a result→candidate map by object identity; rankBySimilarity preserves refs.
  const pairs = candidates.map((c) => ({ cand: c, result: toResult(c, target) }))
  const resultToCand = new Map(pairs.map((p) => [p.result, p.cand]))
  const ranked = rankBySimilarity(source, pairs.map((p) => p.result))

  const idx = await semanticMatch(source, ranked, { category }).catch(() => null)
  if (idx === null) return null
  const chosen = ranked[idx]
  if (!chosen) return null

  const score = similarity(source.title, chosen.title)
  if (score < SIMILARITY_FLOOR) return null

  const cand = resultToCand.get(chosen)
  if (!cand) return null
  return {
    productId: cand.productId, targetListingId: cand.targetListingId,
    productTitle: cand.title, productImageUrl: cand.imageUrl, similarity: score,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/matching/db-fallback.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/db-fallback.ts src/lib/matching/db-fallback.test.ts
git commit -m "feat(matching): matchAgainstDb DB fallback with conservative similarity gate"
```

---

### Task 3: Wire fallback into `findEquivalent` (Rakuten-paste → Amazon)

**Files:**
- Modify: `src/lib/matching/find-equivalent.ts:27-34` (the `targetPlatform === 'amazon'` block) and the imports at the top
- Test: `src/lib/matching/find-equivalent.test.ts` (extend the existing mock setup + add a test)

**Interfaces:**
- Consumes: `matchAgainstDb` + `DbMatch` from `@/lib/matching/db-fallback` (Task 2); `linkSlugToProduct` from `@/lib/harvest/repo` (Task 1); existing `classifyCategory`, `findAmazonSiblingByRakuten`, `buildAmazonLinkResult`, `sourcePlatformId`.
- Produces: no new exports; `findEquivalent` Amazon path now returns a DB-fallback match when exact-id misses.

- [ ] **Step 1: Write the failing test**

In `src/lib/matching/find-equivalent.test.ts`, extend the existing `jest.mock('@/lib/harvest/repo', ...)` factory to add `linkSlugToProduct: jest.fn()`, and add a new mock for db-fallback. Add near the other `jest.mock` calls:

```ts
jest.mock('@/lib/matching/db-fallback', () => ({ matchAgainstDb: jest.fn() }))
```

Update the existing repo mock factory to include the new function (keep all existing keys, add this line):

```ts
  linkSlugToProduct: jest.fn(),
```

Then add imports and a test (the file already imports `findEquivalent` and the `p(title,url)` helper):

```ts
import { matchAgainstDb } from '@/lib/matching/db-fallback'
import { linkSlugToProduct, findAmazonSiblingByRakuten as findSibMock } from '@/lib/harvest/repo'

describe('findEquivalent Amazon DB fallback', () => {
  it('falls back to matchAgainstDb when exact-id misses, then writes back', async () => {
    (findSibMock as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue({
      productId: 688, targetListingId: 'B0FTFXNGFS',
      productTitle: 'パンパース M46', productImageUrl: 'img', similarity: 0.4,
    })
    const rakutenSource = p('パンパース はじめての肌いち M46枚', 'https://item.rakuten.co.jp/jetprice/x392sh/')
    rakutenSource.platform = 'rakuten'
    const out = await findEquivalent(rakutenSource, 'amazon')
    expect(out).not.toBeNull()
    expect(out!.platform).toBe('amazon')
    expect(out!.affiliateUrl).toContain('B0FTFXNGFS')
    expect(linkSlugToProduct).toHaveBeenCalledWith(688, 'rakuten', 'jetprice:x392sh', expect.any(String), 0.8)
  })

  it('returns null when exact-id misses and matchAgainstDb finds nothing', async () => {
    (findSibMock as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue(null)
    const rakutenSource = p('未知の商品', 'https://item.rakuten.co.jp/shop/unknown/')
    rakutenSource.platform = 'rakuten'
    expect(await findEquivalent(rakutenSource, 'amazon')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/matching/find-equivalent.test.ts`
Expected: FAIL — the Amazon path returns null on sibling miss (no fallback yet), so the first assertion (`out` not null) fails.

- [ ] **Step 3: Implement the wiring**

In `src/lib/matching/find-equivalent.ts`, add to the existing imports:

```ts
import { matchAgainstDb } from '@/lib/matching/db-fallback'
```

Add `linkSlugToProduct` to the existing `@/lib/harvest/repo` import line (keep the other names):

```ts
import { findListingByPlatformId, findSiblingListings, upsertProduct, upsertListing, findAmazonSiblingByRakuten, linkSlugToProduct } from '@/lib/harvest/repo'
```

Replace the Amazon block (currently lines 27-34):

```ts
  if (targetPlatform === 'amazon') {
    if (source.platform !== 'rakuten') return null
    const rktCode = sourcePlatformId(source)
    if (!rktCode) return null
    const sib = await findAmazonSiblingByRakuten(rktCode).catch(() => null)
    if (sib) {
      return buildAmazonLinkResult({ asin: sib.asin, title: sib.productTitle, imageUrl: sib.productImageUrl })
    }
    // Exact-id missed (pasted slug ≠ stored API itemCode). Match the source against
    // our own DB products by title; write back so the next paste hits the fast path.
    const category = await classifyCategory(source.title).catch(() => 'unknown' as const)
    const dbMatch = await matchAgainstDb(source, 'amazon', category === 'unknown' ? undefined : category).catch(() => null)
    if (!dbMatch) return null
    await linkSlugToProduct(dbMatch.productId, 'rakuten', rktCode, source.title, 0.8).catch(() => {})
    return buildAmazonLinkResult({ asin: dbMatch.targetListingId, title: dbMatch.productTitle, imageUrl: dbMatch.productImageUrl })
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/matching/find-equivalent.test.ts`
Expected: PASS (existing tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/find-equivalent.ts src/lib/matching/find-equivalent.test.ts
git commit -m "feat(matching): DB fallback in findEquivalent for Rakuten-paste→Amazon"
```

---

### Task 4: Amazon-paste → Rakuten resolver + route wiring

**Files:**
- Create: `src/lib/lookup/resolve-amazon-paste.ts`
- Test: `src/lib/lookup/resolve-amazon-paste.test.ts`
- Modify: `src/app/api/lookup/route.ts` (the `parsed.platform === 'amazon'` branch + imports)

**Interfaces:**
- Consumes: `findMatchByAsin`, `linkSlugToProduct` from `@/lib/harvest/repo`; `buildAmazonLinkResult` from `@/lib/platforms/amazon-link`; `lookupRakuten` from `@/lib/platforms/rakuten`; `matchAgainstDb` from `@/lib/matching/db-fallback`.
- Produces:
  - `interface AmazonPasteResolution { amazonCard: ProductResult; rakuten: ProductResult | null }`
  - `resolveAmazonPaste(asin: string, slugTitle: string): Promise<AmazonPasteResolution | null>` (null only when there is neither a DB match nor a usable slug title — preserves the route's existing 404 condition).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/lookup/resolve-amazon-paste.test.ts`:

```ts
jest.mock('@/lib/harvest/repo', () => ({ findMatchByAsin: jest.fn(), linkSlugToProduct: jest.fn() }))
jest.mock('@/lib/platforms/rakuten', () => ({ lookupRakuten: jest.fn() }))
jest.mock('@/lib/matching/db-fallback', () => ({ matchAgainstDb: jest.fn() }))
jest.mock('@/lib/platforms/amazon-link', () => ({
  buildAmazonLinkResult: (i: { asin: string; title: string; imageUrl: string }) => ({
    platform: 'amazon', title: i.title, imageUrl: i.imageUrl, shopName: 'Amazon.co.jp',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: `https://www.amazon.co.jp/dp/${i.asin}?tag=t`, priceUnavailable: true,
  }),
}))

import { findMatchByAsin, linkSlugToProduct } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { matchAgainstDb } from '@/lib/matching/db-fallback'
import { resolveAmazonPaste } from './resolve-amazon-paste'
import { ProductResult } from '@/lib/types'

const rakutenResult = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: 'ri', shopName: 'shop', salePrice: 2000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 20,
  effectivePrice: 1980, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: 'https://item.rakuten.co.jp/shop/abc/',
})

beforeEach(() => jest.clearAllMocks())

it('returns null when there is neither a DB match nor a slug title', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  expect(await resolveAmazonPaste('B0EXACT0001', '')).toBeNull()
  expect(matchAgainstDb).not.toHaveBeenCalled()
})

it('exact ASIN match: returns Amazon card + hydrated Rakuten sibling, no fallback', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue({
    productTitle: 'パンパース M46', productImageUrl: 'ri', rakutenItemCode: 'jetprice:10718259',
  })
  ;(lookupRakuten as jest.Mock).mockResolvedValue(rakutenResult('パンパース M46'))
  const out = await resolveAmazonPaste('B0EXACT0001', 'slug title')
  expect(out!.amazonCard.affiliateUrl).toContain('B0EXACT0001')
  expect(out!.amazonCard.title).toBe('パンパース M46')
  expect(out!.rakuten!.platform).toBe('rakuten')
  expect(matchAgainstDb).not.toHaveBeenCalled()
})

it('ASIN miss: DB fallback finds a Rakuten sibling, hydrates price, writes back', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  ;(matchAgainstDb as jest.Mock).mockResolvedValue({
    productId: 688, targetListingId: 'jetprice:10718259',
    productTitle: 'パンパース はじめての肌いち M46枚', productImageUrl: 'ri', similarity: 0.4,
  })
  ;(lookupRakuten as jest.Mock).mockResolvedValue(rakutenResult('パンパース はじめての肌いち M46枚'))
  const out = await resolveAmazonPaste('B0MISS00002', 'パンパース M46枚')
  expect(out!.amazonCard.title).toBe('パンパース はじめての肌いち M46枚')
  expect(out!.amazonCard.imageUrl).toBe('ri')
  expect(out!.rakuten!.salePrice).toBe(2000)
  expect(matchAgainstDb).toHaveBeenCalledWith(expect.objectContaining({ platform: 'amazon' }), 'rakuten')
  expect(linkSlugToProduct).toHaveBeenCalledWith(688, 'amazon', 'B0MISS00002', 'パンパース はじめての肌いち M46枚', 0.8)
})

it('ASIN miss + fallback miss: Amazon card from slug title, no Rakuten', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  ;(matchAgainstDb as jest.Mock).mockResolvedValue(null)
  const out = await resolveAmazonPaste('B0MISS00003', 'スリングだっこ紐')
  expect(out!.amazonCard.title).toBe('スリングだっこ紐')
  expect(out!.rakuten).toBeNull()
  expect(linkSlugToProduct).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/lookup/resolve-amazon-paste.test.ts`
Expected: FAIL — `Cannot find module './resolve-amazon-paste'`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/lookup/resolve-amazon-paste.ts`:

```ts
import { ProductResult } from '@/lib/types'
import { findMatchByAsin, linkSlugToProduct } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { matchAgainstDb } from '@/lib/matching/db-fallback'

export interface AmazonPasteResolution {
  amazonCard: ProductResult
  rakuten: ProductResult | null
}

// Resolve an Amazon paste (ASIN + best-effort slug title) into a link-only Amazon
// card plus its priced Rakuten sibling. Exact ASIN match first; on miss, fall back
// to a confidence-gated DB title match and write the result back. Returns null only
// when there is neither a DB match nor a usable slug title (route then 404s).
// All steps best-effort: failures degrade to "Amazon card alone, no Rakuten".
export async function resolveAmazonPaste(asin: string, slugTitle: string): Promise<AmazonPasteResolution | null> {
  const match = await findMatchByAsin(asin).catch(() => null)
  if (!match && !slugTitle) return null

  let title = match?.productTitle ?? slugTitle
  let imageUrl = match?.productImageUrl ?? ''
  let rakuten = match?.rakutenItemCode ? await lookupRakuten(match.rakutenItemCode).catch(() => null) : null

  if (!match && slugTitle) {
    const probe = buildAmazonLinkResult({ asin, title: slugTitle, imageUrl: '' })
    const dbMatch = await matchAgainstDb(probe, 'rakuten').catch(() => null)
    if (dbMatch) {
      title = dbMatch.productTitle
      imageUrl = dbMatch.productImageUrl
      rakuten = await lookupRakuten(dbMatch.targetListingId).catch(() => null)
      await linkSlugToProduct(dbMatch.productId, 'amazon', asin, dbMatch.productTitle, 0.8).catch(() => {})
    }
  }

  return { amazonCard: buildAmazonLinkResult({ asin, title, imageUrl }), rakuten }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/lookup/resolve-amazon-paste.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the route to call the resolver**

In `src/app/api/lookup/route.ts`, add the import:

```ts
import { resolveAmazonPaste } from '@/lib/lookup/resolve-amazon-paste'
```

Replace the current Amazon branch (the block starting `if (parsed.platform === 'amazon') {` through its closing `}` — currently the `findMatchByAsin` / `buildAmazonLinkResult` / `lookupRakuten` lines) with:

```ts
  if (parsed.platform === 'amazon') {
    // DB-only: link-only Amazon card + its priced Rakuten sibling. Exact ASIN match
    // first; on miss, a confidence-gated DB title match (no Amazon scraping).
    const resolution = await resolveAmazonPaste(parsed.id, extractTitleFromAmazonUrl(resolvedUrl) ?? '')
    if (!resolution) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    results = [resolution.amazonCard, ...(resolution.rakuten ? [resolution.rakuten] : [])].sort(byEffectivePrice)
  } else {
```

Leave the `else` (Rakuten) branch unchanged. Remove the now-unused imports from `route.ts` **only if** they are no longer referenced anywhere else in the file: check `findMatchByAsin`, `buildAmazonLinkResult`, and `lookupRakuten`. (`lookupRakuten` is still used by the Rakuten branch's `findEquivalent`? No — verify: it is imported for the Amazon branch. If the Rakuten branch / `resolveJanRakutenUrl` does not import it here, remove `lookupRakuten`, `findMatchByAsin`, and `buildAmazonLinkResult` from `route.ts`'s imports.) Run `npx tsc --noEmit` to confirm no unused-import or type errors.

- [ ] **Step 6: Verify typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite 0 failures.

- [ ] **Step 7: Commit**

```bash
git add src/lib/lookup/resolve-amazon-paste.ts src/lib/lookup/resolve-amazon-paste.test.ts src/app/api/lookup/route.ts
git commit -m "feat(lookup): Amazon-paste→Rakuten DB fallback resolver + route wiring"
```

---

### Task 5: Offline threshold tuning harness + lock `SIMILARITY_FLOOR`

**Files:**
- Create: `scripts/tuning/tune-db-fallback.ts`
- Modify: `src/lib/matching/db-fallback.ts` (update the `SIMILARITY_FLOOR` value + comment)
- Modify: `docs/superpowers/specs/2026-06-26-db-match-fallback-design.md` (record the chosen T + measured precision/recall)

**Interfaces:**
- Consumes: `rankBySimilarity`, `similarity` from `@/lib/matching/rank`; `semanticMatch` from `@/lib/llm/openrouter`; the goldset at `docs/harvest/verify/goldset.jsonl` (fields: `atitle`, `rtitle`, `label` ∈ {KEEP, REMOVE, UNSURE}, `category`).
- Produces: a printed precision/recall table; a locked `SIMILARITY_FLOOR` constant.

**Method:** The goldset has no listing ids, so tune on titles. For each sampled row, the source is `rtitle`; candidates are `[atitle] + K distractor atitles from the same category`. Run `semanticMatch` once, record the chosen candidate's similarity score and whether the chosen title equals the row's `atitle`. A predicted-positive on a `KEEP` row whose chosen title is its `atitle` is a true positive; a predicted-positive on a `REMOVE` row (or a wrong chosen title) is a false positive. Sweep the floor `T` over the recorded scores. Pick the smallest `T` with precision ≥ 0.95.

- [ ] **Step 1: Write the harness**

Create `scripts/tuning/tune-db-fallback.ts`:

```ts
process.env.USE_UNPOOLED = '1'
import { readFileSync } from 'fs'
import { rankBySimilarity, similarity } from '../../src/lib/matching/rank'
import { semanticMatch } from '../../src/lib/llm/openrouter'
import { ProductResult } from '../../src/lib/types'

const SAMPLE = Number(process.env.SAMPLE ?? 150) // rows to evaluate (LLM cost control)
const DISTRACTORS = 4

interface Row { atitle: string; rtitle: string; label: string; category: string }

function result(title: string): ProductResult {
  return {
    platform: 'amazon', title, imageUrl: '', shopName: '', salePrice: 0,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

async function main() {
  const all = readFileSync('docs/harvest/verify/goldset.jsonl', 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l) as Row)
    .filter((r) => r.label === 'KEEP' || r.label === 'REMOVE')

  // Deterministic sample: every Nth row.
  const step = Math.max(1, Math.floor(all.length / SAMPLE))
  const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLE)

  const records: { score: number; correct: boolean; predicted: boolean; label: string }[] = []
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i]
    const pool = all.filter((r) => r.category === row.category && r.atitle !== row.atitle)
    const distractors = pool.filter((_, j) => j % Math.max(1, Math.floor(pool.length / DISTRACTORS)) === 0).slice(0, DISTRACTORS)
    const candidateRows = [row, ...distractors]
    const ranked = rankBySimilarity(result(row.rtitle), candidateRows.map((c) => result(c.atitle)))
    const idx = await semanticMatch(result(row.rtitle), ranked).catch(() => null)
    if (idx === null) { records.push({ score: 0, correct: false, predicted: false, label: row.label }); continue }
    const chosen = ranked[idx]
    const score = similarity(row.rtitle, chosen.title)
    records.push({ score, correct: chosen.title === row.atitle, predicted: true, label: row.label })
    if (i % 10 === 0) console.error(`...${i}/${sample.length}`)
  }

  console.log('T\tprecision\trecall\tTP\tFP\tkeepN')
  const keepN = records.filter((r) => r.label === 'KEEP').length
  for (const T of [0, 0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30]) {
    const pos = records.filter((r) => r.predicted && r.score >= T)
    const tp = pos.filter((r) => r.correct && r.label === 'KEEP').length
    const fp = pos.length - tp
    const precision = pos.length ? tp / pos.length : 1
    const recall = keepN ? tp / keepN : 0
    console.log(`${T}\t${precision.toFixed(3)}\t${recall.toFixed(3)}\t${tp}\t${fp}\t${keepN}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the harness**

Run: `USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx scripts/tuning/tune-db-fallback.ts`
Expected: a precision/recall table printed to stdout (progress on stderr). Requires `.env.local` with `OPENROUTER_API_KEY` (or the configured LLM key) for `semanticMatch`.

- [ ] **Step 3: Lock the threshold**

Read the table. Pick the smallest `T` whose precision ≥ 0.950. Update `SIMILARITY_FLOOR` in `src/lib/matching/db-fallback.ts` to that value, and replace the comment's provisional note with the measured numbers, e.g.:

```ts
// Locked 2026-06-26 via scripts/tuning/tune-db-fallback.ts (n=150 goldset rows):
// T=0.15 → precision 0.96, recall 0.78. Smallest T meeting precision ≥ 0.95.
export const SIMILARITY_FLOOR = 0.15
```

(Use the actual T and measured precision/recall from your run — the values above are an example, not a fixed target.)

- [ ] **Step 4: Record the result in the spec and re-run the suite**

Append the chosen `T` and the precision/recall table to the "Threshold tuning" section of `docs/superpowers/specs/2026-06-26-db-match-fallback-design.md`.

Run: `npm test`
Expected: full suite 0 failures (the db-fallback unit tests use mocked `semanticMatch`, so they are independent of the chosen `T` unless `T` rises above the "above floor" test fixture's score — if a test breaks, the locked `T` is implausibly high; re-examine).

- [ ] **Step 5: Commit**

```bash
git add scripts/tuning/tune-db-fallback.ts src/lib/matching/db-fallback.ts docs/superpowers/specs/2026-06-26-db-match-fallback-design.md
git commit -m "feat(tuning): lock SIMILARITY_FLOOR via goldset precision/recall harness"
```

---

## Self-Review

**Spec coverage:**
- Pipeline stage (candidate retrieval → rank → semanticMatch → gate → write-back): Tasks 1–3. ✓
- Conservative gate (confirm AND ≥ T): Task 2 + Task 5. ✓
- Both directions (Rakuten→Amazon, Amazon→Rakuten): Task 3 + Task 4. ✓
- Write-back as `matchSource='llm'`: Task 1 (`linkSlugToProduct`) + Tasks 3/4 callers. ✓
- Candidate→ProductResult adapter with `effectivePrice=0`: Task 2 (`toResult`). ✓
- Threshold tuning harness + precision ≥ 95%: Task 5. ✓
- Error handling best-effort / never throws into user path: `.catch` on every step in Tasks 2/3/4. ✓
- Compliance (Amazon link-only, DB-only candidates): Task 2 retrieves from DB; Tasks 3/4 use `buildAmazonLinkResult`. ✓
- Caching under existing `lookup6:` key: unchanged — the route already wraps results in that cache; new code sits inside the cached path. ✓ (No task needed; behavior preserved.)

**Placeholder scan:** No TBD/TODO. `SIMILARITY_FLOOR` ships with a working provisional value (0.12) in Task 2 and is locked in Task 5 — not a placeholder. The example T (0.15) in Task 5 Step 3 is explicitly labeled an example.

**Type consistency:** `ProductCandidate` (Task 1) consumed by `matchAgainstDb` (Task 2). `DbMatch` fields (`productId`, `targetListingId`, `productTitle`, `productImageUrl`, `similarity`) used identically in Tasks 3 and 4. `matchAgainstDb(source, target, category?)` signature matches all call sites (Task 3 passes category; Task 4 omits it). `linkSlugToProduct(productId, platform, platformId, title, confidence)` matches both callers. ✓
