# Crawler + LLM Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Rakuten Search API and Amazon PA-API with direct page crawling to get real prices, actual points (including SuperDEAL), and coupons; add OpenRouter LLM for keyword refinement and cross-platform semantic matching.

**Architecture:** Two new crawlers (`src/lib/crawlers/rakuten.ts`, `src/lib/crawlers/amazon.ts`) fetch and parse HTML using `node-html-parser`. An OpenRouter LLM client (`src/lib/llm/openrouter.ts`) provides keyword refinement and semantic matching. Routes are updated to orchestrate crawlers + LLM; the frontend holds both platform result sets in state to avoid a second crawl when the user taps a card.

**Tech Stack:** Next.js 16 App Router, TypeScript, `node-html-parser`, OpenRouter API (fetch-based, OpenAI-compatible)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/llm/openrouter.ts` | Create | `refineKeyword()` + `semanticMatch()` via OpenRouter |
| `src/lib/crawlers/rakuten.ts` | Create | `crawlRakutenSearch()` + `crawlRakutenProduct()` |
| `src/lib/crawlers/amazon.ts` | Create | `crawlAmazonSearch()` + `crawlAmazonProduct()` |
| `src/lib/types.ts` | Modify | Add `rakutenResults`, `amazonResults` to `SearchResponse` |
| `src/lib/matching/llm-match.ts` | Modify | Replace Anthropic client with OpenRouter client |
| `src/app/api/search/route.ts` | Modify | Parallel crawl both platforms, return both result sets |
| `src/app/api/lookup/route.ts` | Modify | Crawl product pages, LLM refine → crawl other platform → pick-list |
| `src/app/api/find-amazon/route.ts` | Modify | LLM semantic match only (crawl already done by search route) |
| `src/app/results/page.tsx` | Modify | Hold `amazonResults` in state; pass to comparison without re-fetch |

---

## Task 1: Install `node-html-parser`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
cd /Users/tungvu/work/saas/product-matching && npm install node-html-parser
```

Expected: `node-html-parser` appears in `dependencies` in `package.json`.

- [ ] **Step 2: Verify TypeScript types are available**

```bash
npx tsc --noEmit 2>&1 | head -5
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add node-html-parser for page crawling"
```

---

## Task 2: OpenRouter LLM client

**Files:**
- Create: `src/lib/llm/openrouter.ts`
- Create: `src/lib/llm/openrouter.test.ts`

**Env vars needed (add to Vercel + local `.env.local`):**
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

- [ ] **Step 1: Write the failing tests**

Create `src/lib/llm/openrouter.test.ts`:

```typescript
const mockFetch = jest.fn()
global.fetch = mockFetch

import { refineKeyword, semanticMatch } from './openrouter'
import { ProductResult } from '@/lib/types'

const mockProduct = (title: string, price: number): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: price,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: price, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => {
  mockFetch.mockReset()
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.OPENROUTER_MODEL = 'test-model'
})

describe('refineKeyword', () => {
  it('returns LLM response text trimmed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'パンパース テープ Sサイズ' } }] }),
    })
    const result = await refineKeyword('【期間限定】パンパース はじめての肌 テープ S 108枚 送料無料', 'amazon')
    expect(result).toBe('パンパース テープ Sサイズ')
  })

  it('falls back to bracket-stripped title when LLM fails', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const result = await refineKeyword('【送料無料】パンパース テープ Sサイズ 108枚', 'amazon')
    expect(result).toBe('パンパース テープ Sサイズ 108枚')
  })
})

describe('semanticMatch', () => {
  it('returns candidate index from LLM response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"match":1}' } }] }),
    })
    const source = mockProduct('パンパース テープ S 108枚', 3980)
    const candidates = [
      mockProduct('GOO.N テープ S 90枚', 2980),
      mockProduct('パンパース はじめての肌 テープ Sサイズ 108枚', 3800),
    ]
    const idx = await semanticMatch(source, candidates)
    expect(idx).toBe(1)
  })

  it('returns null when LLM says no match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"match":null}' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBeNull()
  })

  it('falls back to 0 when LLM response is invalid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBe(0)
  })

  it('returns null when candidates is empty', async () => {
    const idx = await semanticMatch(mockProduct('A', 100), [])
    expect(idx).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/tungvu/work/saas/product-matching && npm test -- --testPathPattern=openrouter 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './openrouter'`

