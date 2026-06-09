# LLM Price-Difference Explanation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a product match is found, return a clear LLM-generated Japanese sentence explaining why one platform is cheaper, bundled into the matching response (no extra client query), replacing the rule-based bullet list (bullets remain the fallback).

**Architecture:** A new pure module `src/lib/price/explain.ts` is the single source of truth for the comparison facts (extracted from `PriceExplanation.tsx`). `explainPriceDifference(winner, loser)` in `openrouter.ts` builds a number-pinned prompt from those facts, calls the LLM (temp 0), and caches by product-pair key. POST routes (`enrich-compare`, `find-amazon`, `lookup`) include `explanation` in their JSON; the SSE route (`lookup/stream`) emits a final `{type:'explanation', text}` event after the match. The client renders the sentence when present and toggles are at defaults, falling back to the rule-based bullets when the LLM failed or a toggle changed the winner/gap.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Jest + ts-jest (`testEnvironment: node`, no React Testing Library), OpenRouter LLM via `callLLM`, `@vercel/kv` + in-memory cache.

**Spec:** `docs/superpowers/specs/2026-06-09-price-explanation-design.md`

---

## File Structure

- **Create `src/lib/price/explain.ts`** — pure facts module. `pickWinnerLoser`, `computePriceFacts`, plus the `platformName` and `extractMultiplier` helpers moved out of the component. No React, importable from both server and client.
- **Create `src/lib/price/explain.test.ts`** — unit tests for the pure module.
- **Modify `src/components/PriceExplanation.tsx`** — consume `computePriceFacts`; accept optional `explanation` prop; render the sentence when present, else the bullets.
- **Modify `src/lib/llm/openrouter.ts`** — add `explainPriceDifference(winner, loser)` with pair-key caching.
- **Modify `src/lib/llm/openrouter.test.ts`** — add `explainPriceDifference` tests.
- **Modify `src/lib/types.ts`** — add `explanation?: string` to `SearchResponse`.
- **Modify `src/app/api/enrich-compare/route.ts`**, **`src/app/api/find-amazon/route.ts`**, **`src/app/api/lookup/route.ts`** — compute and include `explanation`.
- **Create `src/app/api/find-amazon/route.test.ts`** — route returns `explanation` on match, `null` on no match.
- **Modify `src/app/api/lookup/stream/route.ts`** — emit `explanation` SSE event after the match (cache-hit and live paths).
- **Modify `src/app/results/page.tsx`** — thread `explanation` from SSE + POST responses into state; compute the toggle-staleness fallback; pass to `PriceExplanation`.

---

## Task 1: Pure facts module (`src/lib/price/explain.ts`)

**Files:**
- Create: `src/lib/price/explain.ts`
- Test: `src/lib/price/explain.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/price/explain.test.ts`:

```ts
import { pickWinnerLoser, computePriceFacts } from './explain'
import { ProductResult } from '@/lib/types'

const mk = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'rakuten', title: '', description: undefined, imageUrl: '', shopName: '',
  salePrice: 1000, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '', ...over,
})

describe('pickWinnerLoser', () => {
  it('orders the pair by effectivePrice (cheaper is winner)', () => {
    const a = mk({ title: 'A', effectivePrice: 2000 })
    const b = mk({ title: 'B', effectivePrice: 1500 })
    expect(pickWinnerLoser(a, b).winner.title).toBe('B')
    expect(pickWinnerLoser(a, b).loser.title).toBe('A')
    expect(pickWinnerLoser(b, a).winner.title).toBe('B')
  })
})

describe('computePriceFacts', () => {
  it('reports diff, diffPct and a list-price reason when the winner has a lower sale price', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 1800, effectivePrice: 1800 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, effectivePrice: 2000 })
    const f = computePriceFacts(winner, loser)
    expect(f.diff).toBe(200)
    expect(f.diffPct).toBe(10)
    expect(f.listPriceDiff).toBe(200)
    expect(f.reasons.some(r => r.includes('定価が¥200安い'))).toBe(true)
  })

  it('reports a free-shipping reason', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, shippingCost: 0, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, shippingCost: 500, effectivePrice: 2500 })
    const f = computePriceFacts(winner, loser)
    expect(f.winnerFreeShipping).toBe(true)
    expect(f.reasons.some(r => r.includes('送料無料'))).toBe(true)
  })

  it('reports a points reason when the winner earns >¥50 more points', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, pointsEarned: 200, effectivePrice: 1800 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, pointsEarned: 20, effectivePrice: 1980 })
    const f = computePriceFacts(winner, loser)
    expect(f.pointsDelta).toBe(180)
    expect(f.reasons.some(r => r.includes('ポイント還元が¥180多い'))).toBe(true)
  })

  it('reports a quantity-multiplier mismatch note', () => {
    const winner = mk({ platform: 'rakuten', title: 'おむつ 2パック', salePrice: 2000, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', title: 'おむつ 4個セット', salePrice: 2200, effectivePrice: 2200 })
    const f = computePriceFacts(winner, loser)
    expect(f.winnerMultiplier).toBe(2)
    expect(f.loserMultiplier).toBe(4)
    expect(f.reasons.some(r => r.startsWith('※ 内容量が異なります'))).toBe(true)
  })

  it('returns no reasons when prices are identical', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, effectivePrice: 2000 })
    const f = computePriceFacts(winner, loser)
    expect(f.reasons).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/lib/price/explain.test.ts`
