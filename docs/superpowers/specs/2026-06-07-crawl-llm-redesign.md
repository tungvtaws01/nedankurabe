# Crawler + LLM Redesign

**Date:** 2026-06-07  
**Status:** Approved

## Problem

The Rakuten Search API returns unreliable `pointRate` data — SuperDEAL campaigns (e.g. 10% back on formula) are missing from the API response even when active on the website. This causes the effective price shown to users to be higher than reality, potentially recommending the wrong platform. The Amazon PA-API requires affiliate keys that are not yet available.

## Solution

Replace both the Rakuten Search API and Amazon PA-API with direct page crawling using `fetch` + CSS/JSON-LD parsing (no headless browser). Add an LLM layer via OpenRouter for keyword refinement and cross-platform semantic matching.

## Architecture

### Keyword search flow

```
User types keyword
  → [parallel]:
      crawlRakutenSearch(keyword)
          fetch https://search.rakuten.co.jp/search/mall/{keyword}/
          extract 10 items: title, price, points (actual earned), coupon, shipping, image, URL
          calculate real effectivePrice per item
      llmRefineKeyword(keyword, 'amazon') → clean Amazon keyword
          then: crawlAmazonSearch(amazonKeyword)
              fetch https://www.amazon.co.jp/s?k={amazonKeyword}
              extract top 5 results: title, price, points, shipping, image, ASIN
              calculate real effectivePrice per item
  → return { rakutenResults: [...10], amazonResults: [...5] } to frontend
  → show Rakuten pick-list with effective prices
  → Amazon results held in state (ready for matching when user taps)
```

### User taps Rakuten card (comparison)

```
  → Amazon results already in state (fetched during keyword search)
  → llmSemanticMatch(selectedRakutenProduct, amazonResults) → index | null
  → show comparison [selectedRakutenProduct, matchedAmazonProduct].sort(by effectivePrice)
  → no additional crawl needed
```

### URL paste (Amazon URL)

```
  → crawlAmazonProduct(asin)
      fetch https://www.amazon.co.jp/dp/{asin}
      extract: title, price, points, image
  → llmRefineKeyword(amazonTitle) → clean Rakuten keyword
  → crawlRakutenSearch(rakutenKeyword) → 10 Rakuten results with real effective prices
  → show Rakuten pick-list (same as keyword search pick-list)

User taps Rakuten card from Amazon URL pick-list:
  → selected Rakuten product is the match
  → show comparison [amazonSource, selectedRakutenProduct].sort(by effectivePrice)
```

### URL paste (Rakuten URL)

```
  → crawlRakutenProduct(itemUrl)
      fetch https://item.rakuten.co.jp/{shop}/{itemCode}/
      extract: title, price, points, coupon, shipping, image
  → llmRefineKeyword(rakutenTitle) → clean Amazon keyword
  → crawlAmazonSearch(amazonKeyword)
      fetch https://www.amazon.co.jp/s?k={keyword}
      extract top 5 results: title, price, points, shipping, image, ASIN
      calculate effectivePrice per result
  → show Amazon pick-list (5 tappable cards with effective prices)

User taps Amazon card from Rakuten URL pick-list:
  → selected Amazon product is the match (no LLM matching needed — user chose it)
  → show comparison [rakutenSource, selectedAmazonProduct].sort(by effectivePrice)
```

## New Files

| File | Responsibility |
|---|---|
| `src/lib/crawlers/rakuten.ts` | `crawlRakutenSearch(keyword)` + `crawlRakutenProduct(itemUrl)` |
| `src/lib/crawlers/amazon.ts` | `crawlAmazonSearch(keyword)` + `crawlAmazonProduct(asin)` |
| `src/lib/llm/openrouter.ts` | `refineKeyword(title, platform)` + `semanticMatch(source, candidates)` |

## Modified Files

| File | Change |
|---|---|
| `src/app/api/search/route.ts` | Parallel: `crawlRakutenSearch` + LLM refine → `crawlAmazonSearch`; returns `{ rakutenResults, amazonResults }` |
| `src/app/api/find-amazon/route.ts` | Now only called for URL paste flows — not needed for keyword search (Amazon already fetched) |
| `src/app/results/page.tsx` | Hold `amazonResults` in state from keyword search; pass to `handlePickSelect` for LLM match without re-fetching |
| `src/app/api/lookup/route.ts` | Amazon URL → `crawlAmazonProduct` → LLM refine → `crawlRakutenSearch` → pick-list; Rakuten URL → `crawlRakutenProduct` → LLM refine → `crawlAmazonSearch` → pick-list |
| `src/lib/matching/llm-match.ts` | Replace Anthropic client with OpenRouter |

## Type Change: `SearchResponse`

`/api/search` now returns both result sets so the frontend can hold Amazon results in state without a second fetch:

```typescript
// src/lib/types.ts — updated
export interface SearchResponse {
  rakutenResults: ProductResult[]   // pick-list items (replaces `results`)
  amazonResults: ProductResult[]    // held in state, used when user taps a card
  query: string
  cached: boolean
  mode: 'keyword-list'
}
```

URL paste flows (`/api/lookup`) return the existing single-comparison shape — unchanged.

## Unchanged

`ProductResult` type, `taxRate`, `calcRakutenEffectivePrice`, `recalcWithToggles`, all UI components, toggle logic, `ProductCard`, caching layer.

## Crawlers

### Rakuten search page (`src/lib/crawlers/rakuten.ts`)

