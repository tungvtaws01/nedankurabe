# LLM price-difference explanation (Japanese)

**Date:** 2026-06-09
**Status:** Approved (design)

## Problem

The comparison screen already shows a rule-based bullet explainer
([`PriceExplanation.tsx`](../../../src/components/PriceExplanation.tsx)) listing why one
platform is cheaper (list-price diff, free shipping, more points, quantity-multiplier
mismatch). The bullets are accurate but terse and mechanical. We want a clearer,
human-readable **natural-language** explanation a parent immediately understands
(e.g. "同じセットです。楽天が今だけ25%OFFなので、¥19,250お得です。").

## Decisions (from brainstorming)

- **Generation:** LLM-generated (not template/hybrid).
- **Delivery:** bundled with the matching result — no separate client query.
  - **Streaming routes** (`lookup/stream`, the keyword flow via `enrich-compare`): emit the
    explanation as a **final SSE event after the match event**, so the match still shows
    first and the explanation follows (option B).
  - **Plain POST routes** that return a comparison pair: include `explanation` in the
    single JSON response.
- **Presentation:** the JP sentence replaces the bullet list. The rule-based bullets are
  the fallback — shown when `explanation` is `null` (LLM failed) and when the user toggles
  point multiplier / Rakuten card in a way that changes the winner or the gap (the bundled
  sentence reflects default settings only).
- **Language:** Japanese only.

## Architecture & data flow

```
match found (source, result)
   └─ rank by effectivePrice → winner, loser
   └─ explainPriceDifference(winner, loser)  → JP sentence | null   (numbers pinned, temp 0, cached)
        · streaming route → SSE event {type:'explanation', text}  AFTER the match event
        · POST route      → field `explanation` in the JSON body
client:
   explanation present → render JP sentence
   else / on toggle that changes winner-or-gap → render rule-based bullets (computed locally)
```

The explanation is generated for the **default** effective prices. Client-side toggles
(points/card) are not reflected in the sentence; on such a toggle the client falls back to
the live rule-based bullets.

## Components / files

- **`src/lib/price/explain.ts`** (new, pure) — single source of truth for the facts:
  - `computePriceFacts(winner, loser): { diff, diffPct, reasons: string[], platform }` —
    the reason logic extracted verbatim from `PriceExplanation.tsx` (list-price diff,
    shipping, points, quantity multiplier).
  - `pickWinnerLoser(a, b): { winner, loser }` — orders a pair by `effectivePrice`.
- **`src/lib/llm/openrouter.ts`** (add) — `explainPriceDifference(winner, loser): Promise<string|null>`:
  builds facts via `computePriceFacts`, calls the LLM with the exact ¥ numbers, returns one
  short JP sentence (max 2). Returns `null` on throw/empty. `temperature: 0`.
- **`src/app/api/enrich-compare/route.ts`**, **`src/app/api/find-amazon/route.ts`**,
  **`src/app/api/lookup/route.ts`** (POST) — after the match, when `result` exists:
  `pickWinnerLoser(source, result)` → `explainPriceDifference` → add `explanation` to payload.
- **`src/app/api/lookup/stream/route.ts`** (and any streaming comparison path) — after
  emitting the match event, compute the explanation and emit a final
  `{ type: 'explanation', text }` SSE event.
- **`src/components/PriceExplanation.tsx`** (modify) — use `computePriceFacts` for bullets;
  accept optional `explanation` prop; render the sentence when present, else bullets; revert
  to bullets when a toggle changes the winner or the gap.
- **`src/app/results/page.tsx`** — thread the `explanation` from the API/SSE into
  `PriceExplanation`; handle the toggle-staleness fallback.
- **Types** — add `explanation?: string` to the comparison response shape(s) and an
  `explanation` SSE event type.

## Prompt & accuracy

The prompt passes the **exact computed numbers** (winner platform, ¥diff, %OFF,
list-price diff, points delta, shipping, both product titles) as facts, and instructs:
*write ONE short, friendly Japanese sentence (max 2), use these numbers verbatim, do not
invent or alter any number.* Pinning the numbers keeps an LLM-written sentence factually
correct. `temperature: 0`.

## Caching

Cache the explanation by product-pair key (`makeCacheKey('explain:' + winner.affiliateUrl +
':' + loser.affiliateUrl)`, falling back to titles when a URL is missing), reusing
`lib/cache`. Avoids re-calling the LLM on re-tap / back-navigation.

## Error handling

`explainPriceDifference` returns `null` on any failure (caught). Routes then omit/null the
field. The client always has the rule-based bullets to fall back to, so a failure never
leaves the user without an explanation. SSE: if the explanation event never arrives, the
client keeps showing bullets.

## Testing

- `computePriceFacts` — pure unit tests: sale (list-price diff), free shipping, more points,
  quantity-multiplier mismatch, and the "no reasons" path.
- `pickWinnerLoser` — orders by effectivePrice.
- `explainPriceDifference` — mock LLM: returns the sentence; returns `null` on throw and on
  empty content.
- One POST route — returns `explanation` when a match exists; absent/null on no match.
- In-app verify: sentence shows on a real comparison; bullets remain when the LLM is
  disabled; bullets return on a points-multiplier toggle.

## Out of scope

- Detecting variant/color mismatches or "temporary sale vs real saving" (that was the
  accuracy-focused option, not chosen).
- Regenerating the sentence on client-side toggles (would require an extra query — the
  whole point was to avoid one).
- English translation of the sentence (Japanese only).