Expected: FAIL — `Cannot find module './explain'`.

- [ ] **Step 3: Implement the module**

Create `src/lib/price/explain.ts`:

```ts
import { ProductResult, Platform } from '@/lib/types'

export interface PriceFacts {
  winnerPlatform: Platform
  loserPlatform: Platform
  diff: number            // effectivePrice gap (loser − winner), yen
  diffPct: number         // gap as a percent of the loser's effective price
  listPriceDiff: number   // loser.salePrice − winner.salePrice (>0 ⇒ winner's list price is lower)
  pointsDelta: number     // winner.pointsEarned − loser.pointsEarned
  winnerFreeShipping: boolean
  loserShipping: number
  winnerMultiplier: number
  loserMultiplier: number
  reasons: string[]       // Japanese bullet strings for the fallback UI
}

const PLATFORM_JP: Record<Platform, string> = { amazon: 'Amazon', rakuten: '楽天' }

export function platformName(p: Platform): string {
  return PLATFORM_JP[p]
}

// Extract a quantity multiplier from a title (e.g. "×2箱", "4個セット", "2パック").
export function extractMultiplier(title: string): number {
  const m =
    title.match(/[×x×](\d+)[箱個袋パック缶本枚セット]/) ||
    title.match(/(\d+)[箱個袋パック缶本枚セット]入/) ||
    title.match(/(\d+)個セット/)
  return m ? parseInt(m[1], 10) : 1
}

export function pickWinnerLoser(
  a: ProductResult,
  b: ProductResult,
): { winner: ProductResult; loser: ProductResult } {
  return a.effectivePrice <= b.effectivePrice
    ? { winner: a, loser: b }
    : { winner: b, loser: a }
}

export function computePriceFacts(winner: ProductResult, loser: ProductResult): PriceFacts {
  const diff = loser.effectivePrice - winner.effectivePrice
  const diffPct = loser.effectivePrice > 0 ? Math.round((diff / loser.effectivePrice) * 100) : 0
  const listPriceDiff = loser.salePrice - winner.salePrice
  const pointsDelta = winner.pointsEarned - loser.pointsEarned
  const winnerFreeShipping = winner.shippingCost === 0 && loser.shippingCost > 0
  const winnerMultiplier = extractMultiplier(winner.title)
  const loserMultiplier = extractMultiplier(loser.title)

  const reasons: string[] = []
  if (winner.salePrice < loser.salePrice) {
    reasons.push(`定価が¥${listPriceDiff.toLocaleString()}安い`)
  }
  if (winnerFreeShipping) {
    reasons.push(`${platformName(winner.platform)}は送料無料（${platformName(loser.platform)}は+¥${loser.shippingCost}）`)
  }
  if (pointsDelta > 50) {
    reasons.push(`ポイント還元が¥${pointsDelta.toLocaleString()}多い`)
  }
  if (winnerMultiplier !== loserMultiplier && (winnerMultiplier > 1 || loserMultiplier > 1)) {
    const wUnit = Math.round(winner.effectivePrice / winnerMultiplier)
    const lUnit = Math.round(loser.effectivePrice / loserMultiplier)
    reasons.push(`※ 内容量が異なります（${platformName(winner.platform)}：×${winnerMultiplier}、${platformName(loser.platform)}：×${loserMultiplier}）。1単位あたり ${platformName(winner.platform)} ¥${wUnit.toLocaleString()} vs ${platformName(loser.platform)} ¥${lUnit.toLocaleString()}`)
  }
  if (reasons.length === 0 && winner.salePrice !== loser.salePrice) {
    reasons.push(`${platformName(winner.platform)}の販売価格が低い`)
  }

  return {
    winnerPlatform: winner.platform,
    loserPlatform: loser.platform,
    diff, diffPct, listPriceDiff, pointsDelta,
    winnerFreeShipping, loserShipping: loser.shippingCost,
    winnerMultiplier, loserMultiplier,
    reasons,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/lib/price/explain.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/price/explain.ts src/lib/price/explain.test.ts
git commit -m "feat: add pure price-facts module (pickWinnerLoser, computePriceFacts)"
```

