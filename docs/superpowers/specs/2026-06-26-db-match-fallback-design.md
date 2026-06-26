# DB-Match Fallback for Cross-Platform Lookup — Design

**Date:** 2026-06-26
**Status:** Approved (design)

## Goal

When a user pastes a product URL, surface the cross-platform equivalent even when
the pasted listing's exact platform id is not in our DB — by matching the resolved
product against our **own DB products** with the existing matcher, behind a
conservative precision gate. No scraping of the other platform.

## Problem (root cause)

Our `listings` table is keyed by the platform-native id (Rakuten **API itemCode**,
e.g. `jetprice:10718259`; Amazon **ASIN**). A pasted Rakuten URL gives the seller's
**manage-number slug** (e.g. `jetprice:x392sh`), which rarely equals the API itemCode.
The Amazon-equivalent lookup (`findEquivalent`, Amazon target) does **only** an
exact-id DB lookup, so the match silently fails even when the product is in our DB.

Evidence gathered during investigation:

- Pasted `item.rakuten.co.jp/jetprice/x392sh/` resolves to a product that **is** in
  our DB — product 688 — with Rakuten `jetprice:10718259` ↔ Amazon `B0FTFXNGFS`.
  `lookupRakuten('jetprice:10718259')` returns `itemUrl = .../jetprice/x392sh/`,
  proving slug and itemCode are two ids for the same listing.
- Across a sample of Amazon-matched Rakuten listings, **~14%** surface their Amazon
  card today when their public URL is pasted; ~86% fail. ~66% of slugs are arbitrary
  seller codes (`ho-41187-002`, `hj-69961`) with no embedded identifier.

### Why the alternatives were rejected

- **Shop-search slug→itemCode** (search Rakuten by shop+title, match on `itemUrl`):
  recovered only ~35% of arbitrary-slug cases and once resolved to the **wrong pack
  variant** (`kaigo:...935` vs `...937`). Incomplete and unsafe.
- **JAN-based resolver:** Rakuten's API has no structured JAN field — we regex JANs
  out of free-text captions (`extractJans`), so only **1,025 / 9,849 products (10%)**
  have a JAN, and **588 / 3,071 (19%)** of Amazon-matched ones. The ceiling is set by
  Rakuten's source data, not our DB. Dead end.

Title-similarity DB matching is the only approach that scales to arbitrary slugs,
because the product is almost always already in our DB under a different listing.

## Constraints

- **Amazon Associates compliance:** candidates come from our DB only. Amazon stays
  link-only (`buildAmazonLinkResult`, `priceUnavailable`) — no Amazon scraping, price,
  or image. Baby-scope gating unchanged.
- **Precision over coverage** (user decision): a false match means a tagged affiliate
  link to the wrong product. Target precision **≥ 95%**.
- **Both directions** (user decision): Rakuten-paste→Amazon and Amazon-paste→Rakuten.
- **Write-back** (user decision): confirmed matches are cached into `listings`,
  distinguishable as `matchSource='llm'` so they stay separable from vision-verified
  rows and a bad one can be cleaned up.

## Architecture

New pipeline stage, added to `findEquivalent` for both target directions:

```
paste URL
  → resolve source product (existing: JAN path → fast lookup → HTML scrape)
  → exact-id sibling lookup (existing)                     ── hit? return
  → [NEW] DB-match fallback:
        1. retrieve candidates: DB products that HAVE an active listing on the
           target platform AND share title tokens with the source
        2. rankBySimilarity(source, candidates)            (numeric-token weighted)
        3. semanticMatch(source, ranked, {category})       → confirmed index | null
        4. conservative gate: LLM-confirm AND rank-similarity ≥ T
        5. hit → build target card (Amazon link-only | Rakuten live price)
        6. write back pasted slug → matched product (matchSource='llm')
  → no confident match: current behavior (source alone, no sibling card)
```

**Direction notes:**
- Rakuten-paste→Amazon: source title is Rakuten text; `products.title` is
  Rakuten-sourced → same-language match (strong signal).
- Amazon-paste→Rakuten: source is the Amazon URL-slug title
  (`extractTitleFromAmazonUrl`); weaker, but numeric tokens carry it and the same
  gate protects it.

**Reuse insight:** DB candidates have no live price → set `effectivePrice = 0`. With
all candidates equal-priced, `semanticMatch`'s cheapest-tiebreak returns the
highest-ranked confirmed candidate — the desired behavior, no matcher change needed.

## Components

### New: `src/lib/matching/db-fallback.ts`

```
interface DbMatch {
  productId: number
  targetListingId: string   // ASIN or "shop:itemId"
  productTitle: string
  productImageUrl: string
  similarity: number
}

matchAgainstDb(
  source: ProductResult,
  target: 'amazon' | 'rakuten',
  category?: Category,
): Promise<DbMatch | null>
```

