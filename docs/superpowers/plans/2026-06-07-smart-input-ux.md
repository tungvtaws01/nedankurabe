# Smart Input UX — Keyword Pick-list + URL Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-section search UI with a single smart input that auto-detects URL vs keyword, and replace keyword auto-comparison with a 10-item Rakuten pick-list so users choose the exact product before comparing.

**Architecture:** The existing routing stays intact (`?url=` → `/api/lookup`, `?q=` → `/api/search`). `/api/search` changes from returning a 2-item comparison to a 10-item Rakuten pick-list. A new `/api/find-amazon` endpoint searches Amazon by title after the user picks a Rakuten product. The results page gains a `pickListResults` state that drives the pick-list → comparison transition.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, React `useState`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/types.ts` | Modify | Add `mode` field to `SearchResponse` |
| `src/app/api/search/route.ts` | Modify | Return 10 Rakuten pick-list items + `mode: 'keyword-list'` |
| `src/app/api/find-amazon/route.ts` | Create | Search Amazon by title, return best result or null |
| `src/components/KeywordResultsList.tsx` | Create | 10 tappable Rakuten product cards |
| `src/app/results/page.tsx` | Modify | Handle pick-list + comparison states, back button |
| `src/components/SearchBox.tsx` | Modify | Merge into single smart input with new placeholder |

---

## Task 1: Add `mode` to `SearchResponse`

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Add `mode` field to `SearchResponse`**

Open `src/lib/types.ts` and update `SearchResponse`:

```typescript
export interface SearchResponse {
  results: ProductResult[]
  query: string
  cached: boolean
  mode?: 'keyword-list' | 'comparison'
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/tungvu/work/saas/product-matching && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: add mode field to SearchResponse for keyword-list vs comparison"
```

---

## Task 2: Update `/api/search` to return keyword pick-list

**Files:**
- Modify: `src/app/api/search/route.ts`

- [ ] **Step 1: Replace the route handler body**

Rewrite `src/app/api/search/route.ts` to search Rakuten only (10 results) and return `mode: 'keyword-list'`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { searchRakuten } from '@/lib/platforms/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { query?: string }
    if (!body.query?.trim()) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }
    return NextResponse.json({
      results: MOCK_RESULTS,
      query: body.query.trim(),
      cached: false,
      mode: 'keyword-list',
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw:${query}`)

  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query, cached: true, mode: 'keyword-list' } satisfies SearchResponse)
  }

  const results = await searchRakuten(query).catch(() => [] as ProductResult[])

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query, cached: false, mode: 'keyword-list' } satisfies SearchResponse)
}
```

Note: cache key prefixed with `kw:` to avoid collisions with old comparison-mode cache entries.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: update /api/search to return 10-item Rakuten pick-list"
```

---

## Task 3: Create `/api/find-amazon` endpoint

**Files:**
- Create: `src/app/api/find-amazon/route.ts`

