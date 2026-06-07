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
  → crawlRakutenSearch(keyword)
      fetch https://search.rakuten.co.jp/search/mall/{keyword}/
      extract 10 items: title, price, points (actual earned), coupon, shipping, image, URL
      calculate real effectivePrice per item
  → return pick-list to frontend
```

### User taps Rakuten card (comparison)

```
  → llmRefineKeyword(rakutenTitle) → clean Amazon keyword
      strips promotional noise, keeps brand + product type + size
  → crawlAmazonSearch(amazonKeyword)
      fetch https://www.amazon.co.jp/s?k={keyword}
      extract top 5 results: title, price, points, shipping, image, ASIN
  → llmSemanticMatch(rakutenProduct, amazonCandidates) → index | null
  → return matched Amazon ProductResult | null
```

### URL paste (Amazon URL)

```
  → crawlAmazonProduct(asin)
      fetch https://www.amazon.co.jp/dp/{asin}
      extract: title, price, points, image
  → llmRefineKeyword(amazonTitle) → clean Rakuten keyword
  → crawlRakutenSearch(rakutenKeyword) → 10 Rakuten results with real effective prices
  → llmSemanticMatch(amazonProduct, rakutenCandidates) → index | null
  → return [amazonResult, rakutenMatch].sort(by effectivePrice)
```

## New Files

| File | Responsibility |
|---|---|
| `src/lib/crawlers/rakuten.ts` | Crawl Rakuten search page, return `ProductResult[]` |
| `src/lib/crawlers/amazon.ts` | Crawl Amazon search + product pages, return `ProductResult` / `ProductResult[]` |
| `src/lib/llm/openrouter.ts` | OpenRouter client: `refineKeyword()` + `semanticMatch()` |

## Modified Files

| File | Change |
|---|---|
| `src/app/api/search/route.ts` | Use `crawlRakutenSearch` instead of `searchRakuten` |
| `src/app/api/find-amazon/route.ts` | LLM refine → crawl Amazon → LLM match |
| `src/app/api/lookup/route.ts` | Crawl Amazon product page → LLM refine → crawl Rakuten → LLM match |
| `src/lib/matching/llm-match.ts` | Replace Anthropic client with OpenRouter |

## Unchanged

`ProductResult` type, `taxRate`, `calcRakutenEffectivePrice`, `recalcWithToggles`, all UI components, toggle logic, `KeywordResultsList`, `ProductCard`, caching layer.

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
