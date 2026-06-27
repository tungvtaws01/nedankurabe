# Pack-Size-Aware Multi-Candidate Amazon Matching — Design

**Date:** 2026-06-27
**Status:** Approved (design)

## Goal

When a user opens a Rakuten item's comparison page, show the same-product Amazon
options at *different pack sizes* (ranked by how close each pack is), instead of
betting on one "best" Amazon match and frequently landing on a wrong size
(e.g. a 4-袋 trial pack shown for a 120-袋 item).

## Problem

The current `matchAgainstDb` returns a single Amazon equivalent. Two failures:

1. **Wrong-pack matches.** Pasting Rakuten `らくらくキューブ 27g×120袋` (3,240 g)
   matched Amazon `27g×4袋` (108 g) — a 30× size difference — because retrieval
   surfaced only that one candidate and the gate has no quantity check. Amazon is
   link-only (no price shown), so it isn't a price lie, but the user lands on the
   wrong-size product.
2. **Retrieval recall gaps** (why only the 4袋 surfaced):
   - **Brand-spacing:** the query token `明治ほほえみ` (contiguous) misses candidate
     titles written `明治 ほほえみ` (spaced) under `ILIKE '%明治ほほえみ%'`.
   - **Over-specific size token:** the query included `27g`, excluding the larger
     packs whose titles list total grams (`810g`, `1620g`) instead of `27g`.

Our DB actually holds 30袋 / 60袋 / 1620g×3箱 listings for that product — all
closer than the 4袋 — but they were never retrieved.

## Decisions (from brainstorming)

- **Show several candidates**, not one. Unified ranked list: Rakuten item +
  up to **5** same-product Amazon cards, **closest pack first**.
- **Never drop** by size — show the closest 5 regardless, each **labeled**.
  Near-same size → `サイズ一致` badge; otherwise the card's title shows the pack
  (tagged `別容量`).
- **Unparseable size → show, ranked last**, no badge.
- **Scope:** Rakuten→Amazon only (Amazon is link-only, so stacking link cards is
  safe). Amazon-paste→Rakuten keeps the single-best card (priced; winner logic).

## Constraints

- Amazon stays link-only: candidates from our DB only, no Amazon scraping/price/
  image; cards use `buildAmazonLinkResult` (`priceUnavailable`). (CLAUDE.md HARD RULE.)
- Imperfect pack parsing must degrade gracefully — never a false `サイズ一致` or a
  wrong drop. Unknown parse → ranked last, no badge, similarity order (today's
  behavior for that card).
- Full Jest suite green before merge; `tsc` clean.

## Architecture & data flow

New entry point for the Rakuten→Amazon comparison:

```
findAmazonEquivalents(source, category?) → ProductResult[]   (link-only, ≤5, ranked)

  exact-id sibling (findAmazonSiblingByRakuten)  ┐
  matchAgainstDb (multi):                         ├─ merge, dedupe by ASIN
    refineKeyword(source.title, 'amazon', cat)    │
    → findProductCandidatesByTokens (broad recall)│
    → rankBySimilarity                            │
    → semanticMatchAll  (all confirmed same-product)
    → parsePackSize + closeness + tier tag        ┘
  → sort by packCloseness asc (size-unknown last)
  → top 5 → link-only cards, each with sizeMatch tag
  → write back the closest confirmed match (fast path next time)
```

With >2 cards the page's `comparable` is already false → no winner highlight, no
price-difference sentence. Empty result → existing "not found" message.

## Components

### New: `src/lib/matching/pack-size.ts`

```
parsePackSize(title: string): { dimension: 'g' | 'ml' | '枚' | null; total: number | null }
sizeRelation(src, cand): 'exact' | 'different' | 'unknown'
packCloseness(src, cand): number   // |ln(ratio)|, Infinity if unknown
```

