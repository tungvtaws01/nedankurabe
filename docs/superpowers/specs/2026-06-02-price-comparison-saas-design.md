# ねだんくらべ — Design Spec

**Date:** 2026-06-02
**Status:** Approved
**Audience:** Parents living in Japan who shop on Amazon JP and Rakuten

---

## Overview

A Japanese-language web app that takes a product URL or keyword and returns the cheapest effective price across Amazon Japan and Rakuten Ichiba. Instead of opening multiple tabs and manually comparing prices, points, and coupons, parents get a single ranked result in seconds.

**Core value proposition:** Show the *effective price* (after coupons, points, and user-specific discounts), not just the list price.

---

## Decisions Made

| Topic | Decision | Reason |
|---|---|---|
| Platforms | Amazon JP + Rakuten only | V1 scope; most popular for baby/child goods in Japan |
| Price metric | Effective price (list − coupon − points − discounts) | What parents actually pay |
| Input | URL paste OR keyword search | Flexibility; URL for precision, keyword as fallback |
| Auth | None — fully anonymous | No accounts, fastest to launch |
| Data source | Official APIs + affiliate links | Legal, reliable, monetizes naturally |
| Language | Japanese only | Target audience |
| Architecture | Next.js monolith on Vercel | Single codebase, zero infra, free tier sufficient |

---

## Architecture

**Stack:** Next.js (App Router) + Vercel + Vercel KV (Redis cache) + Claude API (Haiku, for product matching)

```
Browser
  └─ POST /api/search  (keyword)
  └─ POST /api/lookup  (URL)
        └─ Platform Adapters (parallel)
              ├─ Amazon PA-API 5.0
              └─ Rakuten Ichiba Item Search API
        └─ Price Normalizer
              └─ effective_price = salePrice − coupon − subscribeDiscount − points
        └─ Vercel KV cache (TTL: 30 min, key: sha256(normalizedInput))
  └─ JSON → React renders ranked results
```

API keys are server-side only (Next.js API Routes) — never exposed to the browser.

---

## Pages

### `/` — Home

- Logo: **ねだんくらべ** *(nedankurabe = "price comparison")*
- Primary input: keyword search field + **検索する** *(Search)* button
- Secondary input: URL paste hint (separated with "— または — / or —")
- Popular search tags (**よく検索されています** / *Popular searches*): common baby product queries
- Platform badges (Amazon JP / **楽天市場** *Rakuten Ichiba*) for trust signal
- Static page, no server rendering needed

### `/results?q=<query>` — Results

- Shows **1 best result per platform** (2 cards total: winner + runner-up), ranked by effective price
- Back button + query echo at top
- Winner card (**最安値** *Cheapest* badge, gold border, full price breakdown table)
- Runner-up card (platform badge, price diff vs winner)
- Price breakdown layout per card:
  ```
  定価 (List price)           ¥X,XXX
  クーポン割引 (Coupon)        −¥XXX
  ポイント還元 (Points earned)  −¥XXX
  ───────────────────────────────────
  実質価格 (Effective price)   ¥X,XXX
  ```
- User toggles panel above results (see Price Normalization section)
- Affiliate "Buy" button per card:
  - **楽天で購入する** *(Buy on Rakuten)*
  - **Amazonで購入する** *(Buy on Amazon)*
- Legal disclaimer: **価格は取得時点のものです** *(Prices are as of retrieval time)*

### `/item/[id]` — Item Detail *(optional, V1 stretch)*

- Deep-linkable side-by-side view of a single matched product pair
- Shareable URL

---

## API Routes

### `POST /api/search`

- **Input:** `{ query: string }` — keyword
- **Action:** Call Amazon PA-API `ItemSearch` + Rakuten Ichiba `IchibaItem/Search` in parallel; normalize; rank by effective price ascending
- **Cache:** Check Vercel KV first; write result on miss
- **Output:** `ProductResult[]`

### `POST /api/lookup`

- **Input:** `{ url: string }` — Amazon or Rakuten product URL
- **Action:** Detect platform from URL → fetch source product (ASIN or item code) → extract title + JAN code → search the *other* platform → normalize + rank
- **Cache:** Same strategy as `/api/search`
- **Output:** `ProductResult[]`

### Shared types

```ts
type ProductResult = {
  platform: 'amazon' | 'rakuten'
  title: string
  imageUrl: string
  shopName: string
  salePrice: number           // displayed price, tax included (yen)
  shippingCost: number        // 送料 (shipping fee); 0 if free
  couponDiscount: number      // yen; 0 if none
  pointRate: number           // Rakuten: API pointRate (e.g. 30 for SuperDEAL, up to 20 for shop campaign); Amazon: always 1
  pointsEarned: number        // pre-calculated at SPU=1x, no toggles; client recalculates on toggle change
  effectivePrice: number      // pre-calculated at 1x, no toggles; client re-ranks on toggle change
  subscribeAvailable: boolean // Amazon: Subscribe & Save eligible; Rakuten: 定期購入 (Teiki) eligible
  rakutenCardEligible?: boolean // Rakuten only: whether Rakuten Card bonus applies (most items: true)
  teikiRates?: {              // Rakuten only; present when subscribeAvailable=true
    first: number             // e.g. 0.10 (10% off first delivery)
    recurring: number         // e.g. 0.05 (5% off recurring)
  }
  affiliateUrl: string
}
```

