# Pack-Size-Aware Multi-Candidate Amazon Matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user opens a Rakuten item's comparison page, show up to 5 same-product Amazon options ranked by pack-size closeness (each size-labeled) instead of one often-wrong-size match.

**Architecture:** A pure pack-size parser (`g>ml>枚`, kg-range + nested-parenthetical handling) feeds a multi-candidate matcher: refine→broad-retrieve→`semanticMatchAll`→rank-by-pack-closeness→top-5. A new `findAmazonEquivalents` merges the exact-id sibling and returns link-only Amazon cards tagged with a size badge; the two Rakuten→Amazon comparison routes spread that list into their results.

**Tech Stack:** TypeScript, Next.js 16 App Router, Jest 29 (node env, no RTL), Neon Postgres (`pg`).

## Global Constraints

- Amazon stays link-only: DB-only candidates, no Amazon scraping/price/image; cards via `buildAmazonLinkResult` (`priceUnavailable: true`). (CLAUDE.md HARD RULE.)
- Every Amazon link carries the partner tag (handled inside `buildAmazonLinkResult`).
- Imperfect pack parsing must degrade gracefully: unparseable → `total: null` → ranked last, no size badge, similarity order. Never a false `サイズ一致`, never a thrown error into a request.
- Scope: Rakuten→Amazon only. Amazon→Rakuten (`resolveAmazonPaste`) unchanged.
- "same size" band: ratio ∈ **[0.8, 1.25]**. Max **5** candidates. Never drop by size.
- No new test dependencies — no React Testing Library; UI verified by `tsc` + browser.
- Full Jest suite green and `tsc` clean before any commit.

---

### Task 1: Pack-size parser (`pack-size.ts`)

**Files:**
- Create: `src/lib/matching/pack-size.ts`
- Test: `src/lib/matching/pack-size.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface PackSize { dimension: 'g' | 'ml' | '枚' | null; total: number | null }`
  - `parsePackSize(title: string): PackSize`
  - `sizeRelation(src: PackSize, cand: PackSize): 'exact' | 'different' | 'unknown'`
  - `packCloseness(src: PackSize, cand: PackSize): number`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/matching/pack-size.test.ts`:

```ts
import { parsePackSize, sizeRelation, packCloseness } from './pack-size'

describe('parsePackSize', () => {
  it.each([
    ['明治ほほえみ（780g×2パック）', 'g', 1560],
    ['明治ほほえみ らくらくキューブ(27g×60袋入)', 'g', 1620],
    ['明治ほほえみ らくらくキューブ 27g×4袋入', 'g', 108],
    ['明治ほほえみ らくらくミルク ケース販売(240ml×24缶)', 'ml', 5760],
    ['明治 ほほえみ 2缶パック 1560g（780g（大缶）×2缶）×4個（1ケース）', 'g', 6240], // nested parens, no double-count
    ['森永 はぐくみ 大缶 810g×3個セット', 'g', 2430],
    ['マミーポコ夜用パンツビッグ大 22枚', '枚', 22],
    ['グーン Mサイズ テープ 52枚', '枚', 52],
    ['メリーズ エアスルー パンツ Mサイズ 156枚 52枚×3袋', '枚', 156], // total + breakdown
    ['ユニ・チャーム ムーニーおしりふき 詰替64枚×3', '枚', 192], // base × mult
    ['【パンツ】メリーズパンツ Mサイズ(6~11kg) 58枚', '枚', 58], // kg-range excluded
  ])('parses %s', (title, dim, total) => {
    expect(parsePackSize(title)).toEqual({ dimension: dim, total })
  })

  it.each([
    '明治 ほほえみ らくらくミルク アタッチメントII',
    '森永 はぐくみ エコらくパック つめかえ用(400g*2袋入)×3個セット', // all measures inside parens → unknown
  ])('returns null for unparseable %s', (title) => {
    expect(parsePackSize(title)).toEqual({ dimension: null, total: null })
  })
})

describe('sizeRelation', () => {
  const g = (total: number | null) => ({ dimension: 'g' as const, total })
  it('exact within ±25%', () => {
    expect(sizeRelation(g(1620), g(1560))).toBe('exact')   // ratio 0.96
    expect(sizeRelation(g(1000), g(800))).toBe('exact')    // ratio 0.8 (boundary)
  })
  it('different outside band', () => {
    expect(sizeRelation(g(3240), g(108))).toBe('different') // 30x
    expect(sizeRelation(g(1000), g(2000))).toBe('different')
  })
  it('unknown when a total is null or dimensions differ', () => {
    expect(sizeRelation(g(1000), g(null))).toBe('unknown')
    expect(sizeRelation(g(1000), { dimension: 'ml', total: 1000 })).toBe('unknown')
  })
})

