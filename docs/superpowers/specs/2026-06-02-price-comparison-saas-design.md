# ねだんくらべ — Design Spec

**Date:** 2026-06-02  
**Status:** Approved  
**Audience:** Parents living in Japan who shop on Amazon JP and Rakuten

---

## Overview

A Japanese-language web app that takes a product URL or keyword and returns the cheapest effective price across Amazon Japan and Rakuten Ichiba. Instead of opening multiple tabs and manually comparing prices, points, and coupons, parents get a single ranked result in seconds.

**Core value proposition:** Show the *effective price* (after coupons and points), not just the list price.

---

## Decisions Made

| Topic | Decision | Reason |
|---|---|---|
| Platforms | Amazon JP + Rakuten only | V1 scope; most popular for baby/child goods in Japan |
| Price metric | Effective price (list − coupon − points at 1× rate) | What parents actually pay |
| Input | URL paste OR keyword search | Flexibility; URL for precision, keyword as fallback |
| Auth | None — fully anonymous | No accounts, fastest to launch |
| Data source | Official APIs + affiliate links | Legal, reliable, monetizes naturally |
| Language | Japanese only | Target audience |
| Architecture | Next.js monolith on Vercel | Single codebase, zero infra, free tier sufficient |

---

## Architecture

**Stack:** Next.js (App Router) + Vercel + Vercel KV (Redis cache)

```
Browser
  └─ POST /api/search  (keyword)
  └─ POST /api/lookup  (URL)
        └─ Platform Adapters (parallel)
              ├─ Amazon PA-API 5.0
              └─ Rakuten Ichiba Item Search API
        └─ Price Normalizer
              └─ effective_price = list_price − coupon − (points × 1.0)
        └─ Vercel KV cache (TTL: 30 min, key: sha256(normalizedInput))
  └─ JSON → React renders ranked results
```

API keys are server-side only (Next.js API Routes / Server Actions) — never exposed to the browser.

---

## Pages

### `/` — Home
- Logo: **ねだんくらべ**
- Primary input: keyword search field + 検索する button
- Secondary input: URL paste hint (separated with "— または —")
- Popular search tags (よく検索されています): common baby product queries
- Platform badges (Amazon JP / 楽天市場) for trust signal
- Static page, no server rendering needed

### `/results?q=<query>` — Results
- Shows **1 best result per platform** (2 cards total: winner + runner-up), ranked by effective price
- Back button + query echo at top
- Winner card (最安値 badge, gold border, full price breakdown table)
- Runner-up card (platform badge, price diff vs winner)
- Price breakdown layout per card:
  ```
  定価        ¥X,XXX
  クーポン割引  −¥XXX
  ポイント還元  −¥XXX
  ──────────────────
  実質価格     ¥X,XXX
  ```
- Affiliate "Buy" button per card (楽天で購入する / Amazonで購入する)
- Legal disclaimer: 価格は取得時点のものです

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
  listPrice: number       // yen
  couponDiscount: number  // yen
  pointsValue: number     // yen equivalent at 1x
  effectivePrice: number  // listPrice - couponDiscount - pointsValue
  affiliateUrl: string
}
```

---

## Price Normalization

```
Amazon:  effectivePrice = listPrice − couponDiscount − primeDiscount
Rakuten: effectivePrice = listPrice − couponDiscount − (points × 1.0)
```

Results sorted ascending by `effectivePrice`. The lowest is the winner.

Rakuten points are treated at **1× face value** (1 point = ¥1). We do not model SPU multipliers — too user-specific and changes frequently.

---

## Product Matching (URL → cross-platform search)

1. Parse platform and product ID from input URL
2. Call source platform API to get full product details (title, JAN/EAN code if available)
3. Search the other platform:
   - **Preferred:** JAN code search (exact match)
   - **Fallback:** Title keyword search (top 3 results returned, ranked by effective price)
4. Return matched results ranked by effective price

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

Winner card: gold border + `#FFFBF0` background + 🏆 最安値 badge  
Amazon card: dark navy border, body white, orange accents

---

## Out of Scope (V1)

- User accounts, login, saved history
- Price drop alerts / notifications
- Yahoo! Shopping, Qoo10, LOHACO, or any platform beyond Amazon + Rakuten
- English UI or i18n
- Mobile app (web only)
- Rakuten SPU multiplier modeling
- Product review aggregation
- Price history charts