- [ ] **Step 3: Create `src/lib/llm/openrouter.ts`**

```typescript
import { ProductResult } from '@/lib/types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function callLLM(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://nedankurabe.vercel.app',
      'X-Title': 'ねだんくらべ',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free',
      messages,
      max_tokens: 128,
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
): Promise<string> {
  try {
    const result = await callLLM([{
      role: 'user',
      content: `Extract a clean, concise Japanese search keyword from this product title for searching on ${targetPlatform} Japan.\nKeep: brand name, product type, size/variant (Sサイズ, 108枚, etc.).\nRemove: promotional text (【送料無料】, pt倍, 期間限定, etc.), shop names, punctuation noise.\nReturn ONLY the keyword, no explanation.\nTitle: ${title}`,
    }])
    return result || stripBrackets(title)
  } catch {
    return stripBrackets(title)
  }
}

export async function semanticMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<number | null> {
  if (!candidates.length) return null
  try {
    const candidateList = candidates
      .map((c, i) => `${i}: ${c.title} ¥${c.salePrice.toLocaleString()}`)
      .join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `You are matching products across Japanese e-commerce platforms.\nSource: ${source.title} ¥${source.salePrice.toLocaleString()}\nCandidates:\n${candidateList}\n\nWhich candidate is the SAME product (same brand, type, size/count)?\nAccessories, replacement parts, and different sizes are NOT a match.\nReturn JSON only: {"match": 0} or {"match": null}`,
    }])
    const parsed = JSON.parse(result) as { match: number | null }
    if (parsed.match === null || parsed.match === undefined) return null
    if (!candidates[parsed.match]) return 0
    return parsed.match
  } catch {
    return 0
  }
}

function stripBrackets(title: string): string {
  return title.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --testPathPattern=openrouter 2>&1 | tail -8
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat: add OpenRouter LLM client with refineKeyword and semanticMatch"
```

---

## Task 3: Rakuten search page crawler

**Files:**
- Create: `src/lib/crawlers/rakuten.ts`
- Create: `src/lib/crawlers/rakuten.test.ts`

- [ ] **Step 1: Write the failing test with sample HTML**

Create `src/lib/crawlers/rakuten.test.ts`:

```typescript
const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlRakutenSearch, crawlRakutenProduct } from './rakuten'

const SEARCH_HTML = `
<html><body>
<div class="searchresultitem">
  <h2 class="title"><a href="https://item.rakuten.co.jp/netbaby/4902705129566/">明治ほほえみ 780g×2缶入</a></h2>
  <img src="https://thumbnail.image.rakuten.co.jp/img.jpg" />
  <span class="important">5,979</span>
  <span class="free-delivery">送料無料</span>
  <span class="point"><strong>553</strong>ポイント</span>
</div>
<div class="searchresultitem">
  <h2 class="title"><a href="https://item.rakuten.co.jp/shop/item2/">パンパース テープ Sサイズ 108枚</a></h2>
  <img src="https://thumbnail.image.rakuten.co.jp/img2.jpg" />
  <span class="important">3,980</span>
  <span class="point"><strong>36</strong>ポイント</span>
</div>
</body></html>
`

const ITEM_HTML = `
<html><body>
  <h1 itemprop="name">明治ほほえみ(780g×2缶入)</h1>
  <span itemprop="price" content="5979">5,979</span>
  <img id="rakutenLogo" /><img src="https://thumbnail.image.rakuten.co.jp/item.jpg" />
  <div id="point"><strong>553</strong>ポイント</div>
  <span id="free-deliver">送料無料</span>
