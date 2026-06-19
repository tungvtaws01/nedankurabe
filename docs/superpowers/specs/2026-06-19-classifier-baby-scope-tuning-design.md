# Classifier + Baby-Scope Tuning — Design

**Date:** 2026-06-19
**Status:** Proposed (awaiting review)

## Problem

A live Rakuten product — 和光堂 レーベンスミルク はいはい 810g×8缶 (baby formula, JAN
4987244195937) — cannot be found in our SaaS, though kakaku.com finds it. Root cause traced
to the **baby-scope search gate**, not matching or the DB.

`isBabyQuery(keyword)` = `classifyLocal(keyword) !== 'unknown' || getGenreId(keyword) !== '100533'`.
For the product's natural search terms (`はいはい`, `レーベンスミルク`, `和光堂 はいはい`):
- `classifyLocal` → `unknown`: the `formula` regex enumerates specific lines
  (`粉ミルク|…|ほほえみ|はぐくみ|…`) but **not** 和光堂's lines `はいはい`/`レーベンスミルク`.
  (`baby_food` has `ハイハイン` — katakana senbei — which does not match `はいはい` hiragana.)
- `getGenreId` → `100533` (broad default): its formula key is the literal `/粉ミルク/`.

So `isBabyQuery` returns `false`, the search route short-circuits, and the UI shows the
"baby-only" empty state — for a real baby product.

### Why this is a class of bug, not a one-off

`classifyLocal` decides "is this baby? / which category?" by **enumerating brand-lines in
regex**. Two structural weaknesses:
1. **Coverage gap (false-negative → unknown):** every brand-line must be hardcoded; any line
   not listed falls through. Unbounded maintenance; はいはい today, the next line tomorrow.
2. **First-match-wins fragility (mis-bucketing):** `classifyLocal` returns the first rule that
   matches, so correctness depends on list *order* (hence the "tableware BEFORE baby_food"
   comments). Adding a token can silently change outcomes.

`classifyLocal` also serves two consumers with different needs: the **search gate** (short
keywords; needs high recall + compliance precision) and **harvest bucketing** (full titles;
needs per-category precision). One regex set tuned on titles is reused for sparse keywords.

## Goals

- Fix the immediate bug (formula lines findable) immediately and safely.
- Make the search gate stop mis-judging by using **authoritative signals** instead of guessing
  from the raw keyword.
- Make `classifyLocal` robust (order-independent) for harvest bucketing.
- Establish a labeled **eval/tuning harness** so judgments are measured and regressions caught.

## Non-goals

- No change to the matching pipeline, DB schema, or Amazon link-only model.
- No LLM on the search hot path (deterministic + ground-truth signals only).

## Approach (decided)

Search-then-filter by Rakuten genre, layered over an improved deterministic classifier. The
gate stops pre-judging keywords; instead we search and keep only items whose Rakuten `genreId`
is in a curated baby allow-set, and resolve pasted URLs via JAN→our DB.

---

## Layer 1 — Lexicon patch (ship first, low risk)

Unblock the reported bug without structural change.

- **`src/lib/jan/classify-local.ts`** — add 和光堂 formula lines to the `formula` rule:
  `…|はいはい|レーベンスミルク|ぴゅあ|ごくごく|…` (sweep other known-missing formula lines).
- **`src/lib/platforms/rakuten.ts` `getGenreId`** — broaden the 粉ミルク key so these lines map
  to genre `401171` (e.g. `/粉ミルク|はいはい|レーベンスミルク|ぴゅあ/`).
- **`src/lib/search/baby-scope.test.ts`** (new) — golden cases: `はいはい`, `レーベンスミルク`,
  `和光堂 はいはい` → `isBabyQuery === true`; `コーヒー`, `ノートパソコン` → `false`.

This makes `isBabyQuery` true for the formula terms even before Layers 2–3 land.

## Layer 2 — Classifier redesign (order-independent scoring)

Replace first-match-wins with a **data-driven scored lexicon**.

- **New `src/lib/jan/lexicon.ts`** — per category, weighted token groups:
  ```
  { category, tokens: RegExp[], weight }   // specific brand/type tokens weigh more
  ```
  Migrate the existing `RULES` regexes into this structure (no behavior loss; the ordering
  hacks become explicit weights).
- **`classifyLocal`** rewritten to **score every category** by summed weighted hits and return
  the argmax above a threshold; ties or below-threshold → `unknown`. Deterministic, free.