This endpoint takes a Rakuten product title and returns the best Amazon match (or null if Amazon keys are unavailable).

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/find-amazon/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { searchAmazon } from '@/lib/platforms/amazon'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null }>> {
  const body = await req.json() as { title?: string }
  if (!body.title?.trim()) {
    return NextResponse.json({ result: null }, { status: 400 })
  }
  const result = await searchAmazon(body.title.trim())
    .then(items => items[0] ?? null)
    .catch(() => null)
  return NextResponse.json({ result })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/find-amazon/route.ts
git commit -m "feat: add /api/find-amazon endpoint for cross-platform comparison after pick"
```

---

## Task 4: Create `KeywordResultsList` component

**Files:**
- Create: `src/components/KeywordResultsList.tsx`

Renders up to 10 tappable Rakuten product cards. Tapping immediately calls `onSelect`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/KeywordResultsList.tsx
import { ProductResult } from '@/lib/types'

interface Props {
  results: ProductResult[]
  query: string
  onSelect: (result: ProductResult) => void
}

export default function KeywordResultsList({ results, query, onSelect }: Props) {
  return (
    <div>
      <p className="text-[10px] text-[var(--ink-soft)] mb-3">
        「{query}」の検索結果{' '}
        <span className="italic">— 比較したい商品を選んでください / Select a product to compare</span>
      </p>

      {results.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}

      <div className="space-y-2">
        {results.map((r) => (
          <button
            key={r.affiliateUrl}
            onClick={() => onSelect(r)}
            className="w-full text-left bg-white border-2 border-[var(--border)] rounded-2xl p-3 flex gap-3 items-center hover:border-[var(--ink)] transition-colors active:bg-[var(--cream)]"
          >
            {r.imageUrl && (
              <img
                src={r.imageUrl}
                alt={r.title}
                className="w-14 h-14 object-contain rounded-lg border border-[var(--border)] shrink-0 bg-white"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-snug line-clamp-3 mb-0.5">{r.title}</p>
              <p className="text-[10px] text-[var(--ink-soft)]">{r.shopName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-black text-[var(--red)]">¥{r.salePrice.toLocaleString()}</p>
              {r.shippingCost === 0 && (
                <p className="text-[9px] text-green-600">送料無料</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/KeywordResultsList.tsx
git commit -m "feat: add KeywordResultsList component for keyword search pick-list"
```

---

## Task 5: Update `results/page.tsx` for pick-list + comparison states

**Files:**
- Modify: `src/app/results/page.tsx`

Adds pick-list state, handles card tap → Amazon search → comparison, and shows a back button.

- [ ] **Step 1: Rewrite `ResultsContent`**

Replace the full contents of `src/app/results/page.tsx` with:

```tsx
'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { ProductResult, UserToggles, DEFAULT_TOGGLES, SearchResponse } from '@/lib/types'
import { recalcWithToggles } from '@/lib/price/normalize'
import ProductCard from '@/components/ProductCard'
import TogglePanel from '@/components/TogglePanel'
import KeywordResultsList from '@/components/KeywordResultsList'

function loadToggles(): UserToggles {
  if (typeof window === 'undefined') return DEFAULT_TOGGLES
  try { return JSON.parse(localStorage.getItem('nedankurabe_toggles') ?? 'null') ?? DEFAULT_TOGGLES }
  catch { return DEFAULT_TOGGLES }
}

function ResultsContent() {
  const params = useSearchParams()
  const router = useRouter()
  const query = params.get('q')
  const url = params.get('url')

  const [pickList, setPickList] = useState<ProductResult[]>([])
  const [rawResults, setRawResults] = useState<ProductResult[]>([])
  const [mode, setMode] = useState<'keyword-list' | 'comparison' | null>(null)
  const [toggles, setToggles] = useState<UserToggles>(DEFAULT_TOGGLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setToggles(loadToggles()) }, [])

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null); setPickList([]); setRawResults([])
      try {
        const [endpoint, body] = url
          ? ['/api/lookup', { url }]
          : ['/api/search', { query }]
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json() as SearchResponse & { error?: string }
        if (!res.ok) { setError(data.error ?? '検索中にエラーが発生しました。'); return }
        if (data.mode === 'keyword-list') {
          setPickList(data.results ?? [])
          setMode('keyword-list')
        } else {
          setRawResults(data.results ?? [])
          setMode('comparison')
        }
      } catch {
        setError('検索中にエラーが発生しました。もう一度お試しください。')
      } finally {
        setLoading(false)
      }
    }
    if (query || url) load()
  }, [query, url])

  async function handlePickSelect(selected: ProductResult) {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/find-amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: selected.title }),
      })
      const data = await res.json() as { result: ProductResult | null }
      const results = [selected, ...(data.result ? [data.result] : [])]
        .sort((a, b) => a.effectivePrice - b.effectivePrice)
      setRawResults(results)
      setMode('comparison')
    } catch {
      setError('比較中にエラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setMode('keyword-list')
    setRawResults([])
    setError(null)
  }

  function handleToggles(t: UserToggles) {
    setToggles(t)
    localStorage.setItem('nedankurabe_toggles', JSON.stringify(t))
  }

  const ranked = recalcWithToggles(rawResults, toggles)

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--border)]">
        <button
          onClick={mode === 'comparison' && pickList.length > 0 ? handleBack : () => router.push('/')}
          className="w-8 h-8 bg-white border border-[var(--border)] rounded-lg flex items-center justify-center text-sm shrink-0"
        >
          ←
        </button>
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--ink-soft)]">
            {mode === 'comparison' && pickList.length > 0
              ? '← 検索結果に戻る Return to results'
              : '検索ワード Search'}
          </p>
          <p className="text-sm font-bold truncate">{query ?? url}</p>
        </div>
      </div>

      {loading && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          検索中… <span className="italic">Searching...</span>
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && mode === 'keyword-list' && (
        <KeywordResultsList
          results={pickList}
          query={query ?? ''}
          onSelect={handlePickSelect}
        />
      )}

      {!loading && !error && mode === 'comparison' && ranked.length > 0 && (
        <>
          <TogglePanel
            toggles={toggles}
            onChange={handleToggles}
            amazonSubscribeAvailable={rawResults.some(r => r.platform === 'amazon' && r.subscribeAvailable)}
            rakutenSubscribeAvailable={rawResults.some(r => r.platform === 'rakuten' && r.subscribeAvailable)}
          />
          {ranked.map((r, i) => (
            <ProductCard key={r.affiliateUrl} result={r} isWinner={i === 0} toggles={toggles} />
          ))}
          <p className="text-center text-[9px] text-[var(--ink-soft)] mt-4 leading-relaxed">
            ※ 価格・ポイントは取得時点のものです<br />
            <span className="italic">
              Prices and points are as of retrieval time. Verify on each site before purchasing.
            </span>
          </p>
        </>
      )}

      {!loading && !error && mode === 'comparison' && ranked.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}
    </main>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="text-center py-20 text-sm text-[var(--ink-soft)]">読み込み中…</p>}>
      <ResultsContent />
    </Suspense>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/results/page.tsx
git commit -m "feat: update results page for keyword pick-list and back navigation"
```

---

## Task 6: Update `SearchBox` to single smart input

**Files:**
- Modify: `src/components/SearchBox.tsx`

Merges keyword input and URL paste hint into one input. Auto-detection logic already exists (`URL_RE`) — only the UI changes.

- [ ] **Step 1: Rewrite the component**

Replace the full contents of `src/components/SearchBox.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const POPULAR = ['パンパース テープ', '明治ほほえみ', 'エルゴ抱っこ紐', 'おしりふき', 'ベビーカー']
const URL_RE = /^https?:\/\/(www\.amazon\.co\.jp|item\.rakuten\.co\.jp)/

export default function SearchBox() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function navigate(value: string) {
    const v = value.trim()
    if (!v) return
    setLoading(true)
    if (URL_RE.test(v)) {
      router.push(`/results?url=${encodeURIComponent(v)}`)
    } else {
      router.push(`/results?q=${encodeURIComponent(v)}`)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-[var(--border)]">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && navigate(input)}
            placeholder="Amazon/楽天のURL、または商品名（例：パンパース Sサイズ）を入力"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--cream)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]"
          />
          <button
            onClick={() => navigate(input)}
            disabled={loading || !input.trim()}
            className="bg-[var(--ink)] text-white rounded-xl px-4 py-2.5 text-sm font-bold whitespace-nowrap disabled:opacity-40"
          >
            {loading ? '...' : '比較'}
          </button>
        </div>
        <p className="text-[10px] text-[var(--ink-soft)] text-center">
          URLを貼り付けるか、商品名で検索できます{' '}
          <span className="italic">Paste a URL or search by product name</span>
        </p>
      </div>

      <div className="mt-5">
        <p className="text-xs text-[var(--ink-soft)] mb-2">
          よく検索されています <span className="italic">Popular searches</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map(tag => (
            <button key={tag} onClick={() => navigate(tag)}
              className="bg-white border border-[var(--border)] rounded-full px-3 py-1 text-xs text-[var(--ink-mid)] hover:bg-[var(--cream)]">
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <div className="flex-1 bg-[var(--amazon)] text-[var(--amazon-accent)] rounded-lg py-2 text-center text-xs font-bold">Amazon JP</div>
        <div className="flex-1 bg-[var(--red)] text-white rounded-lg py-2 text-center text-xs font-bold">楽天市場 Rakuten</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Run the dev server and manually test both flows**

```bash
npm run dev
```

Open `http://localhost:3000`:
- Type `パンパース Sサイズ` → hit 比較 → should show pick-list of 10 cards
- Paste `https://www.amazon.co.jp/dp/B07XYZABC` → hit 比較 → should go directly to comparison view
- On pick-list: tap a card → loading → comparison view
- On comparison: tap ← → returns to pick-list (instant, no reload)
- Popular tag `パンパース テープ` → pick-list

- [ ] **Step 4: Commit**

```bash
git add src/components/SearchBox.tsx
git commit -m "feat: merge search UI into single smart input with keyword hint"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Single smart input with placeholder hint in the box
- ✅ Sub-hint below input
- ✅ URL auto-detection → existing flow
- ✅ Keyword → 10-item Rakuten pick-list
- ✅ Tappable cards (image, title, shop, price)
- ✅ Tap → Amazon search → comparison view
- ✅ Back button returns to pick-list instantly (state preserved)
- ✅ Existing filters applied (inside `searchRakuten`)
- ✅ Amazon-absent gracefully handled (just Rakuten card shown)

**Placeholder scan:** No TBDs or TODOs.

**Type consistency:**
- `SearchResponse.mode` added in Task 1, used in Tasks 2 and 5 ✅
- `KeywordResultsList` props `{ results, query, onSelect }` defined in Task 4, consumed in Task 5 ✅
- `/api/find-amazon` returns `{ result: ProductResult | null }`, consumed in Task 5 `handlePickSelect` ✅