---

## Task 2: Refactor `PriceExplanation.tsx` to use the module and accept an `explanation` prop

**Files:**
- Modify: `src/components/PriceExplanation.tsx` (full rewrite — replaces inline reason logic with `computePriceFacts`)

There is no React Testing Library in this repo, so this component is verified by the Task 1 unit tests (its logic now lives there) plus the in-app verification in Task 6. Keep the component a thin renderer.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `src/components/PriceExplanation.tsx` with:

```tsx
'use client'
import { ProductResult } from '@/lib/types'
import { computePriceFacts, platformName } from '@/lib/price/explain'

interface Props {
  winner: ProductResult
  loser: ProductResult
  explanation?: string   // LLM sentence; when present it replaces the bullet list
}

export default function PriceExplanation({ winner, loser, explanation }: Props) {
  if (!winner || !loser) return null

  const facts = computePriceFacts(winner, loser)

  // Nothing meaningful to say and prices are equal → render nothing (preserves prior behavior).
  if (!explanation && facts.reasons.length === 0) return null

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-900 leading-relaxed">
      <p className="font-bold mb-1">
        💡 {platformName(facts.winnerPlatform)}が¥{facts.diff.toLocaleString()}安い理由
        <span className="font-normal text-blue-600 ml-1">({facts.diffPct}%OFF)</span>
      </p>
      {explanation ? (
        <p>{explanation}</p>
      ) : (
        <ul className="space-y-0.5">
          {facts.reasons.map((r, i) => (
            <li key={i} className={r.startsWith('※') ? 'text-[10px] text-blue-700 mt-1' : ''}>
              {r.startsWith('※') ? r : `・${r}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the project type-checks (the component is now driven by the shared module)**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors. (The old local `platformName`/`extractMultiplier` are gone; they now come from `@/lib/price/explain`.)

- [ ] **Step 3: Run the existing test suite to confirm no regressions**

Run: `npx jest`
Expected: PASS for all pre-existing suites except the 3 known pre-existing Rakuten shipping failures (unrelated to this change). Note them but do not fix here.

- [ ] **Step 4: Commit**

```bash
git add src/components/PriceExplanation.tsx
git commit -m "refactor: drive PriceExplanation from shared facts module, add explanation prop"
```

---

## Task 3: Add `explainPriceDifference` to `openrouter.ts`

**Files:**
- Modify: `src/lib/llm/openrouter.ts:1-2` (imports) and append the new function
- Test: `src/lib/llm/openrouter.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/llm/openrouter.test.ts` (after the existing `describe('refineKeyword dispatch', ...)` block). It reuses the file's existing `mockFetch`, `llmReply`, and `mockProduct` helpers. Distinct `affiliateUrl`s per test avoid the pair-key cache returning a stale sentence across tests:

```ts
describe('explainPriceDifference', () => {
  it('returns the LLM sentence for a winner/loser pair', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockResolvedValue(llmReply('楽天は定価が¥200安く、¥200お得です。'))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-ok-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-ok-1' }
    winner.effectivePrice = 1800
    loser.effectivePrice = 2000
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBe('楽天は定価が¥200安く、¥200お得です。')
  })

  it('returns null when the LLM call throws', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockRejectedValue(new Error('network'))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-throw-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-throw-1' }
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBeNull()
  })

  it('returns null when the LLM returns empty content', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockResolvedValue(llmReply(''))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-empty-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-empty-1' }
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/lib/llm/openrouter.test.ts -t explainPriceDifference`
Expected: FAIL — `explainPriceDifference` is not exported.