- Keeps the same `(title) => Category | 'unknown'` signature, so harvest bucketing and the
  fast-path are unchanged at the call site.

## Layer 3 — Gate redesign (search-then-filter; live signals)

The gate moves from "block keyword" to "search, keep baby-genre results."

- **New `BABY_GENRE_IDS`** allow-set in `rakuten.ts` — the *specific* baby genres only
  (粉ミルク 401171, おむつ 205197, おしりふき 205194, 哺乳びん 205208, 離乳食 213980, the
  `FOOD_GENRE_IDS`, and the rest of `GENRE_MAP`'s specific values). **Excludes** broad
  `100533`/`0` (which leak gift coffee/snacks → preserves Amazon-compliance precision).
- **`searchRakuten` / `searchRakutenKeyword`** — after parsing items, **drop any item whose
  `item.genreId` ∉ `BABY_GENRE_IDS`**. Genre filtering happens here because `ProductResult`
  carries no `genreId`; raw `item.genreId` is only available at parse time. (Re-evaluate the
  genre-fallback chain: with result-level filtering we can safely broaden the search genres
  without leaking, since the filter is now authoritative.)
- **`src/app/api/search/route.ts`** — remove the `isBabyQuery(query)` pre-gate; always run
  Rakuten (now genre-filtered) + Amazon-DB in parallel. Empty results → existing baby-only
  empty state. Bump cache prefix `kw6:` → `kw7:` (response semantics change).
- **URL / JAN lookup path (`/api/lookup`)** — when the input resolves to a JAN/itemCode,
  authoritative check against our **products DB** (we only harvested baby → present = baby).
  *Open item to confirm during planning:* exact repo function for JAN lookup
  (`findMatchByAsin` exists for ASIN; add/locate a `findByJan`).
- `isBabyQuery` / `classifyLocal` remain for harvest bucketing and as a cheap analytics signal,
  but are **no longer the gate** for keyword search.

## Layer 4 — Eval / tuning harness

Turn "tuning" into a measured loop using data we already have (harvested products + `goldset`).

- **`scripts/eval/classify-eval.ts`** — run `classifyLocal` over a labeled set of **titles**
  (sampled from harvested products, label = stored category) and report per-category
  precision/recall + a confusion matrix.
- **`src/lib/search/baby-scope.fixtures.ts`** — a curated labeled **keyword** set
  (`はいはい`→baby, `レーベンスミルク`→baby, `和光堂`→baby, `コーヒー`→unknown,
  `ノートパソコン`→unknown, …) driving `baby-scope.test.ts` (regression guard for the gate).
- **`BABY_GENRE_IDS` test** — assert the allow-set excludes `100533`/`0` and includes the
  specific baby genres, so precision can't silently regress.

---

## Data flow (after)

```
Keyword search:
  query ─▶ searchRakuten(query)                      ─▶ items
                └─ filter: item.genreId ∈ BABY_GENRE_IDS ─▶ baby items
        ─▶ amazonFromDb(query)  (our baby DB)         ─▶ amazon link-only
  (rakuten ∪ amazon) empty? → baby-only empty state

URL / JAN lookup:
  identifier ─▶ resolve JAN/itemCode ─▶ products DB hit? → baby (authoritative)
```

## Testing

- Layer 1: `baby-scope.test.ts` golden cases pass.
- Layer 2: `classify-eval.ts` per-category precision/recall ≥ current baseline (no regression);
  unit tests for scoring/threshold/tie→unknown.
- Layer 3: unit test `searchRakuten` genre filter (mock API JSON: formula item with genreId
  401171 kept; gift-coffee item under 100533 dropped); route test that off-topic → empty.
- Full `npm test` green (the 3 known pre-existing rakuten shipping failures excepted).

## Risks & mitigations

- **Precision/compliance:** broadening recall must not leak off-topic. Mitigated by the strict
  `BABY_GENRE_IDS` allow-set (authoritative Rakuten taxonomy) + the genre-exclusion test.
- **Extra API call for off-topic queries:** accepted (cheap, rare); cached by `kw7:` prefix.
- **A seller mis-genres a real baby item → dropped:** rarer than today's keyword gaps;
  allow-set is easily extended, and the eval harness surfaces it.

## Build order

Layer 1 (ship immediately) → Layer 4 harness → Layer 3 gate → Layer 2 classifier redesign
(validated against the harness).