---

## Price Normalization

Verified by inspecting live product pages on both platforms (June 2026).

### Amazon Japan

```
subscribeDiscount = subscribeSave ? round(salePrice × 0.05) : 0
primePointRate    = isPrime && bulkQty >= 5 ? 3 : 1   // 1% base + 2% Prime bulk bonus
effectivePrice    = salePrice − couponDiscount − subscribeDiscount − round(salePrice × primePointRate / 100)
```

- `salePrice`: the displayed price (tax included). **タイムセール** *(Lightning Deal)* prices are already reflected here — no special handling needed.
- `couponDiscount`: yen value of a clippable coupon badge (green "**〇〇円OFF**" = *"¥XX off"* badge), else 0
- `subscribeDiscount`: applied when Subscribe & Save toggle is on; fixed at **5%** of `salePrice` (observed: ¥6,780 → ¥6,441)
- `primePointRate`: 1% base for everyone; when Prime toggle is on, +2% → total **3%** — labelled "Primeまとめ買い" because Prime Savings requires purchasing 5+ of the same item in one order
- **Excluded (cannot model):** Raku Baby Discount (enrollment required), manufacturer app coupons, AmazonFresh threshold

**User toggles — Amazon**

| Toggle | Label (JP / EN) | Default | Effect |
|---|---|---|---|
| Subscribe & Save | 定期おトク便 *~5% off* | Off | `salePrice × 0.95` |
| Prime bulk savings | Primeまとめ買い *(+2% points, 5+ items)* | Off | Point rate 1% → 3% |

---

### Rakuten Ichiba

```
subscriptionDiscount = teikiEnabled ? round(itemPrice × teikiRate) : 0
rakutenCardBonus     = hasRakutenCard ? 2 : 0          // +2 to point rate (+1× card regular + +1× card special)
taxExcludedPrice     = floor((itemPrice − subscriptionDiscount) / 1.1)
effectivePointRate   = teikiEnabled ? 0 : pointRate + (userSPUMultiplier − 1) + rakutenCardBonus
pointsEarned         = floor(taxExcludedPrice × effectivePointRate / 100)
effectivePrice       = itemPrice − subscriptionDiscount − shippingCost − couponDiscount − pointsEarned
```

- `itemPrice`: displayed price (tax included, **消費税10%前提** = *assumes 10% consumption tax*)
- `shippingCost`: **送料** *(shipping fee)* in yen — returned by the API; 0 if **送料無料** *(free shipping)*. Shops vary from free to ¥490–880. Must be included as it can flip the winner ranking.
- `subscriptionDiscount`: applied when **定期購入** *(Teiki — subscription)* toggle is on. `teikiRate` = 0.10 for first delivery, 0.05 for recurring.
- `rakutenCardBonus`: **+2** added to `effectivePointRate` when 楽天カード *(Rakuten Card)* toggle is on. Breakdown: +1× card regular payment + +1× card special bonus = +2× total. **Note:** 定期購入 suppresses all points, so `rakutenCardBonus` has no effect when `teikiEnabled` is true.
- `pointRate`: returned by Rakuten Ichiba API. For regular items = 1. For SuperDEAL items = the campaign rate (e.g. 30), which **already includes the base 1%** (confirmed from **内訳** *breakdown* popup: "**通常購入分1%が含まれます**" = *"includes the standard 1% purchase points"*). Shop point-up campaigns (**ショップポイントアップ** — observed up to 20×) are also reflected in this field.
- `userSPUMultiplier`: user's SPU level — default 1. Selector adds extra base-rate multiples: 1x→+0%, 3x→+2%, 5x→+4%, 10x→+9%
- `couponDiscount`: shop-issued coupon yen value, else 0
- **Excluded (cannot model):** new card sign-up offers (e.g. "**1,980円で購入可**" = *"can buy for ¥1,980"*), app-only/daily coupons, Super Sale buy-around multiplier

**User toggles — Rakuten**

| Toggle | Label (JP / EN) | Default | Effect |
|---|---|---|---|
| Point multiplier | ポイント倍率 *(SPU level)* | 1x | `effectivePointRate += (multiplier − 1)` |
| Rakuten Card | 楽天カードで支払う *(Pay with Rakuten Card)* | Off | `effectivePointRate += 2` |
| Subscription | 定期購入 *(Teiki subscription)* | Off | Price −10% (first) / −5% (recurring); points = 0 |

All toggles are persisted to `localStorage` and recalculate effective price + re-rank results **client-side** (no new API call).