- [ ] **Step 3: Update the imports in `openrouter.ts`**

In `src/lib/llm/openrouter.ts`, replace the top imports (lines 1-2):

```ts
import { ProductResult } from '@/lib/types'
import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT, type Category } from './category-prompts'
```

with:

```ts
import { ProductResult } from '@/lib/types'
import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT, type Category } from './category-prompts'
import { computePriceFacts, platformName } from '@/lib/price/explain'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
```

- [ ] **Step 4: Append the new function to `openrouter.ts`**

Add at the end of `src/lib/llm/openrouter.ts` (after `stripBrackets`):

```ts
/**
 * Generates one short, friendly Japanese sentence explaining why `winner` is
 * cheaper than `loser`. The prompt pins the exact computed numbers and forbids
 * inventing or altering them, so the LLM-written sentence stays factually correct.
 * Cached by product-pair key. Returns null on any failure — callers fall back to
 * the rule-based bullets.
 */
export async function explainPriceDifference(
  winner: ProductResult,
  loser: ProductResult,
): Promise<string | null> {
  const keyBase = `explain:${winner.affiliateUrl || winner.title}:${loser.affiliateUrl || loser.title}`
  const cacheKey = makeCacheKey(keyBase)
  const cached = await getCached<string>(cacheKey).catch(() => null)
  if (cached) return cached

  try {
    const f = computePriceFacts(winner, loser)
    const listPriceLine = f.listPriceDiff > 0
      ? `${platformName(f.winnerPlatform)}が¥${f.listPriceDiff.toLocaleString()}安い`
      : '同じ'
    const pointsLine = f.pointsDelta > 50
      ? `${platformName(f.winnerPlatform)}が¥${f.pointsDelta.toLocaleString()}多い`
      : 'ほぼ同じ'
    const shippingLine = f.winnerFreeShipping
      ? `${platformName(f.winnerPlatform)}は送料無料、${platformName(f.loserPlatform)}は¥${f.loserShipping.toLocaleString()}`
      : '同条件'

    const content = await callLLM([{
      role: 'user',
      content: `あなたは日本の価格比較アプリのアシスタントです。以下の「事実」だけを使い、なぜ${platformName(f.winnerPlatform)}の方が安いのかを買い物客にやさしく説明する短い日本語の文を、1文（最大2文）で書いてください。

事実:
- 安い方: ${platformName(f.winnerPlatform)}「${winner.title.slice(0, 60)}」
- 高い方: ${platformName(f.loserPlatform)}「${loser.title.slice(0, 60)}」
- 価格差: ¥${f.diff.toLocaleString()}（${f.diffPct}%お得）
- 定価の差: ${listPriceLine}
- ポイント還元の差: ${pointsLine}
- 送料: ${shippingLine}

ルール:
- 上の数字をそのまま使い、数字を変えたり新しく作ったりしないこと。
- 専門用語を避け、親しみやすい言葉で。
- 1文、最大2文。前置きや箇条書き・記号は不要。文だけを出力すること。`,
    }])

    const sentence = content.trim()
    if (!sentence) return null
    await setCached(cacheKey, sentence).catch(() => {})
    return sentence
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/lib/llm/openrouter.test.ts`
Expected: PASS — the 3 new `explainPriceDifference` tests green, all existing `openrouter` tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat: add explainPriceDifference LLM helper with pair-key caching"
```

---

## Task 4: Add `explanation` to the POST routes and types

**Files:**
- Modify: `src/lib/types.ts:38-47` (`SearchResponse`)
- Modify: `src/app/api/find-amazon/route.ts` (full rewrite)
- Modify: `src/app/api/enrich-compare/route.ts` (add explanation after the match)
- Modify: `src/app/api/lookup/route.ts` (add explanation to the final response)
- Test: `src/app/api/find-amazon/route.test.ts` (new)

- [ ] **Step 1: Add `explanation` to `SearchResponse`**

In `src/lib/types.ts`, change the `SearchResponse` interface (lines 38-47) to add one field:

```ts
export interface SearchResponse {
  mode: 'keyword-list' | 'comparison'
  // keyword-list mode: both platforms crawled in parallel
  rakutenResults: ProductResult[]
  amazonResults: ProductResult[]
  // comparison mode: URL paste result (single pair)
  results: ProductResult[]
  query: string
  cached: boolean
  explanation?: string         // LLM price-difference sentence (comparison mode, when a pair was found)
}
```

- [ ] **Step 2: Write the failing route test**

Create `src/app/api/find-amazon/route.test.ts`:

```ts
jest.mock('@/lib/matching/find-equivalent', () => ({ findEquivalent: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ explainPriceDifference: jest.fn() }))