**URL:** `https://search.rakuten.co.jp/search/mall/{keyword}/`

**Extraction strategy (JSON-LD first, CSS fallback):**

- **Price:** JSON-LD `ItemList > ListItem > offers.price` → fallback `.important` span
- **Points earned:** `.point` span — this is the actual points (e.g. "553ポイント"), not the rate. Already includes SuperDEAL.
- **SuperDEAL rate:** `.deal-badge` or `[data-deal-rate]` if present → used for display only
- **Coupon:** presence of `.coupon-badge` → extract discount amount if shown
- **Shipping:** presence of `.free-delivery` text → `shippingCost = 0`, else `490`
- **Image:** `img` in result card
- **Title:** `h2` or `.item-name` anchor text
- **Item URL:** `<a href="https://item.rakuten.co.jp/...">` 

**Effective price:** `price - pointsEarned - couponDiscount + shippingCost`  
Points are taken directly from the displayed points value — no formula needed.

**taxRate:** Determined by product category keywords in title (same `FOOD_GENRE_IDS` logic).  
Used only for toggle recalculation on the client; not needed for base effectivePrice since points come from the page.

**Fetch headers:**
```
Accept-Language: ja-JP,ja;q=0.9
Accept: text/html,application/xhtml+xml
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ...
```

### Rakuten item page (`src/lib/crawlers/rakuten.ts`)

**URL:** `https://item.rakuten.co.jp/{shop}/{itemCode}/`

Used only for the Rakuten URL paste flow — fetches a single product's full details.

- **Price:** `span[itemprop="price"]` or `.price2` block
- **Points earned:** `#point` block — actual points shown to buyer (includes SuperDEAL)
- **Coupon:** `.coupon-block` discount amount if present → `couponDiscount`
- **Shipping:** `#free-deliver` text → `shippingCost = 0`, else `490`
- **Image:** `#rakutenLogo ~ img` or `#imageMain img`
- **Title:** `h1[itemprop="name"]`
- **Item URL:** the page URL itself

**Effective price:** same formula as search page — `price - pointsEarned - couponDiscount + shippingCost`

---

### Amazon search page (`src/lib/crawlers/amazon.ts`)

**URL:** `https://www.amazon.co.jp/s?k={keyword}&i=baby`

**Extraction per `[data-asin]` card:**
- **ASIN:** `data-asin` attribute
- **Title:** `h2 a span`
- **Price:** `.a-price-whole` + `.a-price-fraction`
- **Points:** `.a-size-base.a-color-price` containing "pt" → parse integer
- **Shipping:** "送料無料" text → `shippingCost = 0`, else `490`
- **Image:** `img.s-image`
- **URL:** `https://www.amazon.co.jp/dp/{ASIN}?tag={PARTNER_TAG}` if tag set, else bare URL

**Limit:** top 5 results only.

### Amazon product page (`src/lib/crawlers/amazon.ts`)

**URL:** `https://www.amazon.co.jp/dp/{asin}`

**Extraction:**
- **Title:** `#productTitle`
- **Price:** `#priceblock_ourprice` or `.a-price-whole`
- **Points:** `#buybox` `.a-size-base.a-color-price` containing "pt"
- **Image:** `#landingImage[data-old-hires]` or `#imgBlkFront`

## LLM (OpenRouter)

**File:** `src/lib/llm/openrouter.ts`

**Env vars:**
```
OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
```

Model is read from env — swap to `deepseek/deepseek-chat` by changing one variable.

### `refineKeyword(title: string, targetPlatform: 'amazon' | 'rakuten'): Promise<string>`

Strips promotional noise from a product title, returns a clean search keyword.

```
System: You are a Japanese shopping assistant.
User:   Extract a clean, concise search keyword from this product title for searching on {targetPlatform}.
        Keep: brand name, product type, size/variant (Sサイズ, 108枚, etc.)
        Remove: promotional text (【送料無料】, pt倍, 期間限定, etc.), shop names.
        Return ONLY the keyword. No explanation.
        Title: {title}
```

**Fallback:** if LLM fails or returns empty, strip `【...】` brackets and truncate to first 4 words (same as current normalization logic).

### `semanticMatch(source: ProductResult, candidates: ProductResult[]): Promise<number | null>`

Picks the candidate that is the same product as source.

```
System: You are matching products across Japanese e-commerce platforms.
User:   Source: {title} ¥{price}
        Candidates:
          0: {title} ¥{price}
          1: {title} ¥{price}
          ...
        Which candidate is the SAME product (same brand, type, size/count)?
        Accessories, replacement parts, and different sizes are NOT a match.
        Return JSON only: {"match": 0} or {"match": null}
```

**Fallback:** if LLM fails or returns invalid JSON, return `candidates[0]` (first result).

## Error Handling

| Failure | Behavior |
|---|---|
| Rakuten crawler blocked/fails | Return `[]` — show "not found" in pick-list |
| Amazon crawler blocked/fails | Return `null` — show Rakuten-only comparison |
| LLM `refineKeyword` fails | Use raw title stripped of `【...】` brackets |
| LLM `semanticMatch` fails | Use first candidate |
| All fail | Graceful degradation, never 500 to user |

## Out of Scope

- Headless browser / Playwright
- Caching of crawled results (uses existing KV cache layer unchanged)
- Amazon affiliate tag in crawled URLs (added only if `AMAZON_PARTNER_TAG` env is set)
- Scheduled/background crawling
