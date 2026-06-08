# Category-aware keyword refinement

**Date:** 2026-06-08
**Status:** Approved (design)

## Problem

`refineKeyword(title, targetPlatform)` in `src/lib/llm/openrouter.ts` uses a single
universal prompt for every baby product. The prompt's priority rules (brand → line →
type → size → count) and its examples are diaper/formula-centric, so categories with
different matching pitfalls (carriers by supported-weight model, baby food by age
stage, strollers by model) get a keyword tuned to the wrong dimensions. This lowers
cross-platform recall: the refined keyword fails to surface the true equivalent, so
`semanticMatch` never sees it.

## Goal

A map between product category and prompt — i.e. a category-specialized prompt for
keyword refinement — empirically derived and wired into `refineKeyword`, so behavior
never regresses for categories we haven't tuned.

## Decisions (from brainstorming)

- **Runtime dispatch:** LLM classification step. `refineKeyword` first classifies the
  title into a category, then uses that category's prompt.
- **Derivation method:** Full empirical loop — browse both platforms, ≥10 products per
  category per platform, run each through the end-to-end app pipeline, iterate the
  prompt ≥3× on failure.
- **Category set:** Discovered from the live sites (not fixed up front). The discovered
  list is then frozen into the `Category` enum + map keys.
- **Success signal:** End-to-end app match — the pipeline (refined keyword → crawl →
  `rankBySimilarity` → `semanticMatch`) must return the correct equivalent, judged by
  inspecting both product pages.
- **Deliverable:** Category-aware `refineKeyword` (LLM classifier + `CATEGORY_PROMPTS`
  map + universal fallback). No separate markdown map doc; no regression eval harness
  shipped. The map lives in code as the artifact.

## Architecture

`refineKeyword(title, targetPlatform)` becomes a two-step LLM flow:

```
title → classifyCategory(title) → category (enum | 'unknown')
                                      ↓
        CATEGORY_PROMPTS[category]  (UNIVERSAL_PROMPT if unknown / low-confidence)
                                      ↓
        callLLM(prompt + title) → keyword
```

- `classifyCategory(title)` — one `callLLM` call, `temperature: 0`, returns a category
  from the fixed enum or `unknown`.
- `CATEGORY_PROMPTS: Record<Category, string>` — each value specialized for that
  category's matching pitfalls.
- Fallback — `unknown` / low confidence → today's universal prompt verbatim, so
  unrecognized titles behave exactly as today.
- `refineKeyword`'s signature is unchanged; callers (`findEquivalent`, lookup/search
  stream routes) need no changes.

Cost: one extra LLM round-trip per `refineKeyword` call (the classification). Accepted.

## Methodology

### Phase A — Discover taxonomy (browser, Chrome DevTools MCP)
Browse Amazon JP (`ベビー&マタニティ`) and Rakuten (`ベビー・キッズ・マタニティ`) category
trees. Enumerate the baby sub-categories each exposes; reconcile into one taxonomy
(candidate keys: `diapers`, `formula`, `baby_food`, `carriers`, `strollers`, `wipes`,
`bottles`, …). This frozen list becomes the `Category` enum and the map keys.

### Phase B — Per-category empirical loop
For each category:
1. Collect ≥10 products per platform (20 total) by browsing.
2. For each source product, run the test harness with the current candidate prompt.
3. Inspect the returned match against the source product page — judge same brand /
   line / type / size.
4. On failure to return the true equivalent, revise the category's prompt and retry —
   **≥3 attempts** before recording the best prompt.
5. Record the converged prompt into `CATEGORY_PROMPTS`.

## Test harness (throwaway, not shipped)

`scripts/probe-keyword.ts` lets us test a *candidate* prompt without rebuilding:

```
runProbe(sourceProduct, targetPlatform, candidatePrompt):
   keyword = callLLM(candidatePrompt + sourceTitle)
   results = crawl{Amazon,Rakuten}Search(keyword)
   ranked  = rankBySimilarity(source, results)
   idx     = semanticMatch(source, ranked)
   return { keyword, match: ranked[idx] }   // agent judges correctness
```

Reuses the real crawlers, `rankBySimilarity`, and `semanticMatch` — only the prompt is
swapped — so a passing probe implies the shipped pipeline passes.

## File-level changes

- `src/lib/llm/openrouter.ts` — add `Category` type, `classifyCategory()`,
  `CATEGORY_PROMPTS`, `UNIVERSAL_PROMPT` constant (today's prompt); rewire
  `refineKeyword` to classify → dispatch → fallback.
- `src/lib/llm/openrouter.test.ts` — tests for classifier dispatch, unknown→fallback,
  and each category producing a sensible keyword (mocked LLM).
- `scripts/probe-keyword.ts` — research harness; git-ignored or removed afterward.

No changes to `findEquivalent`, API routes, or `semanticMatch`.

## Out of scope

- Separate human-readable category→prompt markdown doc.
- Shipped regression eval harness / fixtures.
- Changes to `semanticMatch` ranking or matching criteria.