import { POST } from './route'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { ProductResult } from '@/lib/types'
import { NextRequest } from 'next/server'

const mk = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'amazon', title: '', description: undefined, imageUrl: '', shopName: '',
  salePrice: 2000, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 2000, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '', ...over,
})

const reqWith = (bodyObj: unknown) =>
  ({ json: async () => bodyObj } as unknown as NextRequest)

beforeEach(() => {
  ;(findEquivalent as jest.Mock).mockReset()
  ;(explainPriceDifference as jest.Mock).mockReset()
})

describe('POST /api/find-amazon', () => {
  it('returns the match and an explanation when an equivalent is found', async () => {
    const source = mk({ platform: 'amazon', title: 'Amazon 商品', effectivePrice: 2000, affiliateUrl: 'a1' })
    const match = mk({ platform: 'rakuten', title: '楽天 商品', effectivePrice: 1800, affiliateUrl: 'r1' })
    ;(findEquivalent as jest.Mock).mockResolvedValue(match)
    ;(explainPriceDifference as jest.Mock).mockResolvedValue('楽天が¥200お得です。')

    const res = await POST(reqWith({ source, candidates: [] }))
    const data = await res.json() as { result: ProductResult | null; explanation?: string | null }

    expect(data.result?.affiliateUrl).toBe('r1')
    expect(data.explanation).toBe('楽天が¥200お得です。')
    expect(explainPriceDifference).toHaveBeenCalledTimes(1)
  })

  it('returns null result and null explanation when no equivalent is found', async () => {
    const source = mk({ platform: 'amazon', title: 'Amazon 商品', affiliateUrl: 'a2' })
    ;(findEquivalent as jest.Mock).mockResolvedValue(null)

    const res = await POST(reqWith({ source, candidates: [] }))
    const data = await res.json() as { result: ProductResult | null; explanation?: string | null }

    expect(data.result).toBeNull()
    expect(data.explanation).toBeNull()
    expect(explainPriceDifference).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the route test to verify it fails**

Run: `npx jest src/app/api/find-amazon/route.test.ts`
Expected: FAIL — current route returns `{ result }` with no `explanation` (first test's `data.explanation` is `undefined`, not the sentence).

- [ ] **Step 4: Update `find-amazon/route.ts`**

Replace the entire contents of `src/app/api/find-amazon/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { pickWinnerLoser } from '@/lib/price/explain'
import { ProductResult } from '@/lib/types'
export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null; explanation?: string | null }>> {
  const body = await req.json() as { source?: ProductResult; candidates?: ProductResult[] }
  if (!body.source) {
    return NextResponse.json({ result: null, explanation: null }, { status: 400 })
  }
  // Amazon card tapped → find the Rakuten equivalent via a fresh targeted search,
  // using the keyword-search pick-list (candidates) as a supplementary pool.
  const result = await findEquivalent(body.source, 'rakuten', body.candidates ?? []).catch(() => null)
  let explanation: string | null = null
  if (result) {
    const { winner, loser } = pickWinnerLoser(body.source, result)
    explanation = await explainPriceDifference(winner, loser).catch(() => null)
  }
  return NextResponse.json({ result, explanation })
}
```

- [ ] **Step 5: Run the route test to verify it passes**

Run: `npx jest src/app/api/find-amazon/route.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 6: Update `enrich-compare/route.ts`**

Replace the entire contents of `src/app/api/enrich-compare/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { pickWinnerLoser } from '@/lib/price/explain'
import { ProductResult } from '@/lib/types'
// Called when user taps a Rakuten card from the keyword pick-list.
// 1. Crawls the Rakuten item page to get real live points (JS-rendered via ScraperAPI)
// 2. Runs a fresh targeted Amazon search for this specific product, then LLM match
// Both run in parallel — the match uses the source title (unchanged by enrichment),
// so we don't stack the two slow operations. The price-difference explanation is
// generated after both resolve, so it reflects the live-points effective price.
// Returns { source: enrichedRakuten, result: amazonMatch | null, explanation }
export async function POST(req: NextRequest): Promise<NextResponse<{
  source: ProductResult
  result: ProductResult | null
  explanation?: string | null
}>> {
  const body = await req.json() as {
    source?: ProductResult
    candidates?: ProductResult[]
  }
  if (!body.source) {
    return NextResponse.json({ source: null as unknown as ProductResult, result: null, explanation: null }, { status: 400 })
  }

  const { source, candidates } = body

  // Enrich Rakuten item with live points from the item page
  const itemUrl = source.affiliateUrl.includes('hb.afl.rakuten')
    ? decodeURIComponent(source.affiliateUrl.split('pc=')[1]?.split('&')[0] ?? '') || source.affiliateUrl
    : source.affiliateUrl

  const [enriched, result] = await Promise.all([
    crawlRakutenProduct(itemUrl).catch(() => null),
    findEquivalent(source, 'amazon', candidates ?? []).catch(() => null),
  ])

  const finalSource = enriched ?? source
  let explanation: string | null = null
  if (result) {
    const { winner, loser } = pickWinnerLoser(finalSource, result)
    explanation = await explainPriceDifference(winner, loser).catch(() => null)
  }

  return NextResponse.json({ source: finalSource, result, explanation })
}
```

- [ ] **Step 7: Update `lookup/route.ts`**

In `src/app/api/lookup/route.ts`, add two imports after line 6 (`import { ProductResult, SearchResponse } ...`):

```ts
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { pickWinnerLoser } from '@/lib/price/explain'
```

Then replace the final return block (lines 98-102):

```ts
  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [],
    results, query: url, cached: false,
  } satisfies SearchResponse)
```

with:

```ts
  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})
  let explanation: string | undefined
  if (results.length === 2) {
    const { winner, loser } = pickWinnerLoser(results[0], results[1])
    explanation = (await explainPriceDifference(winner, loser).catch(() => null)) ?? undefined
  }
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [],
    results, query: url, cached: false, explanation,
  } satisfies SearchResponse)