Results sorted ascending by `effectivePrice`. The lowest is the winner.

---

## Product Matching

Both input flows (URL and keyword) use the same two-step pipeline:

**Step 1 — Candidate retrieval**
- Keyword search: query both Amazon PA-API and Rakuten Ichiba Search API in parallel, retrieve top 5 candidates each
- URL lookup: fetch source product details → use title + JAN code (if available) as query → retrieve top 5 candidates from the other platform

**Step 2 — LLM semantic matching (Claude API)**
- Pass source product + candidate list to Claude with a structured prompt
- Claude selects the best match per platform (or returns `null` if no confident match exists)
- Prompt includes: product title, brand, size/variant, quantity — enough context for confident matching
- Model: `claude-haiku-4-5-20251001` (fast, cheap, sufficient for structured selection tasks)
- Output: structured JSON `{ bestMatch: CandidateItem | null, confidence: 'high' | 'low' }`

**Why LLM over JAN code matching:**
- JAN codes are frequently absent or inconsistent in API responses
- Product titles differ significantly across platforms (Japanese vs English, bundle sizes, seller variants)
- LLM understands semantic equivalence: "パンパース テープ Sサイズ 82枚" = "Pampers tape newborn S 82pcs"

If `confidence === 'low'`, show a "**似た商品**" *(similar product)* label instead of claiming it's the same item.

---

## Caching

- **Store:** Vercel KV (Redis)
- **Key:** `sha256(normalizedInput)` where `normalizedInput` is lowercased, whitespace-trimmed query or canonical URL
- **TTL:** 1800 seconds (30 minutes)
- **Rationale:** Amazon PA-API has strict rate limits and requires affiliate sales activity; caching reduces calls and improves response time for popular queries

---

## Monetization

All "Buy" buttons use affiliate links:
- **Amazon:** Amazon Associates Japan — append `?tag=<associate-id>` to product URL
- **Rakuten:** Rakuten Affiliate — wrap product URL through affiliate redirect

This also satisfies Amazon PA-API's 180-day sales activity requirement (keys get suspended without it).

---

## Design System

**Aesthetic:** Warm Japanese Minimal

| Token | Value |
|---|---|
| Background | `#F7F4EF` (warm cream) |
| Ink | `#1A1A1A` |
| Accent red | `#D0021B` (Japan red) |
| Winner gold | `#E8C840` |
| Amazon navy | `#232F3E` |
| Amazon orange | `#FF9900` |
| Display font | Dela Gothic One |
| Body font | Noto Sans JP |

Winner card: gold border + `#FFFBF0` background + 🏆 **最安値** *(Cheapest)* badge
Amazon card: dark navy border, body white, orange accents

---

## Excluded Price Factors (Deferred)

These factors affect the real price a customer pays but are excluded from V1 because they cannot be modelled without login state, external app access, or real-time campaign data. Noted here for future exploration.

| Factor | Platform | Why excluded | Possible future approach |
|---|---|---|---|
| **Raku Baby Discount** *(らくベビー割引)* | Amazon | Requires prior enrollment; up to ¥10,000 off baby products | Detect eligibility via PA-API offer listing; add as toggle if feasible |
| **Manufacturer app coupons** *(メーカーアプリクーポン)* | Amazon | Issued by brand apps (e.g. Pampers ¥500 off); no API, per-user and opaque | Potentially scraped from brand coupon pages; low priority |
| **AmazonFresh free 2-hour delivery** | Amazon | Requires Prime + ¥10,000 order threshold; separate seller channel | Treat as distinct segment if AmazonFresh coverage grows |
| **Rakuten Card sign-up bonus** *(楽天カード新規入会特典)* | Rakuten | One-time benefit (2,000pt + 3,000pt after 3 uses); not repeatable | Not worth modelling — misleading if shown repeatedly |
| **App-only / daily coupons** *(アプリ限定クーポン)* | Rakuten | Change daily per product; require Rakuten app; not in API | Requires app scraping or a user-submitted coupon input field |
| **Super Sale buy-around multiplier** *(買いまわり)* | Rakuten | Multiplier depends on how many shops user has bought from in the campaign window | Add "shops visited this campaign" input (0–10) during Super Sale periods; detect active campaign via API |
| **Rakuten Mobile / 楽天ひかり SPU bonuses** | Rakuten | Requires Rakuten Mobile or fiber contract; very user-specific | Expand SPU profile if user accounts are added in V2 |
| **3P seller quantity discounts** *(購入数量割引)* | Amazon | Rate varies by seller and quantity; not in PA-API standard fields | Parse from offer listing detail if needed; low priority |

---

## Out of Scope (V1)

- User accounts, login, saved history
- Price drop alerts / notifications
- Yahoo! Shopping, Qoo10, LOHACO, or any platform beyond Amazon + Rakuten
- English UI or i18n
- Mobile app (web only)
- Product review aggregation
- Price history charts