**parsePackSize rules:**
1. Strip baby weight ranges first: `(6~11kg)`, `6-11kg`, `（4~8kg）` → removed (they
   are the baby's size, not the pack).
2. Strip parenthetical breakdowns `（…）` / `(…)` before counting, to avoid
   double-counting a stated total against its own breakdown
   (`1560g（780g×2缶）×4個` → base `1560g`, outer ×4 → 6,240 g; not 24,960 g).
3. Pick the base measure by priority **g > ml > 枚** (after the kg-range strip,
   diapers/wipes fall through to 枚; formula keeps g; liquid keeps ml).
4. Multiply base by outer pack multipliers: `×N` and
   `N袋 / N缶 / N箱 / N個 / N本 / Nセット / Nパック / Nケース / N組`.
5. When multiple totals of the same unit appear without a breakdown relationship
   (`156枚 52枚×3袋`), take the largest single stated value (156), don't multiply.
6. Anything not confidently resolvable → `{ dimension: null, total: null }`.

**sizeRelation:** different dimensions or either `total` null → `unknown`;
`ratio = cand.total / src.total` within **[0.8, 1.25]** → `exact`, else `different`.
(Band tunable.)

### Modified: `src/lib/llm/openrouter.ts`

Add `semanticMatchAll(source, candidates, opts?): Promise<number[]>` — returns **all**
confirmed same-product candidate indices (the `matches: number[]` it already parses,
mapped to original indices, brand-gate applied), without the cheapest-reduce.
Existing `semanticMatch` is unchanged (still used by the live-search path).

### Modified: `src/lib/harvest/repo.ts` — `findProductCandidatesByTokens`

- **Space-insensitive match:** `regexp_replace(p.title,'[\s　]','','g') ILIKE '%' || $n || '%'`
  with the bound token also space-stripped, so `明治 ほほえみ` matches `明治ほほえみ`.
- **Textual tokens only:** drop numeric/size tokens (numbers and unit suffixes
  `g/kg/ml/l/枚/袋/缶/個/本/箱/セット/パック`) from the AND — match on brand/product-line
  words; pack size is handled by ranking, not retrieval.
- Raise `limit` default to ~20 so all pack sizes surface; ranking narrows.
- Keep `p.image_url <> ''`.

### New: `src/lib/matching/db-fallback.ts` — `findAmazonEquivalents` (+ multi `matchAgainstDb`)

`matchAgainstDb` returns `DbMatch[]` (ranked, ≤5, each with a `sizeMatch` tier and
`similarity`). `findAmazonEquivalents(source, category?)` merges the exact-id sibling
(first, deduped by ASIN), maps each `DbMatch` to a link-only `ProductResult` via
`buildAmazonLinkResult` with `sizeMatch` set. Best-effort throughout: any failure →
`[]`. Write-back: the closest confirmed match (existing `linkSlugToProduct`).

### Modified: call sites (Rakuten→Amazon only)

- `src/app/api/enrich-compare/route.ts` (line 44/137): replace the single
  `findEquivalent(source,'amazon',candidates)` with `findAmazonEquivalents(source, cat)`;
  spread the returned list into `results`.
- `src/app/api/lookup/stream/route.ts` Rakuten branch (line 137): same swap.
- `src/lib/matching/find-equivalent.ts` Amazon-target path: now delegates to
  `findAmazonEquivalents` and returns its first (closest) element, preserving
  `findEquivalent`'s `ProductResult | null` contract (DRY — one matching path, no
  duplicated exact-id/fallback logic). Its existing Amazon-fallback tests are
  updated to mock `findAmazonEquivalents`. The Rakuten-target (live-search) path of
  `findEquivalent` is unchanged.
- `resolveAmazonPaste` (Amazon→Rakuten) unchanged — out of scope.

Because `matchAgainstDb` now returns `DbMatch[]`, its only caller is
`findAmazonEquivalents`; the existing single-result `db-fallback.test.ts` cases are
updated to the list shape.

### Modified: `src/lib/types.ts` + `src/components/ProductCard.tsx`

- `ProductResult` gains optional `sizeMatch?: 'exact' | 'different'` (additive).
- `ProductCard` renders a small pill near the platform label: `exact` →
  "サイズ一致 · same size" (subtle green); `different` → "別容量 · different size"
  (muted amber); omitted → no badge.

### Ordering (no page change)

`byEffectivePrice` already sorts `priceUnavailable` cards last and is stable among
them, so the Rakuten priced card stays first and the Amazon cards keep the
closeness order returned by `findAmazonEquivalents`. `results/page.tsx` is unchanged.

## Error handling

Every step is best-effort and wrapped: retrieval / LLM / parse failures degrade to
fewer candidates or similarity-only ordering, never a thrown error into the request
and never a false `サイズ一致`. Write-back failures are swallowed.

## Edge cases

- Source title unparseable → similarity order, all `unknown`, no badges.
- Zero confirmed candidates → `[]` → page shows existing "not found" message.
- All candidates size-unknown → similarity order, no badges.
- Duplicate ASIN (exact-id sibling also retrieved) → deduped.

## Testing

**Unit:**
- `pack-size.test.ts` — cross-genre corpus: diapers `52枚`, `156枚 52枚×3袋`→156,
  wipes `64枚×3`→192, formula `780g×2缶×4個`→6240, `1560g（780g×2缶）×4個`→6240,
  liquid `240ml×24`, cubes `27g×60袋`→1620, kg-range `Mサイズ(6~11kg) 58枚`→58枚,
  unparseable→`null`; `sizeRelation` band; `packCloseness` order.
- `semanticMatchAll` — returns all confirmed indices; brand gate applied.
- `findProductCandidatesByTokens` (query spy) — space-insensitive SQL; size tokens
  excluded; textual tokens bound.
- `findAmazonEquivalents` — closeness ranking (unknown last), ASIN dedupe, cap 5,
  tier tagging, exact-id-first merge, empty when nothing confirms.
- `ProductCard` — badge per `exact` / `different` / omitted.

**Real-DB scripts (not Jest):** 120袋 case returns 60袋/1620g×3箱/30袋 ranked (not 4袋);
a diaper case (58枚 vs 156枚) confirms 枚 ranking. **Goldset:** replay `qtyDiffers`
pairs — `false`→`exact`, `true`→`different` — sanity-checks the ±25% band.

**Regression:** full suite green; `tsc` clean.

## Out of scope

- Amazon-paste→Rakuten multi-candidate (priced side, winner logic).
- Per-unit price comparison (blocked: Amazon has no price until Creators API).
- Changes to the keyword-search pick-list (`/api/search`).