```

- [ ] **Step 8: Type-check and run the full suite**

Run: `npx tsc --noEmit && npx jest`
Expected: `tsc` clean; jest green except the 3 known pre-existing Rakuten shipping failures.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/app/api/find-amazon/route.ts src/app/api/find-amazon/route.test.ts src/app/api/enrich-compare/route.ts src/app/api/lookup/route.ts
git commit -m "feat: include price-difference explanation in POST comparison routes"
```

---

## Task 5: Emit the explanation from the SSE stream route

**Files:**
- Modify: `src/app/api/lookup/stream/route.ts` (imports + two emit points)

The explanation is computed after live points are applied (`finalResults`), and also on the cache-hit fast path, so both routes show the sentence. No new test (SSE wiring is verified in-app in Task 6).

- [ ] **Step 1: Add imports**

In `src/app/api/lookup/stream/route.ts`, after line 6 (`import { ProductResult } from '@/lib/types'`) add:

```ts
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { pickWinnerLoser } from '@/lib/price/explain'
```

Note: `refineKeyword` and `semanticMatch` are already imported from `@/lib/llm/openrouter` on line 4 — leave that line unchanged; add the new import as a separate line.

- [ ] **Step 2: Emit the explanation on the cache-hit path**

Replace the cache-hit block (lines 87-93):

```ts
        // Cache hit: stream full results immediately
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          send({ type: 'done' })
          controller.close()
          return
        }
```

with:

```ts
        // Cache hit: stream full results immediately
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          if (cached.length === 2) {
            const { winner, loser } = pickWinnerLoser(cached[0], cached[1])
            const explanation = await explainPriceDifference(winner, loser).catch(() => null)
            if (explanation) send({ type: 'explanation', text: explanation })
          }
          send({ type: 'done' })
          controller.close()
          return
        }
```

- [ ] **Step 3: Emit the explanation on the live path (after the match, before `done`)**

Replace the tail of the `try` block (lines 200-202):

```ts
        if (finalResults.length > 0) await setCached(cacheKey, finalResults).catch(() => {})
        send({ type: 'done' })
        controller.close()
```

with:

```ts
        if (finalResults.length > 0) await setCached(cacheKey, finalResults).catch(() => {})
        if (finalResults.length === 2) {
          const { winner, loser } = pickWinnerLoser(finalResults[0], finalResults[1])
          const explanation = await explainPriceDifference(winner, loser).catch(() => null)
          if (explanation) send({ type: 'explanation', text: explanation })
        }
        send({ type: 'done' })
        controller.close()
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/lookup/stream/route.ts
git commit -m "feat: emit price-difference explanation SSE event after the match"
```

