# Smart Input UX — Keyword Search + URL Paste

**Date:** 2026-06-07  
**Status:** Approved

## Problem

The app currently supports only URL paste (Amazon/Rakuten link → compare prices). Users who don't have a product URL yet — they only know what they want to buy — have no entry point. Keyword search was considered but rejected as a raw list of results because it returns too many irrelevant products when auto-selecting the cheapest.

## Solution

A single smart input that serves both user types. URL paste continues to work as before. Keyword input triggers a 10-item pick-list where the user selects the exact product they want, then the full comparison loads.

## User Flows

### Flow A — URL paste (unchanged)
1. User pastes `amazon.co.jp` or `rakuten.co.jp` URL
2. App detects URL → existing lookup + cross-platform search
3. Comparison view loads directly

### Flow B — Keyword search (new)
1. User types keyword (e.g. `パンパース Sサイズ`)
2. App detects non-URL text → searches Rakuten with keyword
3. Pick-list shows up to 10 tappable product cards
4. User taps one card → app searches Amazon with selected product title
5. Comparison view loads (same layout as Flow A)
6. Back button returns to pick-list instantly (no re-fetch)

## Input Area

**Placeholder text:**
> `Amazon/楽天のURL、または商品名（例：パンパース Sサイズ）を入力`

**Sub-hint below input:**
> `URLを貼り付けるか、商品名で検索できます`

**Auto-detection logic:**
- Try `new URL(input)` — if hostname includes `amazon.co.jp` or `rakuten.co.jp` → Flow A
- Otherwise → Flow B

## Keyword Results (Pick-list)

- Source: `searchRakuten(keyword)` — existing function, `hits=10`
- Existing filters applied: `isTrialOrSamplePack()`, spare parts exclusions
- Display: tappable cards, each showing product image, title (3-line clamp), shop name, price
- Tapping a card highlights it and immediately triggers comparison (no separate button)
- If fewer than 10 clean results exist, show however many pass the filter

## Comparison View

- Triggered by: card tap (keyword flow) or URL submit (URL flow)
- Layout: identical in both flows — winner badge, price breakdown, buy buttons
- Back button: `← 検索結果に戻る` — visible only in keyword flow, returns to pick-list
- Pick-list kept in React state — back navigation is instant, no re-fetch

## Backend Changes

- `POST /api/lookup` currently requires a URL. Extend to accept plain-text keyword.
- New branch in route handler: if `parsed === null` and input is not a URL → treat as keyword, call `searchRakuten(input)`, return array of up to 10 results
- Response shape: add `mode: 'keyword-list' | 'comparison'` field so the frontend knows which view to render

## Frontend Changes

- `SearchForm` — update placeholder and sub-hint text
- New `KeywordResultsList` component — renders the 10 tappable cards
- `page.tsx` — add `pickListResults` state; on card tap, call comparison with selected title
- Back button in comparison view — visible when `pickListResults` is non-empty

## Out of Scope

- Keyword search for Amazon (PA-API search) — added later when affiliate keys are available
- Saving/bookmarking pick-list results
- Pagination beyond 10 results