</body></html>
`

beforeEach(() => {
  mockFetch.mockReset()
})

describe('crawlRakutenSearch', () => {
  it('extracts title, price, points, shipping from search page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('明治ほほえみ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('明治ほほえみ 780g×2缶入')
    expect(results[0].salePrice).toBe(5979)
    expect(results[0].pointsEarned).toBe(553)
    expect(results[0].shippingCost).toBe(0)
    expect(results[0].effectivePrice).toBe(5979 - 553)
    expect(results[0].platform).toBe('rakuten')
  })

  it('charges 490 shipping when free-delivery absent', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('パンパース')
    expect(results[1].shippingCost).toBe(490)
    expect(results[1].effectivePrice).toBe(3980 + 490 - 36)
  })

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const results = await crawlRakutenSearch('test')
    expect(results).toEqual([])
  })

  it('returns empty array when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => '' })
    const results = await crawlRakutenSearch('test')
    expect(results).toEqual([])
  })
})

describe('crawlRakutenProduct', () => {
  it('extracts title, price, points from item page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => ITEM_HTML })
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/netbaby/4902705129566/')
    expect(result).not.toBeNull()
    expect(result!.title).toBe('明治ほほえみ(780g×2缶入)')
    expect(result!.salePrice).toBe(5979)
    expect(result!.pointsEarned).toBe(553)
    expect(result!.shippingCost).toBe(0)
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/x/y/')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=crawlers/rakuten 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './rakuten'`

- [ ] **Step 3: Create `src/lib/crawlers/rakuten.ts`**

```typescript
import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'
import { FOOD_GENRE_IDS } from '@/lib/platforms/rakuten'

const HEADERS = {
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function parsePoints(el: ReturnType<typeof parse> | null): number {
  if (!el) return 0
  const text = el.querySelector('strong')?.text ?? el.text
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function parsePrice(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function isFreeShipping(card: ReturnType<typeof parse>): boolean {
  return !!card.querySelector('.free-delivery, .shipping_free, [class*="freeShip"]')
}

function guessAffiliateUrl(itemUrl: string): string {
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID
  if (!affiliateId) return itemUrl
  return `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
}

function inferTaxRate(title: string): 1.08 | 1.1 {
  const foodKeywords = /粉ミルク|液体ミルク|ミルク.*缶|離乳食|ベビーフード|ハイハイン|おかゆ/
  return foodKeywords.test(title) ? 1.08 : 1.1
}

function buildResult(
  title: string,
  salePrice: number,
  pointsEarned: number,
  shippingCost: number,
  couponDiscount: number,
  imageUrl: string,
  itemUrl: string,
  shopName: string,
): ProductResult {
  const taxRate = inferTaxRate(title)
  return {
    platform: 'rakuten',
    title,
    imageUrl,
    shopName,
    salePrice,
    shippingCost,
    couponDiscount,
    pointRate: 1,
    pointsEarned,
    effectivePrice: salePrice + shippingCost - couponDiscount - pointsEarned,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    taxRate,
    affiliateUrl: guessAffiliateUrl(itemUrl),
  }
}

export async function crawlRakutenSearch(keyword: string): Promise<ProductResult[]> {
  const encoded = encodeURIComponent(keyword)
  try {
    const res = await fetch(
      `https://search.rakuten.co.jp/search/mall/${encoded}/`,
      { headers: HEADERS },
    )
    if (!res.ok) return []
    const html = await res.text()
    const root = parse(html)
    const cards = root.querySelectorAll('.searchresultitem')
    const results: ProductResult[] = []

    for (const card of cards.slice(0, 10)) {
      const anchor = card.querySelector('h2.title a, .item-name a, h2 a')
      const title = anchor?.text.trim() ?? ''
      const itemUrl = anchor?.getAttribute('href') ?? ''
      if (!title || !itemUrl) continue

      const priceText = card.querySelector('.important, [class*="price"]')?.text ?? '0'
      const salePrice = parsePrice(priceText)
      if (!salePrice) continue

      const pointsEarned = parsePoints(card.querySelector('.point, [class*="point"]'))
      const shippingCost = isFreeShipping(card) ? 0 : 490
      const imageUrl = card.querySelector('img')?.getAttribute('src') ?? ''

      // extract shop name from URL: item.rakuten.co.jp/{shop}/...
      const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
      const shopName = shopMatch?.[1] ?? ''

      results.push(buildResult(title, salePrice, pointsEarned, shippingCost, 0, imageUrl, itemUrl, shopName))
    }
    return results
  } catch {
    return []
  }
}