---

## Task 6: Wire the explanation into the results page (state + staleness fallback)

**Files:**
- Modify: `src/app/results/page.tsx` (state, resets, SSE handler, POST handler, render)

- [ ] **Step 1: Add explanation state and reset it on every load**

In `src/app/results/page.tsx`, add the state declaration after line 33 (`const [error, setError] = useState<string | null>(null)`):

```tsx
  const [explanation, setExplanation] = useState<string | null>(null)
```

Then in the `load()` reset block (currently lines 45-46), add `setExplanation(null)`:

```tsx
      setLoading(true); setLoadingMessage('検索中…'); setError(null)
      setPickList([]); setRawResults([]); setAmazonPool([])
      setLivePointsLoading(false); setCrossSearching(false)
      setExplanation(null)
```

- [ ] **Step 2: Handle the `explanation` SSE event (URL-lookup path)**

In the SSE event-type chain for the URL path, first widen the parsed event type to include `text` — change the `as { ... }` annotation (lines 74-80) to add `text?: string`:

```tsx
                const event = JSON.parse(line.slice(6)) as {
                  type: string
                  results?: ProductResult[]
                  result?: ProductResult
                  cached?: boolean
                  message?: string
                  text?: string
                }
```

Then add an `explanation` branch alongside the others. Insert it immediately before the `else if (event.type === 'status')` branch (before line 108):

```tsx
                } else if (event.type === 'explanation') {
                  setExplanation(event.text ?? null)
```

- [ ] **Step 3: Capture the explanation from the POST responses (pick-select path)**

In `handlePickSelect`, reset the explanation at the top, after `setError(null)` (line 208):

```tsx
    setError(null)
    setExplanation(null)
```

Then thread the response field through both branches. Replace the body of the `try` (lines 215-245) with:

```tsx
    try {
      let enrichedSource = selected
      let matchResult: ProductResult | null = null
      let explanationText: string | null = null

      if (selected.platform === 'rakuten') {
        // Rakuten tap: crawl item page for live points, then match Amazon pool
        const res = await fetch('/api/enrich-compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: selected, candidates: amazonPool }),
        })
        const data = await res.json() as { source: ProductResult; result: ProductResult | null; explanation?: string | null }
        enrichedSource = data.source ?? selected
        matchResult = data.result
        explanationText = data.explanation ?? null
      } else {
        // Amazon tap: match against Rakuten pick-list
        const res = await fetch('/api/find-amazon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: selected, candidates: pickList }),
        })
        const data = await res.json() as { result: ProductResult | null; explanation?: string | null }
        matchResult = data.result
        explanationText = data.explanation ?? null
      }

      // User may have navigated back while the API call was in flight — discard stale result
      if (opIdRef.current !== opId) return
      const results = [enrichedSource, ...(matchResult ? [matchResult] : [])]
        .sort((a, b) => a.effectivePrice - b.effectivePrice)
      setRawResults(results)
      setExplanation(explanationText)
      setCrossSearching(false)
```

- [ ] **Step 4: Reset the explanation on Back**

In `handleBack` (lines 254-257), add `setExplanation(null)`:

```tsx
  function handleBack() {
    opIdRef.current++
    setMode('keyword-list'); setRawResults([]); setError(null)
    setExplanation(null)
  }
```

- [ ] **Step 5: Compute the staleness fallback and pass it to `PriceExplanation`**

Replace the `const ranked = recalcWithToggles(rawResults, toggles)` line (line 264) with the ranked computation plus the default-ordering comparison:

```tsx
  const ranked = recalcWithToggles(rawResults, toggles)
  // The bundled sentence reflects DEFAULT toggle settings. If a toggle changes the
  // winner or the gap, the sentence's numbers would be stale → fall back to bullets.
  const defaultRanked = recalcWithToggles(rawResults, DEFAULT_TOGGLES)
  const winnerUnchanged =
    ranked.length === 2 && defaultRanked.length === 2 &&
    ranked[0].affiliateUrl === defaultRanked[0].affiliateUrl
  const defaultGap = defaultRanked.length === 2 ? defaultRanked[1].effectivePrice - defaultRanked[0].effectivePrice : null
  const currentGap = ranked.length === 2 ? ranked[1].effectivePrice - ranked[0].effectivePrice : null
  const showSentence = !!explanation && winnerUnchanged && defaultGap === currentGap
```