describe('packCloseness', () => {
  it('0 for identical, larger for farther, Infinity for unknown', () => {
    const g = (total: number | null) => ({ dimension: 'g' as const, total })
    expect(packCloseness(g(1000), g(1000))).toBe(0)
    expect(packCloseness(g(1000), g(2000))).toBeGreaterThan(packCloseness(g(1000), g(1200)))
    expect(packCloseness(g(1000), g(null))).toBe(Infinity)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/matching/pack-size.test.ts`
Expected: FAIL — `Cannot find module './pack-size'`.

- [ ] **Step 3: Implement `pack-size.ts`**

Create `src/lib/matching/pack-size.ts`:

```ts
// Pack-size extraction for cross-platform quantity comparison. Heuristic and
// best-effort: anything not confidently parseable returns { total: null } so callers
// degrade gracefully (no size badge, ranked last). Correctness over coverage — a
// wrong number mis-ranks, an unknown is safe.

export interface PackSize {
  dimension: 'g' | 'ml' | '枚' | null
  total: number | null
}

// Pack multipliers: "×N" or "N<container>". "×3袋" matches the ×3 alternative once.
const MULT_RE = /[×xX]\s*(\d+)|(\d+)\s*(?:袋|缶|箱|個|本|セット|パック|ケース|組)/g

export function parsePackSize(title: string): PackSize {
  // 1. Drop baby weight RANGES (the baby's size, not the pack): 6~11kg, 6-11kg, （4-8kg）
  const noRange = title.replace(/[(（]?\s*\d+\s*[-~ー〜]\s*\d+\s*kg\s*[)）]?/gi, ' ')
  // 2. Iteratively remove parenthetical breakdowns (innermost first, handles nesting)
  //    so a stated total isn't multiplied by its own breakdown.
  let outer = noRange
  let prev = ''
  while (outer !== prev) { prev = outer; outer = outer.replace(/[(（][^()（）]*[)）]/g, ' ') }
  // 3. Pack multiplier product from the outer text.
  let mult = 1
  for (const m of outer.matchAll(MULT_RE)) {
    const n = parseInt(m[1] ?? m[2], 10)
    if (n > 1 && n < 1000) mult *= n
  }
  // 4. Base measure by priority g (kg→g) > ml; total = base × mult.
  let m = outer.match(/(\d+(?:\.\d+)?)\s*kg(?![a-z])/i)
  if (m) return { dimension: 'g', total: Math.round(parseFloat(m[1]) * 1000 * mult) }
  m = outer.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  if (m) return { dimension: 'g', total: Math.round(parseFloat(m[1]) * mult) }
  m = outer.match(/(\d+(?:\.\d+)?)\s*ml/i)
  if (m) return { dimension: 'ml', total: Math.round(parseFloat(m[1]) * mult) }
  // 5. 枚 (diapers/wipes): largest standalone count, or smallest×mult — whichever larger.
  //    "156枚 52枚×3袋" → max(156, 52×3=156)=156; "64枚×3" → max(64, 64×3=192)=192.
  const maes = [...noRange.matchAll(/(\d+)\s*枚/g)].map((x) => parseInt(x[1], 10)).filter((n) => n > 0)
  if (maes.length) return { dimension: '枚', total: Math.max(Math.max(...maes), Math.min(...maes) * mult) }
  return { dimension: null, total: null }
}

// Same product, comparable size? Different dimensions or missing total → unknown.
export function sizeRelation(src: PackSize, cand: PackSize): 'exact' | 'different' | 'unknown' {
  if (!src.total || !cand.total || src.dimension !== cand.dimension) return 'unknown'
  const ratio = cand.total / src.total
  return ratio >= 0.8 && ratio <= 1.25 ? 'exact' : 'different'
}

// Ordering key: 0 = identical size, larger = farther; Infinity sorts unknown last.
export function packCloseness(src: PackSize, cand: PackSize): number {
  if (!src.total || !cand.total || src.dimension !== cand.dimension) return Infinity
  return Math.abs(Math.log(cand.total / src.total))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/matching/pack-size.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/pack-size.ts src/lib/matching/pack-size.test.ts
git commit -m "feat(matching): cross-genre pack-size parser (g/ml/枚) + relation/closeness"
```

---

### Task 2: `semanticMatchAll` (multi-confirm)

**Files:**
- Modify: `src/lib/llm/openrouter.ts` (add export after `semanticMatch`, ~line 118)
- Test: `src/lib/matching/llm-match.test.ts` (existing file that tests `semanticMatch`)

**Interfaces:**
- Consumes: existing `callLLM`, `brandsAreDistinct`, `composeMatchPrompt`, `JUDGE_MODEL` (all in `openrouter.ts`).
- Produces: `semanticMatchAll(source: ProductResult, candidates: ProductResult[], opts?: { category?: Category }): Promise<number[]>` — all confirmed candidate indices (into `candidates`), `[]` on none/failure.

- [ ] **Step 1: Write the failing test**

Check the existing mock style first: `grep -n "callLLM\|jest.mock" src/lib/matching/llm-match.test.ts`. It mocks the LLM call. Append a `describe` block mirroring that style. If `llm-match.test.ts` mocks `callLLM` via `jest.mock('@/lib/llm/openrouter-client')` or similar, reuse that exact mock target. Add:

```ts
import { semanticMatchAll } from '@/lib/llm/openrouter'

describe('semanticMatchAll', () => {
  const src = (title: string): ProductResult => ({
    platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
    subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  })
  it('returns ALL confirmed indices (not just the cheapest)', async () => {
    mockLLMResponse('{"matches":[0,2]}') // use this file's existing LLM-mock helper
    const cands = ['明治ほほえみ 780g', '別ブランド 哺乳瓶', '明治ほほえみ 780g×2'].map(src)
    expect(await semanticMatchAll(src('明治ほほえみ 780g'), cands)).toEqual([0, 2])
  })
  it('returns [] when none confirmed', async () => {
    mockLLMResponse('{"matches":[]}')
    expect(await semanticMatchAll(src('x'), [src('y')])).toEqual([])
  })
})
```

(Replace `mockLLMResponse(...)` with the file's actual LLM-mocking mechanism found via the grep. If `llm-match.test.ts` does not exist or does not mock the LLM, create `src/lib/llm/semantic-match-all.test.ts` mocking the same module `semanticMatch`'s tests mock.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- llm-match.test.ts`
Expected: FAIL — `semanticMatchAll is not a function`.

- [ ] **Step 3: Implement**

In `src/lib/llm/openrouter.ts`, add after `semanticMatch` (after line 118). This mirrors `semanticMatch` exactly but returns the full mapped list instead of reducing to cheapest:

```ts
// Like semanticMatch, but returns ALL confirmed same-product candidate indices
// (into `candidates`), preserving the LLM's order. Used by multi-candidate matching.
export async function semanticMatchAll(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<number[]> {
  if (!candidates.length) return []
  try {
    const gated = candidates
      .map((c, origIdx) => ({ c, origIdx }))
      .filter(({ c }) => !brandsAreDistinct(source.title, c.title))
    if (!gated.length) return []
    const pool = gated.slice(0, 8)
    const fmt = (p: ProductResult, i?: number) => {
      const prefix = i !== undefined ? `${i}: ` : 'Source: '
      const desc = p.description ? ` [${p.description.slice(0, 120)}]` : ''
      return `${prefix}${p.title.slice(0, 100)} ¥${p.salePrice.toLocaleString()}${desc}`
    }
    const candidateList = pool.map(({ c }, i) => fmt(c, i)).join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `${composeMatchPrompt(opts?.category)}\n\n${fmt(source)}\nCandidates:\n${candidateList}`,
    }], { model: JUDGE_MODEL, maxTokens: 600 })
    const cleaned = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { matches: number[] }
    if (!Array.isArray(parsed.matches)) return []
    return parsed.matches
      .filter((i) => typeof i === 'number' && pool[i] !== undefined)
      .map((i) => pool[i].origIdx)
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- llm-match.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/matching/llm-match.test.ts
git commit -m "feat(llm): semanticMatchAll returns all confirmed match indices"
```

---

### Task 3: Retrieval recall (`findProductCandidatesByTokens`)

**Files:**
- Modify: `src/lib/harvest/repo.ts` (the `findProductCandidatesByTokens` body)
- Test: `src/lib/harvest/repo.test.ts` (update the `findProductCandidatesByTokens` describe)

**Interfaces:**
- Consumes: `query`.
- Produces: same signature `findProductCandidatesByTokens(keyword, targetPlatform, limit=20): Promise<ProductCandidate[]>` — now space-insensitive and textual-tokens-only.

- [ ] **Step 1: Update the failing test**

Replace the existing `findProductCandidatesByTokens` describe block in `src/lib/harvest/repo.test.ts` with:

```ts
describe('findProductCandidatesByTokens', () => {
  let querySpy: jest.SpyInstance
  beforeEach(() => { querySpy = jest.spyOn(db, 'query') })
  afterEach(() => querySpy.mockRestore())

  it('matches space-insensitively on textual tokens only (drops size tokens)', async () => {
    querySpy.mockResolvedValue([
      { product_id: 1, title: '明治 ほほえみ らくらくキューブ 27g×30袋', image_url: 'i', target_id: 'A1' },
    ])
    const out = await findProductCandidatesByTokens('明治ほほえみ らくらくキューブ 27g', 'amazon')
    const [sql, params] = querySpy.mock.calls[0]
    // space-insensitive comparison on the title column
    expect(sql).toMatch(/regexp_replace\(p\.title/)
    // textual tokens bound space-stripped; the size token "27g" is NOT bound
    expect(params).toEqual(['%明治ほほえみ%', '%らくらくキューブ%', 'amazon', 20])
    expect(out).toEqual([{ productId: 1, title: '明治 ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A1' }])
  })

  it('returns [] and does not query for an all-size/empty keyword', async () => {
    expect(await findProductCandidatesByTokens('780g ×2', 'amazon')).toEqual([])
    expect(querySpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/harvest/repo.test.ts`
Expected: FAIL — current impl binds `%27g%` and uses plain `ILIKE` (no `regexp_replace`).

- [ ] **Step 3: Implement**

Replace the `findProductCandidatesByTokens` body in `src/lib/harvest/repo.ts`:

```ts
export async function findProductCandidatesByTokens(
  keyword: string,
  targetPlatform: 'amazon' | 'rakuten',
  limit = 20,
): Promise<ProductCandidate[]> {
  // Textual tokens only: drop pure-number / size tokens (12, 27g, 780g, 240ml, 58枚,
  // 2袋…) — pack size is handled by ranking, not retrieval. Keep brand/product words.
  const SIZE_TOKEN = /^\d+(?:\.\d+)?(?:g|kg|ml|l|枚|袋|缶|個|本|箱|セット|パック|ケース|組)?$/i
  const tokens = keyword.trim().split(/[\s　]+/).filter((t) => t && !SIZE_TOKEN.test(t)).slice(0, 6)
  if (!tokens.length) return []
  // Space-insensitive: compare the title with whitespace removed against space-stripped tokens,
  // so "明治 ほほえみ" matches "明治ほほえみ". Non-indexed scan; table is ~10k rows.
  const conds = tokens
    .map((_, i) => `regexp_replace(p.title, '[\\s　]', '', 'g') ILIKE $${i + 1}`)
    .join(' AND ')
  const params = [...tokens.map((t) => `%${t.replace(/[\s　]/g, '')}%`), targetPlatform, limit]
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/harvest/repo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/harvest/repo.ts src/lib/harvest/repo.test.ts
git commit -m "feat(repo): space-insensitive, size-token-free candidate retrieval"
```

---

### Task 4: `sizeMatch` field + multi-candidate `matchAgainstDb`

**Files:**
- Modify: `src/lib/types.ts` (add optional field to `ProductResult`)
- Modify: `src/lib/matching/db-fallback.ts` (`matchAgainstDb` → `DbMatch[]`)
- Modify: `src/lib/matching/find-equivalent.ts` (Amazon path: consume `[0]` so it compiles against the new list return — superseded in Task 5)
- Test: `src/lib/matching/db-fallback.test.ts` (update existing cases to list shape + add ranking test)
- Test: `src/lib/matching/find-equivalent.test.ts` (update the two existing Amazon-fallback tests to mock the list shape — superseded in Task 5)

**Interfaces:**
- Consumes: `refineKeyword`, `semanticMatchAll` (Task 2), `findProductCandidatesByTokens` (Task 3), `rankBySimilarity`, `similarity`, `parsePackSize`/`sizeRelation`/`packCloseness` (Task 1).
- Produces:
  - `ProductResult.sizeMatch?: 'exact' | 'different'`
  - `interface DbMatch { productId: number; targetListingId: string; productTitle: string; productImageUrl: string; similarity: number; sizeMatch?: 'exact' | 'different' }`
  - `matchAgainstDb(source, target, category?): Promise<DbMatch[]>` (ranked closest-first, ≤5, deduped by `targetListingId`).
  - `SIMILARITY_FLOOR` unchanged (0.12).

- [ ] **Step 1: Add the type field**

In `src/lib/types.ts`, inside `ProductResult`, after `priceUnavailable?: boolean`:

```ts
  // Cross-platform pack-size relation vs the item the user is comparing against.
  // Set only on link-only Amazon candidate cards; 'exact' ≈ same pack, 'different' ≈
  // same product different pack. Omitted when size is not comparable.
  sizeMatch?: 'exact' | 'different'
```

- [ ] **Step 2: Write/Update the failing tests**

Rewrite `src/lib/matching/db-fallback.test.ts` to the list shape (the mocks already cover `findProductCandidatesByTokens`, `semanticMatch`, `refineKeyword`; add `semanticMatchAll`). Full file:

```ts
jest.mock('@/lib/harvest/repo', () => ({ findProductCandidatesByTokens: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ semanticMatchAll: jest.fn(), refineKeyword: jest.fn() }))
// rank.ts and pack-size.ts are NOT mocked — exercise the real gate + ranking.

import { findProductCandidatesByTokens } from '@/lib/harvest/repo'
import { semanticMatchAll, refineKeyword } from '@/lib/llm/openrouter'
import { matchAgainstDb } from './db-fallback'
import { ProductResult } from '@/lib/types'

const src = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
  subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(refineKeyword as jest.Mock).mockImplementation(async (t: string) => t)
})

it('refines the title to a keyword before retrieval (spaceless JP titles)', async () => {
  (refineKeyword as jest.Mock).mockResolvedValue('明治ほほえみ らくらくキューブ')
  ;(findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 5, title: '明治ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A30' },
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([0])
  const out = await matchAgainstDb(src('明治ほほえみらくらくキューブ(27g×120袋)'), 'amazon')
  expect(findProductCandidatesByTokens).toHaveBeenCalledWith('明治ほほえみ らくらくキューブ', 'amazon')
  expect(out.map((m) => m.targetListingId)).toEqual(['A30'])
})

it('returns confirmed candidates ranked by pack closeness, tagged, deduped, capped at 5', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: '明治ほほえみ らくらくキューブ 27g×4袋', imageUrl: 'i', targetListingId: 'A4' },     // 108g, far
    { productId: 2, title: '明治ほほえみ らくらくキューブ 810g×2個', imageUrl: 'i', targetListingId: 'A60' },   // 1620g, closest
    { productId: 2, title: '明治ほほえみ らくらくキューブ 810g×2個', imageUrl: 'i', targetListingId: 'A60' },   // dup
    { productId: 3, title: '明治ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A30' },   // 810g, mid
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([0, 1, 2, 3])
  // source 27g×60袋 = 1620g → A60 (exact) closest, then A30, then A4
  const out = await matchAgainstDb(src('明治ほほえみ らくらくキューブ 27g×60袋'), 'amazon')
  expect(out.map((m) => m.targetListingId)).toEqual(['A60', 'A30', 'A4'])
  expect(out[0].sizeMatch).toBe('exact')      // 1620 vs 1620
  expect(out[2].sizeMatch).toBe('different')  // 108 vs 1620
})

it('returns [] when nothing confirms', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: 'x', imageUrl: 'i', targetListingId: 'A' },
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('y'), 'amazon')).toEqual([])
})

it('returns [] on an empty candidate pool without calling the LLM', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('x'), 'amazon')).toEqual([])
  expect(semanticMatchAll).not.toHaveBeenCalled()
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- src/lib/matching/db-fallback.test.ts`
Expected: FAIL — current `matchAgainstDb` returns a single object/null and imports `semanticMatch`.

- [ ] **Step 4: Implement**

Rewrite `src/lib/matching/db-fallback.ts`:

```ts
import { ProductResult } from '@/lib/types'
import { type Category } from '@/lib/llm/category-prompts'
import { semanticMatchAll, refineKeyword } from '@/lib/llm/openrouter'
import { rankBySimilarity, similarity } from '@/lib/matching/rank'
import { parsePackSize, sizeRelation, packCloseness } from '@/lib/matching/pack-size'
import { findProductCandidatesByTokens, type ProductCandidate } from '@/lib/harvest/repo'

// Min rankBySimilarity score for a confirmed candidate (thin-/junk-pool safety net).
// Locked via scripts/tuning/tune-db-fallback.ts; see prior tuning (precision ≥ 0.95).
export const SIMILARITY_FLOOR = 0.12
const MAX_CANDIDATES = 5

export interface DbMatch {
  productId: number
  targetListingId: string
  productTitle: string
  productImageUrl: string
  similarity: number
  sizeMatch?: 'exact' | 'different'
}

function toResult(c: ProductCandidate, platform: 'amazon' | 'rakuten'): ProductResult {
  return {
    platform, title: c.title, imageUrl: c.imageUrl, shopName: '',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

// All same-product DB candidates on `target`, ranked by pack-size closeness to
// `source` (size-unknown last), deduped by listing id, capped at MAX_CANDIDATES.
// Best-effort: any failure returns []. Ranking/gating use source.title; retrieval
// uses a refined keyword (handles spaceless JP titles).
export async function matchAgainstDb(
  source: ProductResult,
  target: 'amazon' | 'rakuten',
  category?: Category,
): Promise<DbMatch[]> {
  const keyword = await refineKeyword(source.title, target, category).catch(() => source.title)
  const candidates = await findProductCandidatesByTokens(keyword, target).catch(() => [] as ProductCandidate[])
  if (!candidates.length) return []

  const pairs = candidates.map((c) => ({ cand: c, result: toResult(c, target) }))
  const resultToCand = new Map(pairs.map((p) => [p.result, p.cand]))
  const ranked = rankBySimilarity(source, pairs.map((p) => p.result))

  const idxs = await semanticMatchAll(source, ranked, { category }).catch(() => [] as number[])
  if (!idxs.length) return []

  const srcPack = parsePackSize(source.title)
  const matches: DbMatch[] = []
  for (const idx of idxs) {
    const chosen = ranked[idx]
    if (!chosen) continue
    const cand = resultToCand.get(chosen)
    if (!cand) continue
    const sim = similarity(source.title, chosen.title)
    if (sim < SIMILARITY_FLOOR) continue
    const rel = sizeRelation(srcPack, parsePackSize(cand.title))
    matches.push({
      productId: cand.productId, targetListingId: cand.targetListingId,
      productTitle: cand.title, productImageUrl: cand.imageUrl, similarity: sim,
      sizeMatch: rel === 'unknown' ? undefined : rel,
    })
  }

  matches.sort((a, b) =>
    packCloseness(srcPack, parsePackSize(a.productTitle)) - packCloseness(srcPack, parsePackSize(b.productTitle)))

  const seen = new Set<string>()
  const out: DbMatch[] = []
  for (const m of matches) {
    if (seen.has(m.targetListingId)) continue
    seen.add(m.targetListingId)
    out.push(m)
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}
```

- [ ] **Step 5: Keep `find-equivalent` compiling (minimal, superseded in Task 5)**

`matchAgainstDb` now returns a list, so the existing Amazon path in
`src/lib/matching/find-equivalent.ts` no longer typechecks. Patch it minimally —
take the closest one:

```ts
    // (existing Amazon block, after the exact-id sibling miss)
    const category = await classifyCategory(source.title).catch(() => 'unknown' as const)
    const dbMatch = (await matchAgainstDb(source, 'amazon', category === 'unknown' ? undefined : category).catch(() => []))[0] ?? null
    if (!dbMatch) return null
    await linkSlugToProduct(dbMatch.productId, 'rakuten', rktCode, source.title, 0.8).catch(() => {})
    return buildAmazonLinkResult({ asin: dbMatch.targetListingId, title: dbMatch.productTitle, imageUrl: dbMatch.productImageUrl })
```

And in `src/lib/matching/find-equivalent.test.ts`, change the two existing
"Amazon DB fallback" tests to mock the list shape: `matchAgainstDb` resolves to
`[{ productId: 688, targetListingId: 'B0FTFXNGFS', productTitle: '…', productImageUrl: 'img', similarity: 0.4 }]`
for the hit case and `[]` for the miss case. (Task 5 replaces these with
`findAmazonEquivalents` tests.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsc --noEmit && npm test -- src/lib/matching/db-fallback.test.ts src/lib/matching/find-equivalent.test.ts`
Expected: tsc exit 0; both suites PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/matching/db-fallback.ts src/lib/matching/db-fallback.test.ts src/lib/matching/find-equivalent.ts src/lib/matching/find-equivalent.test.ts
git commit -m "feat(matching): multi-candidate matchAgainstDb ranked by pack closeness"
```

---

### Task 5: `findAmazonEquivalents` + `findEquivalent` delegation

**Files:**
- Modify: `src/lib/matching/find-equivalent.ts` (add `findAmazonEquivalents`; Amazon path delegates)
- Test: `src/lib/matching/find-equivalent.test.ts` (update Amazon-fallback tests; add multi test)

**Interfaces:**
- Consumes: `matchAgainstDb` (Task 4), existing `findAmazonSiblingByRakuten`, `linkSlugToProduct`, `buildAmazonLinkResult`, `classifyCategory`, local `sourcePlatformId`.
- Produces: `findAmazonEquivalents(source: ProductResult, category?: Category): Promise<ProductResult[]>` — link-only Amazon cards (exact-id sibling first, then ranked DB matches), each with `sizeMatch` set, ≤5, deduped by ASIN. `findEquivalent(...,'amazon')` returns the first element or null.

- [ ] **Step 1: Write the failing tests**

In `src/lib/matching/find-equivalent.test.ts`: change the db-fallback mock to the multi shape and add `findAmazonEquivalents` coverage. Update the mock near the top:

```ts
jest.mock('@/lib/matching/db-fallback', () => ({ matchAgainstDb: jest.fn(async () => []) }))
```

Update imports: `import { matchAgainstDb } from '@/lib/matching/db-fallback'` (already present) and add `findAmazonEquivalents` to the `./find-equivalent` import. Replace the existing "Amazon DB fallback" describe with:

```ts
import { findAmazonEquivalents } from './find-equivalent'

describe('findAmazonEquivalents', () => {
  it('puts the exact-id sibling first, then ranked DB matches, deduped, ≤5', async () => {
    (findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue({
      asin: 'B0SIB', productTitle: 'P&G パンパース M 58枚', productImageUrl: 'img',
    })
    ;(matchAgainstDb as jest.Mock).mockResolvedValue([
      { productId: 9, targetListingId: 'B0SIB', productTitle: 'dup', productImageUrl: 'i', similarity: 0.5, sizeMatch: 'exact' },
      { productId: 9, targetListingId: 'B0OTHER', productTitle: 'P&G パンパース M 116枚', productImageUrl: 'i2', similarity: 0.4, sizeMatch: 'different' },
    ])
    const source = p('パンパース M 58枚', 'https://item.rakuten.co.jp/shop/x/')
    source.platform = 'rakuten'
    const out = await findAmazonEquivalents(source)
    expect(out.map((r) => r.affiliateUrl.match(/dp\/([A-Z0-9]+)/)?.[1])).toEqual(['B0SIB', 'B0OTHER'])
    expect(out[1].sizeMatch).toBe('different')
    expect(out.every((r) => r.platform === 'amazon' && r.priceUnavailable)).toBe(true)
  })

  it('returns [] when no sibling and no DB match', async () => {
    (findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue([])
    const source = p('未知の商品', 'https://item.rakuten.co.jp/shop/u/')
    source.platform = 'rakuten'
    expect(await findAmazonEquivalents(source)).toEqual([])
  })
})

describe('findEquivalent amazon delegates to findAmazonEquivalents', () => {
  it('returns the first (closest) equivalent or null', async () => {
    (findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue([
      { productId: 1, targetListingId: 'B0TOP', productTitle: 't', productImageUrl: 'i', similarity: 0.4, sizeMatch: 'exact' },
    ])
    const source = p('パンパース M 58枚', 'https://item.rakuten.co.jp/shop/x/')
    source.platform = 'rakuten'
    const r = await findEquivalent(source, 'amazon')
    expect(r?.affiliateUrl).toContain('B0TOP')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/matching/find-equivalent.test.ts`
Expected: FAIL — `findAmazonEquivalents` not exported; Amazon path still uses single `matchAgainstDb`.

- [ ] **Step 3: Implement**

In `src/lib/matching/find-equivalent.ts`: ensure `linkSlugToProduct` and `findAmazonSiblingByRakuten` are imported (already are), and `matchAgainstDb` import points to the multi version (already imported). Add the new export near the top of the file (after imports) and rewrite the Amazon branch of `findEquivalent` to delegate:

```ts
// All same-product Amazon equivalents for a Rakuten source, link-only and ranked by
// pack-size closeness: exact-id sibling first, then confidence-gated DB matches.
// Deduped by ASIN, capped at 5. Best-effort: failures yield fewer/zero cards.
export async function findAmazonEquivalents(
  source: ProductResult,
  category?: Category,
): Promise<ProductResult[]> {
  if (source.platform !== 'rakuten') return []
  const rktCode = sourcePlatformId(source)
  const out: ProductResult[] = []
  const seen = new Set<string>()

  if (rktCode) {
    const sib = await findAmazonSiblingByRakuten(rktCode).catch(() => null)
    if (sib) {
      out.push(buildAmazonLinkResult({ asin: sib.asin, title: sib.productTitle, imageUrl: sib.productImageUrl }))
      seen.add(sib.asin)
    }
  }

  const cat = category ?? (await classifyCategory(source.title).catch(() => 'unknown' as const))
  const many = await matchAgainstDb(source, 'amazon', cat === 'unknown' ? undefined : cat).catch(() => [])
  for (const m of many) {
    if (seen.has(m.targetListingId)) continue
    seen.add(m.targetListingId)
    const card = buildAmazonLinkResult({ asin: m.targetListingId, title: m.productTitle, imageUrl: m.productImageUrl })
    card.sizeMatch = m.sizeMatch
    out.push(card)
  }

  if (rktCode && many[0]) {
    await linkSlugToProduct(many[0].productId, 'rakuten', rktCode, source.title, 0.8).catch(() => {})
  }
  return out.slice(0, 5)
}
```

Then replace the existing Amazon block inside `findEquivalent` (the `if (targetPlatform === 'amazon') { ... }` block) with a thin delegation:

```ts
  if (targetPlatform === 'amazon') {
    return (await findAmazonEquivalents(source, undefined))[0] ?? null
  }
```

(Removes the now-superseded inline exact-id + single-`matchAgainstDb` logic; `findAmazonEquivalents` owns it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/matching/find-equivalent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/find-equivalent.ts src/lib/matching/find-equivalent.test.ts
git commit -m "feat(matching): findAmazonEquivalents (ranked, link-only); findEquivalent delegates"
```

---

### Task 6: Size badge in `ProductCard`

**Files:**
- Modify: `src/components/ProductCard.tsx` (badge in the platform-label row)

**Interfaces:**
- Consumes: `ProductResult.sizeMatch` (Task 4).
- Produces: visual badge only; no exported API.

No jest test (repo has no React Testing Library / jsdom). Verified by `tsc` + the browser check in Task 7.

- [ ] **Step 1: Implement the badge**

In `src/components/ProductCard.tsx`, in the main render's platform-label row (after the platform `<span>`, ~line 84, inside the `<div className="flex items-center gap-2 mb-2 flex-wrap">`), add:

```tsx
        {result.sizeMatch === 'exact' && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-800">
            サイズ一致 <span className="font-normal italic">same size</span>
          </span>
        )}
        {result.sizeMatch === 'different' && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            別容量 <span className="font-normal italic">different size</span>
          </span>
        )}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ProductCard.tsx
git commit -m "feat(ui): size-match badge on link-only Amazon cards"
```

---

### Task 7: Wire comparison routes + verify

**Files:**
- Modify: `src/app/api/enrich-compare/route.ts`
- Modify: `src/app/api/lookup/stream/route.ts` (Rakuten branch)

**Interfaces:**
- Consumes: `findAmazonEquivalents` (Task 5).
- Produces: comparison `results` now contain up to 5 Amazon cards.

- [ ] **Step 1: Wire `enrich-compare`**

In `src/app/api/enrich-compare/route.ts`: replace the import `import { findEquivalent } from '@/lib/matching/find-equivalent'` with `import { findAmazonEquivalents } from '@/lib/matching/find-equivalent'`, and replace the match task body (lines ~43-48):

```ts
        const matchTask = (async () => {
          const matches = await findAmazonEquivalents(source).catch(() => [])
          match = matches[0] ?? null
          const results = [enrichedSource, ...matches].sort(byEffectivePrice)
          send({ type: 'basic', results })
        })()
```

(`match` is still used by the explanation block; keep it as the closest one. `candidates` param is no longer passed — `findAmazonEquivalents` does its own retrieval. Remove the now-unused `candidates` destructure if TypeScript flags it.)

- [ ] **Step 2: Wire `lookup/stream` Rakuten branch**

In `src/app/api/lookup/stream/route.ts`: replace `import { findEquivalent } from '@/lib/matching/find-equivalent'` with `import { findAmazonEquivalents } from '@/lib/matching/find-equivalent'`, and replace the Amazon-match sub-block in the Rakuten branch (around line 137):

```ts
            (async () => {
              send({ type: 'status', message: 'Amazonの同等商品を確認中…' })
              const matches = await findAmazonEquivalents(rakutenProduct).catch(() => [])
              basicResults = [latestRakuten, ...matches].sort(byEffectivePrice)
              send({ type: 'basic', results: basicResults })
            })(),
```

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc exit 0; full suite green.

- [ ] **Step 4: Real-DB verification script**

Create `scripts/debug-verify-packsize.ts` (throwaway; delete after):

```ts
process.env.USE_UNPOOLED = '1'
import { findAmazonEquivalents } from '../src/lib/matching/find-equivalent'
import { pool } from '../src/lib/db'
import { ProductResult } from '../src/lib/types'

const src = (title: string, code: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 5000, shippingCost: 0,
  couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 5000, subscribeAvailable: false,
  rakutenCardEligible: true, teikiRates: null, taxRate: 1.08,
  affiliateUrl: `https://item.rakuten.co.jp/${code}/`,
})

async function main() {
  for (const [t, c] of [
    ['明治ほほえみらくらくキューブ(27g×120袋)', 'netbaby/dummy'],
    ['メリーズ エアスルー パンツ Mサイズ 156枚 52枚×3袋', 'shop/dummy2'],
  ] as const) {
    const out = await findAmazonEquivalents(src(t, c)).catch((e) => `ERR ${e.message}`)
    console.log('\n— ' + t)
    if (Array.isArray(out)) out.forEach((r) =>
      console.log('  ', r.affiliateUrl.match(/dp\/([A-Z0-9]+)/)?.[1], r.sizeMatch ?? '-', '|', r.title.slice(0, 44)))
    else console.log('  ', out)
  }
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Run: `USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx scripts/debug-verify-packsize.ts`
Expected: the 120袋 case returns multiple ranked らくらくキューブ ASINs (closest pack first, the 4袋 no longer the lone result); the diaper case ranks by 枚. Then `rm scripts/debug-verify-packsize.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/enrich-compare/route.ts src/app/api/lookup/stream/route.ts
git commit -m "feat(lookup): show up to 5 pack-ranked Amazon candidates per Rakuten item"
```

---

## Self-Review

**Spec coverage:**
- Multi-candidate (≤5, closest-first, never drop): Task 4 (rank/cap) + Task 5 (merge) + Task 7 (wire). ✓
- Pack parser (g>ml>枚, kg-range, nested parens, total-vs-breakdown): Task 1. ✓
- Recall (space-insensitive, size-token-free): Task 3. ✓
- Multi-confirm: Task 2. ✓
- Size badge (exact/different/omitted): Task 4 (field) + Task 6 (render). ✓
- Graceful unknown (ranked last, no badge): Task 1 (`packCloseness=Infinity`, `sizeRelation='unknown'`) + Task 4 (sort + `sizeMatch` omitted). ✓
- Scope Rakuten→Amazon only; Amazon→Rakuten unchanged: Tasks 5/7 (resolveAmazonPaste untouched). ✓
- Ordering (Rakuten first, Amazon by closeness): relies on stable `byEffectivePrice`; cards spread in closeness order. ✓
- Compliance (link-only, DB-only): Task 5 uses `buildAmazonLinkResult`; no Amazon scraping added. ✓

**Placeholder scan:** none. Task 2's `mockLLMResponse` is explicitly flagged to be replaced with the file's actual LLM-mock mechanism (found via the grep in Step 1) — not a literal.

**Type consistency:** `DbMatch` (Task 4) consumed by `findAmazonEquivalents` (Task 5). `sizeMatch?: 'exact'|'different'` consistent across `types.ts` (Task 4), `DbMatch` (Task 4), `ProductCard` (Task 6). `matchAgainstDb` → `DbMatch[]` and `findAmazonEquivalents` → `ProductResult[]` match all call sites. `findProductCandidatesByTokens` signature unchanged (default limit 20). `semanticMatchAll(source, candidates, opts?) → number[]` matches its caller in Task 4.

**Coupling (resolved):** Task 4 changes `matchAgainstDb`'s return type; its Step 5 includes the minimal `find-equivalent.ts` `[0]` patch + test update so Task 4 is independently green (`tsc` + suite). Task 5 then supersedes that inline path with `findAmazonEquivalents` delegation. Each task ends green.