export async function crawlRakutenProduct(itemUrl: string): Promise<ProductResult | null> {
  try {
    const res = await fetch(itemUrl, { headers: HEADERS })
    if (!res.ok) return null
    const html = await res.text()
    const root = parse(html)

    const title = root.querySelector('h1[itemprop="name"], #item-title, .item_name')?.text.trim() ?? ''
    if (!title) return null

    const priceAttr = root.querySelector('[itemprop="price"]')?.getAttribute('content')
    const priceText = root.querySelector('[itemprop="price"], .price2, .important')?.text ?? '0'
    const salePrice = priceAttr ? parseInt(priceAttr, 10) : parsePrice(priceText)
    if (!salePrice) return null

    const pointsEarned = parsePoints(root.querySelector('#point, .item_point, [class*="point"]'))
    const shippingCost = root.querySelector('#free-deliver, .free-delivery, [class*="freeShip"]') ? 0 : 490
    const imageUrl = root.querySelector('#rakutenLogo ~ img, #imageMain img, #item_image img')?.getAttribute('src') ?? ''

    const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
    const shopName = shopMatch?.[1] ?? ''

    return buildResult(title, salePrice, pointsEarned, shippingCost, 0, imageUrl, itemUrl, shopName)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Export `FOOD_GENRE_IDS` from rakuten.ts so it can be imported**

Open `src/lib/platforms/rakuten.ts` and change:

```typescript
// Change this line (currently const, not exported):
const FOOD_GENRE_IDS = new Set(["401171", "568293", "213980", "204417"]);
```

To:

```typescript
export const FOOD_GENRE_IDS = new Set(["401171", "568293", "213980", "204417"]);
```

Note: `crawlRakutenSearch` above uses `inferTaxRate` by keyword instead of genreId (since crawled results don't include genreId). The `FOOD_GENRE_IDS` export is for future use; you can remove the import from `crawlers/rakuten.ts` if unused.

- [ ] **Step 5: Run tests**

```bash
npm test -- --testPathPattern=crawlers/rakuten 2>&1 | tail -10
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crawlers/rakuten.ts src/lib/crawlers/rakuten.test.ts src/lib/platforms/rakuten.ts
git commit -m "feat: add Rakuten page crawler (search + item page)"
```

---

## Task 4: Amazon crawler

**Files:**
- Create: `src/lib/crawlers/amazon.ts`
- Create: `src/lib/crawlers/amazon.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/crawlers/amazon.test.ts`:

```typescript
const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlAmazonSearch, crawlAmazonProduct } from './amazon'

const SEARCH_HTML = `
<html><body>
<div data-asin="B09XYZ1111" data-component-type="s-search-result">
  <h2><a><span>パンパース テープ はじめての肌 Sサイズ 108枚</span></a></h2>
  <img class="s-image" src="https://m.media-amazon.com/img1.jpg" />
  <span class="a-price"><span class="a-price-whole">3,980</span></span>
  <span class="a-size-base a-color-price">40 pt</span>
</div>
<div data-asin="B09XYZ2222" data-component-type="s-search-result">
  <h2><a><span>メリーズ テープ Mサイズ 64枚</span></a></h2>
  <img class="s-image" src="https://m.media-amazon.com/img2.jpg" />
  <span class="a-price"><span class="a-price-whole">1,580</span></span>
  <span class="a-size-base a-color-price">送料無料</span>
</div>
</body></html>
`

const PRODUCT_HTML = `
<html><body>
  <span id="productTitle">パンパース テープ はじめての肌 Sサイズ 108枚</span>
  <img id="landingImage" src="https://m.media-amazon.com/img.jpg" />
  <span class="a-price-whole">3,980</span>
  <span class="a-size-base a-color-price">40 pt</span>
</body></html>
`

beforeEach(() => {
  mockFetch.mockReset()
  process.env.AMAZON_PARTNER_TAG = ''
})

describe('crawlAmazonSearch', () => {
  it('extracts title, price, ASIN from search page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlAmazonSearch('パンパース テープ Sサイズ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('パンパース テープ はじめての肌 Sサイズ 108枚')
    expect(results[0].salePrice).toBe(3980)
    expect(results[0].pointsEarned).toBe(40)
    expect(results[0].platform).toBe('amazon')
    expect(results[0].affiliateUrl).toContain('B09XYZ1111')
  })

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await crawlAmazonSearch('test')).toEqual([])
  })

  it('returns empty array when response not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => '' })
    expect(await crawlAmazonSearch('test')).toEqual([])
  })
})

describe('crawlAmazonProduct', () => {
  it('extracts title, price, points from product page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => PRODUCT_HTML })
    const result = await crawlAmazonProduct('B09XYZ1111')
    expect(result).not.toBeNull()
    expect(result!.title).toBe('パンパース テープ はじめての肌 Sサイズ 108枚')
    expect(result!.salePrice).toBe(3980)
    expect(result!.pointsEarned).toBe(40)
    expect(result!.platform).toBe('amazon')
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await crawlAmazonProduct('BADASIN')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --testPathPattern=crawlers/amazon 2>&1 | tail -5
```

Expected: FAIL — `Cannot find module './amazon'`

- [ ] **Step 3: Create `src/lib/crawlers/amazon.ts`**

```typescript
import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'
import { calcAmazonEffectivePrice } from '@/lib/price/normalize'

const HEADERS = {
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function parsePrice(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function parsePoints(text: string): number {
  const m = text.match(/(\d[\d,]*)\s*pt/i)
  if (!m) return 0
  return parseInt(m[1].replace(/,/g, ''), 10)
}

function buildAmazonUrl(asin: string): string {
  const tag = process.env.AMAZON_PARTNER_TAG
  return tag
    ? `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`
    : `https://www.amazon.co.jp/dp/${asin}`
}

function buildResult(
  title: string,
  salePrice: number,
  pointsEarned: number,
  asin: string,
  imageUrl: string,
): ProductResult {
  return {
    platform: 'amazon',
    title,
    imageUrl,
    shopName: 'Amazon.co.jp',
    salePrice,
    shippingCost: 0,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned,
    effectivePrice: calcAmazonEffectivePrice(salePrice, 0, false, false),
    subscribeAvailable: false,
    rakutenCardEligible: false,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: buildAmazonUrl(asin),
  }
}

export async function crawlAmazonSearch(keyword: string): Promise<ProductResult[]> {
  const encoded = encodeURIComponent(keyword)
  try {
    const res = await fetch(
      `https://www.amazon.co.jp/s?k=${encoded}&i=baby`,
      { headers: HEADERS },
    )
    if (!res.ok) return []
    const html = await res.text()
    const root = parse(html)
    const cards = root.querySelectorAll('[data-asin][data-component-type="s-search-result"]')
    const results: ProductResult[] = []

    for (const card of cards.slice(0, 5)) {
      const asin = card.getAttribute('data-asin') ?? ''
      if (!asin) continue

      const title = card.querySelector('h2 a span, h2 span')?.text.trim() ?? ''
      if (!title) continue

      const priceText = card.querySelector('.a-price-whole')?.text ?? '0'
      const salePrice = parsePrice(priceText)
      if (!salePrice) continue

      const pointText = card.querySelectorAll('.a-size-base.a-color-price')
        .map(el => el.text).join(' ')
      const pointsEarned = parsePoints(pointText)
      const imageUrl = card.querySelector('img.s-image')?.getAttribute('src') ?? ''

      results.push(buildResult(title, salePrice, pointsEarned, asin, imageUrl))
    }
    return results
  } catch {
    return []
  }
}

export async function crawlAmazonProduct(asin: string): Promise<ProductResult | null> {
  try {
    const res = await fetch(
      `https://www.amazon.co.jp/dp/${asin}`,
      { headers: HEADERS },
    )
    if (!res.ok) return null
    const html = await res.text()
    const root = parse(html)

    const title = root.querySelector('#productTitle, #title')?.text.trim() ?? ''
    if (!title) return null

    const priceText = root.querySelector('.a-price-whole, #priceblock_ourprice')?.text ?? '0'
    const salePrice = parsePrice(priceText)
    if (!salePrice) return null

    const pointText = root.querySelectorAll('.a-size-base.a-color-price')
      .map(el => el.text).join(' ')
    const pointsEarned = parsePoints(pointText)
    const imageUrl = root.querySelector('#landingImage, #imgBlkFront')?.getAttribute('src') ?? ''

    return buildResult(title, salePrice, pointsEarned, asin, imageUrl)
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --testPathPattern=crawlers/amazon 2>&1 | tail -10
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run full test suite to confirm no regressions**

```bash
npm test 2>&1 | tail -8
```

Expected: all test suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/crawlers/amazon.ts src/lib/crawlers/amazon.test.ts
git commit -m "feat: add Amazon page crawler (search + product page)"
```

---

## Task 5: Update `SearchResponse` type

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Update `SearchResponse`**

Replace the `SearchResponse` interface in `src/lib/types.ts`:

```typescript
export interface SearchResponse {
  mode: 'keyword-list' | 'comparison'
  // keyword-list mode: both platforms crawled in parallel
  rakutenResults: ProductResult[]
  amazonResults: ProductResult[]
  // comparison mode: URL paste result (single pair)
  results: ProductResult[]
  query: string
  cached: boolean
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word" | head -20
```

Expected: errors only in routes (not yet updated) — that is expected at this step.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat: update SearchResponse to carry both platform result sets"
```

---

## Task 6: Update `/api/search` — parallel crawl both platforms

**Files:**
- Modify: `src/app/api/search/route.ts`

- [ ] **Step 1: Replace route handler**

Rewrite `src/app/api/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { refineKeyword } from '@/lib/llm/openrouter'
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
      amazonResults: MOCK_RESULTS.filter(r => r.platform === 'amazon'),
      results: [],
      query: body.query.trim(),
      cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw2:${query}`)

  const cached = await getCached<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }>(cacheKey).catch(() => null)
  if (cached && cached.rakutenResults.length > 0) {
    return NextResponse.json({
      mode: 'keyword-list', ...cached, results: [], query, cached: true,
    } satisfies SearchResponse)
  }

  // Crawl both platforms in parallel
  const [rakutenResults, amazonKeyword] = await Promise.all([
    crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
    refineKeyword(query, 'amazon').catch(() => query),
  ])
  const amazonResults = await crawlAmazonSearch(amazonKeyword).catch(() => [] as ProductResult[])

  if (rakutenResults.length > 0) {
    await setCached(cacheKey, { rakutenResults, amazonResults }).catch(() => {})
  }

  return NextResponse.json({
    mode: 'keyword-list',
    rakutenResults,
    amazonResults,
    results: [],
    query,
    cached: false,
  } satisfies SearchResponse)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word" | head -20
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts
git commit -m "feat: update /api/search to parallel-crawl Rakuten + Amazon"
```

---

## Task 7: Update `/api/lookup` — both URL paste flows

**Files:**
- Modify: `src/app/api/lookup/route.ts`

- [ ] **Step 1: Rewrite the route**

Replace `src/app/api/lookup/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch, crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { crawlAmazonSearch, crawlAmazonProduct } from '@/lib/crawlers/amazon'
import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: url }
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
  const parsed = parseProductUrl(url)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(`lookup2:${url}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached && cached.length > 0) {
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [],
      results: cached, query: url, cached: true,
    } satisfies SearchResponse)
  }

  let results: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    // Amazon URL → crawl product page → LLM refine → crawl Rakuten pick-list
    const amazonProduct = await crawlAmazonProduct(parsed.id).catch(() => null)
    if (!amazonProduct) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const rakutenKeyword = await refineKeyword(amazonProduct.title, 'rakuten').catch(() => amazonProduct.title)
    const rakutenCandidates = await crawlRakutenSearch(rakutenKeyword).catch(() => [] as ProductResult[])
    const matchIdx = await semanticMatch(amazonProduct, rakutenCandidates).catch(() => 0)
    const rakutenMatch = matchIdx !== null ? rakutenCandidates[matchIdx] ?? null : null
    results = [amazonProduct, ...(rakutenMatch ? [rakutenMatch] : [])].sort((a, b) => a.effectivePrice - b.effectivePrice)

  } else {
    // Rakuten URL → crawl item page → LLM refine → crawl Amazon pick-list
    const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
    if (!rakutenProduct) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonKeyword = await refineKeyword(rakutenProduct.title, 'amazon').catch(() => rakutenProduct.title)
    const amazonCandidates = await crawlAmazonSearch(amazonKeyword).catch(() => [] as ProductResult[])
    const matchIdx = await semanticMatch(rakutenProduct, amazonCandidates).catch(() => 0)
    const amazonMatch = matchIdx !== null ? amazonCandidates[matchIdx] ?? null : null
    results = [rakutenProduct, ...(amazonMatch ? [amazonMatch] : [])].sort((a, b) => a.effectivePrice - b.effectivePrice)
  }

  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [],
    results, query: url, cached: false,
  } satisfies SearchResponse)
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word" | head -10
```

Expected: no errors in this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/lookup/route.ts
git commit -m "feat: update /api/lookup to crawl both Amazon and Rakuten URLs"
```

---

## Task 8: Update `/api/find-amazon` — LLM match only

**Files:**
- Modify: `src/app/api/find-amazon/route.ts`

This route is now called by the frontend when user taps a Rakuten card after keyword search. Amazon results are already in frontend state — the route just does the LLM match.

- [ ] **Step 1: Rewrite the route**

Replace `src/app/api/find-amazon/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { semanticMatch } from '@/lib/llm/openrouter'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null }>> {
  const body = await req.json() as { source?: ProductResult; candidates?: ProductResult[] }
  if (!body.source || !body.candidates?.length) {
    return NextResponse.json({ result: null }, { status: 400 })
  }
  const idx = await semanticMatch(body.source, body.candidates).catch(() => 0)
  const result = idx !== null ? body.candidates[idx] ?? null : null
  return NextResponse.json({ result })
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word" | head -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/find-amazon/route.ts
git commit -m "feat: simplify /api/find-amazon to LLM semantic match only"
```

---

## Task 9: Update `results/page.tsx` — hold both result sets in state

**Files:**
- Modify: `src/app/results/page.tsx`

- [ ] **Step 1: Update the results page**

Replace `src/app/results/page.tsx`:

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
  const [amazonPool, setAmazonPool] = useState<ProductResult[]>([])  // held from keyword search
  const [rawResults, setRawResults] = useState<ProductResult[]>([])
  const [mode, setMode] = useState<'keyword-list' | 'comparison' | null>(null)
  const [toggles, setToggles] = useState<UserToggles>(DEFAULT_TOGGLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setToggles(loadToggles()) }, [])

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null); setPickList([]); setRawResults([]); setAmazonPool([])
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
          setPickList(data.rakutenResults ?? [])
          setAmazonPool(data.amazonResults ?? [])
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
      // Use Amazon pool from state — no re-crawl needed
      const res = await fetch('/api/find-amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: selected, candidates: amazonPool }),
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
    setMode('keyword-list'); setRawResults([]); setError(null)
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
        <KeywordResultsList results={pickList} query={query ?? ''} onSelect={handlePickSelect} />
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
            <span className="italic">Prices and points are as of retrieval time. Verify on each site before purchasing.</span>
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

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word"
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all test suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/results/page.tsx
git commit -m "feat: update results page to use amazonPool state for card tap matching"
```

---

## Task 10: Update `llm-match.ts` — replace Anthropic with OpenRouter

**Files:**
- Modify: `src/lib/matching/llm-match.ts`

The existing `findBestMatch` is still called by the old `/api/lookup` (now replaced in Task 7). This task removes the Anthropic dependency.

- [ ] **Step 1: Rewrite `llm-match.ts`**

Replace `src/lib/matching/llm-match.ts`:

```typescript
import { ProductResult } from '@/lib/types'
import { semanticMatch } from '@/lib/llm/openrouter'

export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<ProductResult | null> {
  if (!candidates.length) return null
  const idx = await semanticMatch(source, candidates).catch(() => 0)
  if (idx === null) return null
  return candidates[idx] ?? null
}
```

- [ ] **Step 2: Remove `@anthropic-ai/sdk` dependency**

```bash
cd /Users/tungvu/work/saas/product-matching && npm uninstall @anthropic-ai/sdk
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -v "Unknown word" | head -10
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected: all test suites pass. The `llm-match.test.ts` mocks `@anthropic-ai/sdk` — update it to mock `@/lib/llm/openrouter` instead if tests fail.

If `llm-match.test.ts` fails, replace its mock with:

```typescript
jest.mock('@/lib/llm/openrouter', () => ({
  semanticMatch: jest.fn(),
}))
import { semanticMatch } from '@/lib/llm/openrouter'
import { findBestMatch } from './llm-match'
// rest of existing test assertions unchanged
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/llm-match.ts package.json package-lock.json
git commit -m "refactor: replace Anthropic SDK with OpenRouter in llm-match"
```

---

## Task 11: Deploy and smoke test

- [ ] **Step 1: Add env vars to Vercel**

```bash
vercel env add OPENROUTER_API_KEY production
vercel env add OPENROUTER_MODEL production
# value: nvidia/nemotron-3-ultra-550b-a55b:free
```

- [ ] **Step 2: Deploy to preview**

```bash
vercel 2>&1 | tail -5
```

- [ ] **Step 3: Smoke test keyword flow**

```bash
curl -s -X POST https://<preview-url>/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"パンパース テープ Sサイズ"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('mode:', d.get('mode'))
print('rakutenResults:', len(d.get('rakutenResults',[])))
print('amazonResults:', len(d.get('amazonResults',[])))
r = d.get('rakutenResults',[{}])[0]
print('first Rakuten:', r.get('title','')[:50], '¥', r.get('effectivePrice'))
"
```

Expected: `mode: keyword-list`, 10 Rakuten results, up to 5 Amazon results, each with real effective prices.

- [ ] **Step 4: Smoke test URL paste (Amazon)**

```bash
curl -s -X POST https://<preview-url>/api/lookup \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.amazon.co.jp/dp/B09XYZ1234"}' | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('mode:', d.get('mode'))
print('results:', len(d.get('results',[])))
"
```

Expected: `mode: comparison`, 1-2 results.

- [ ] **Step 5: Deploy to production**

```bash
vercel --prod 2>&1 | grep -E "Aliased|ready"
```

---

## Self-Review

**Spec coverage:**
- ✅ Rakuten search crawler with real points (`crawlRakutenSearch`)
- ✅ Rakuten item page crawler (`crawlRakutenProduct`)
- ✅ Amazon search crawler (`crawlAmazonSearch`)
- ✅ Amazon product page crawler (`crawlAmazonProduct`)
- ✅ OpenRouter `refineKeyword` + `semanticMatch`
- ✅ Parallel crawl in `/api/search`
- ✅ Amazon URL paste flow in `/api/lookup`
- ✅ Rakuten URL paste flow in `/api/lookup`
- ✅ `/api/find-amazon` uses pre-fetched Amazon pool (no re-crawl)
- ✅ Frontend holds `amazonPool` in state
- ✅ Anthropic SDK removed

**Placeholder scan:** No TBDs. All code complete.

**Type consistency:**
- `SearchResponse.rakutenResults` / `amazonResults` / `results` used consistently across Task 5 → 9 ✅
- `crawlRakutenSearch` returns `ProductResult[]` in Task 3, consumed in Task 6 ✅
- `/api/find-amazon` body `{ source, candidates }` in Task 8, sent by frontend in Task 9 ✅