Then update the `PriceExplanation` usage (lines 333-335):

```tsx
          {ranked.length === 2 && (
            <PriceExplanation
              winner={ranked[0]}
              loser={ranked[1]}
              explanation={showSentence && explanation ? explanation : undefined}
            />
          )}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/results/page.tsx
git commit -m "feat: render LLM price explanation, fall back to bullets on toggle change"
```

---

## Task 7: In-app verification

**Files:** none (manual runtime verification per the `verify` skill)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (serves on http://localhost:3000). If a server is already running there, reuse it.

- [ ] **Step 2: Verify the URL-lookup path shows the sentence**

Paste a Rakuten or Amazon product URL that has a known equivalent (e.g. a パンパース テープ product) on the home page and submit. On the comparison screen, confirm:
- The blue "💡 …が¥… 安い理由" box shows a single natural-language Japanese **sentence** (not bullets) once the match resolves.
- The cited yen figure in the sentence matches the `¥…安い` figure in the box header.

Capture a screenshot of the comparison screen.

- [ ] **Step 3: Verify the keyword (pick-list) path shows the sentence**

From the home page, run a keyword search (e.g. `パンパース テープ Sサイズ`), tap a Rakuten card, and confirm the same sentence box appears on the comparison screen after the match resolves.

- [ ] **Step 4: Verify the toggle-staleness fallback**

On a comparison screen showing the sentence, open the toggle panel and change a points/card toggle (e.g. enable Rakuten SPU ×10 or Rakuten Card) such that the gap changes. Confirm the box reverts to the **rule-based bullet list** (and back to the sentence when toggles return to defaults).

- [ ] **Step 5: Verify the LLM-failure fallback**

Temporarily unset the LLM key to force `explainPriceDifference` to return null: stop the dev server, run `OPENROUTER_API_KEY= npm run dev`, repeat Step 2, and confirm the box shows the **bullet list** (never blank when there is a price difference). Restore the key afterward.

- [ ] **Step 6: Report**

Record the verdict (PASS/FAIL) with the screenshot and the observed sentence text per the `verify` skill's report format.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-06-09-price-explanation-design.md`):
- LLM-generated sentence → Task 3 ✓
- Bundled, no extra query (POST + SSE) → Tasks 4, 5 ✓
- `src/lib/price/explain.ts` with `computePriceFacts` + `pickWinnerLoser` → Task 1 ✓
- `explainPriceDifference` in `openrouter.ts`, numbers pinned, temp 0, null on failure → Task 3 ✓ (`callLLM` already sets `temperature: 0`)
- Routes `enrich-compare`, `find-amazon`, `lookup` (POST) + `lookup/stream` (SSE) → Tasks 4, 5 ✓
- `PriceExplanation` accepts `explanation`, falls back to bullets → Task 2 ✓
- `results/page.tsx` threads explanation + toggle-staleness fallback → Task 6 ✓
- Types: `explanation?: string` on the response shape + SSE event type → Task 4 (SearchResponse), Task 6 (inline POST/SSE types) ✓
- Caching by product-pair key reusing `lib/cache` → Task 3 ✓
- Testing list (computePriceFacts, pickWinnerLoser, explainPriceDifference mock, one POST route, in-app) → Tasks 1, 3, 4, 7 ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**3. Type consistency:** `pickWinnerLoser` returns `{ winner, loser }` (used identically in Tasks 4, 5). `explainPriceDifference(winner, loser): Promise<string | null>` signature consistent across Tasks 3, 4, 5. `PriceFacts` field names (`winnerPlatform`, `diff`, `diffPct`, `listPriceDiff`, `pointsDelta`, `winnerFreeShipping`, `loserShipping`, `winnerMultiplier`, `loserMultiplier`, `reasons`) consistent between Task 1 (definition) and Task 3 (consumption). SSE event `{ type: 'explanation', text }` consistent between Task 5 (emit) and Task 6 (handle). ✓

**Note on scope:** `src/app/api/lookup/route.ts` (non-stream POST) is not on the current client path (the client uses `/api/lookup/stream`), but the spec lists it and the change is a uniform few lines, so it is included for contract consistency. The 3 pre-existing Rakuten shipping test failures are unrelated and out of scope.