Orchestrates candidate retrieval → `rankBySimilarity` → `semanticMatch` → gate.
Returns the matched product's target-platform listing id, or null. Pure matching:
no card-building, no write-back (caller's responsibility). All steps best-effort;
any failure returns null.

`SIMILARITY_FLOOR = T` — named constant, value locked by the tuning harness, with
measured precision/recall in a comment.

### New repo functions: `src/lib/harvest/repo.ts`

- `findProductCandidatesByTokens(keyword, targetPlatform, limit=10)` — tokenized
  ILIKE-AND on `products.title`, restricted to products with an active listing on
  `targetPlatform` and non-empty image. Returns
  `{ productId, title, imageUrl, targetListingId }[]`. Generalizes the existing
  `searchAmazonFromDb`.
- `linkSlugToProduct(productId, platform, platformId, title, confidence)` —
  write-back; upserts a listing row for the pasted slug pointing at the existing
  product, `matchSource='llm'`. Reuses `upsertListing` (idempotent ON CONFLICT).

Each direction is wired at exactly one site; both call the same `matchAgainstDb`.

### Modified: `src/lib/matching/find-equivalent.ts` (Rakuten-paste → Amazon)

- Amazon-target path: after `findAmazonSiblingByRakuten` miss, call
  `matchAgainstDb(source,'amazon',category)`; on hit → `buildAmazonLinkResult` +
  write back the source's Rakuten slug via `linkSlugToProduct`.
- The Rakuten-target path (live-search LLM flow) is **unchanged** — Amazon-paste →
  Rakuten is handled in the lookup route, not here, to avoid disturbing that flow.

### Modified: `src/app/api/lookup/route.ts` (Amazon-paste → Rakuten)

- Amazon-paste branch: when `findMatchByAsin` misses, call
  `matchAgainstDb(amazonCard,'rakuten',category)` (source = the link-only Amazon card
  built from the slug-title). On hit → hydrate the live Rakuten price via
  `lookupRakuten(targetListingId)`, show it alongside the link-only Amazon card, and
  write back the ASIN → matched product via `linkSlugToProduct`.
- Rakuten-paste branch already calls `findEquivalent(...,'amazon')` → picks up the new
  fallback automatically.

### Candidate → ProductResult adapter

Candidates become minimal `ProductResult`s (`title`, `imageUrl`, `salePrice:0`,
`effectivePrice:0`, target `platform`) so `rankBySimilarity` / `semanticMatch`
consume them unchanged.

## The conservative gate

Accept a candidate only if **both**:
1. `semanticMatch` confirms it (same-product; includes the existing brand gate), **and**
2. `rankBySimilarity` score ≥ **T**.

The similarity floor stops a "confirmed" loose match when the candidate pool is thin.
Numeric-token weighting (0.7) means a pack/size mismatch lowers the score naturally —
a wrong-pack candidate tends to fail the floor without an explicit quantity rule.
`semanticMatch` null or top-confirmed-below-T → no card (current behavior).

### Threshold tuning (offline)

`scripts/tuning/tune-db-fallback.ts` replays the 1,600 goldset pairs
(`docs/harvest/verify/goldset.jsonl`) through `rankBySimilarity` + `semanticMatch`
against a DB-candidate pool, sweeps T, and reports precision/recall. Lock T at the
knee meeting **precision ≥ 95%**. `qtyDiffers` rows confirm pack-mismatch behavior
separately. Not part of the prod path; not a Jest test. The chosen T and its measured
precision/recall are recorded in this spec and in the `db-fallback.ts` comment.

## Error handling

Every fallback step is best-effort and wrapped; any failure (DB down, LLM timeout,
KV miss) degrades to today's behavior — source product alone, no sibling card. The
fallback never throws into the user path. Write-back failures are swallowed (identical
to existing `writeBack`).

## Performance

Fallback runs only on cache-miss + exact-id-miss: one token query + one
`semanticMatch` LLM call (~1–2s), comparable to the existing `explainPriceDifference`
call. Result cached under the existing `lookup6:` KV key; write-back makes the next
paste of the same slug hit the instant exact-id path.

## Testing

- **Unit** (`db-fallback.test.ts`): gate logic with mocked `semanticMatch` —
  confirm+above-T → match; confirm+below-T → null; no-confirm → null; empty pool → null.
- **Repo** (mocked `query`): `findProductCandidatesByTokens` builds correct ILIKE-AND
  SQL filtered to products with a target-platform listing; `linkSlugToProduct` upserts
  with `matchSource='llm'`.
- **Regression**: x392sh case → product 688 / ASIN `B0FTFXNGFS` (mocked DB + matcher).
- **Tuning harness**: precision/recall table recorded here; not a Jest test.
- Full suite stays green (`npm test`).

## Out of scope

- Backfilling JANs (rejected above).
- Resolving slug→itemCode via Rakuten shop search (rejected above).
- Any change to the search (`/api/search`) route; this is the lookup/paste flow only.
```
