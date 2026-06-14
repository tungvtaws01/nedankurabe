# semanticMatch refactor: code-side brand matching + per-genre judge rules

**Date:** 2026-06-14
**Status:** design (awaiting review → writing-plans)

## Goal

Raise end-to-end cross-platform match rate (Amazon JP ↔ Rakuten) without losing precision, and make adding a brand or a genre a **data-row change** instead of a prompt edit. Two coupled changes to `semanticMatch` (`src/lib/llm/openrouter.ts`):

1. **Move brand-equivalence out of the LLM prompt into deterministic code** — a `BRAND_ALIASES` table + `normalizeBrand()` + a pre-LLM brand gate.
2. **Split the single shared judge prompt into per-genre `MATCH_RULES`** dispatched by category (mirroring the already-per-genre `refineKeyword`/`CATEGORY_PROMPTS` architecture).

## Background / problem

`semanticMatch(source, candidates)` sends ONE large prompt to the judge LLM. That prompt hardcodes, as prose:
- a brand-equivalence list (`Pampers=パンパース, …`) at [openrouter.ts:98-102](../../../src/lib/llm/openrouter.ts#L98), plus a strict NO-BRAND rule and a DISTINCT-brands-never-match rule;
- ALL genres' line/type/size/variant rules (diapers, formula, baby_food, wipes, sunscreen, gender swim-pants, …) at lines 105-145, sent on every call regardless of the product's genre.

Empirical finding (2026-06-14 tuning of 21 genres): the keyword prompts now reliably surface the true equivalent at rank #1 (keyword-side pass ≥7/10, mostly 9-13/10), but **end-to-end drops to 4-7/10 on durables** because the judge returns NO MATCH for brands absent from the inline list (ベビーダン, カトージ, Ingenuity, 大和屋, STOKKE, TERUMO, dretec, 丹平, LION/クリニカKid's, ジェクス/チュチュ/L8020, エドインター, タカラトミー, Agatsuma↔LEC alias, …). The brand list is the dominant ceiling, and the all-genres prompt is long, growing, and dilutes attention.

`ProductResult` (`src/lib/types.ts`) has **no `brand` and no `category` field** — both are derived from `title` or passed by the caller. `semanticMatch` currently takes no category. At serve time `refineKeyword` already calls `classifyCategory(title)` once; harvest already knows the category (it filters the batch by it).

## Architecture

```
semanticMatch(source, candidates, opts?: { category?: Category })
  │
  ├─ 1. BRAND GATE (deterministic, code)
  │      srcBrand = normalizeBrand(source.title)            // canonical id | null
  │      keep candidate c if:
  │         cBrand = normalizeBrand(c.title)
  │         (srcBrand && cBrand)  → keep iff srcBrand === cBrand   (cross-brand reject)
  │         (srcBrand null || cBrand null) → keep (defer to LLM + NO-BRAND rule)
  │      → drops obvious cross-brand candidates with no LLM call
  │
  └─ 2. JUDGE (LLM) on survivors
         prompt = BASE_RULES + (MATCH_RULES[category] ?? GENERAL_RULES)
         (BASE no longer carries the brand list; a slim NO-BRAND note remains
          for the null-brand cases that reach the LLM)
         → returns matching indices → caller picks cheapest (unchanged)
```

Two new data modules + a thinner `semanticMatch`. The brand gate is pure/testable; the judge prompt becomes genre-scoped and shorter.

## Components

### 1. `src/lib/llm/brand-aliases.ts` (new)

```ts
// canonical brand id → all surface forms seen on either platform (JP / EN / variants)
export const BRAND_ALIASES: Record<string, string[]> = {
  pampers:  ['パンパース', 'Pampers'],
  merries:  ['メリーズ', 'Merries', 'Merys'],
  moony:    ['ムーニー', 'Moony'],
  // … existing inline brands …
  babydan:  ['ベビーダン', 'Babydan', 'BabyDan'],
  katoji:   ['カトージ', 'KATOJI'],
  stokke:   ['ストッケ', 'STOKKE', 'Stokke'],
  terumo:   ['テルモ', 'TERUMO'],
  // … tuning-discovered brands …
  kirkland: ['カークランド', 'KIRKLAND', 'Kirkland'],   // stays its OWN id → never == rico
  rico:     ['RICO', 'リコ'],
}

// returns the canonical id whose alias appears in the title, else null.
// match is case-insensitive; longest alias wins on overlap.
export function normalizeBrand(title: string): string | null
```

Design notes:
- **DISTINCT-brands rule is now automatic**: KIRKLAND and RICO are separate canonical ids, so the gate rejects the pair. No prose rule needed.
- **Unknown brand → null → defer to LLM** — this preserves today's behavior for un-tabled brands (no regression; they just aren't accelerated).
- Aliases are matched as substrings of the title; ambiguous/short tokens (e.g. a brand that is a common word) must be entered carefully or omitted (left to the LLM). The table is the single place to maintain brand knowledge.

### 2. Brand gate inside `semanticMatch`

Runs before the LLM, on the candidate pool (after the existing top-8 slice). Drops candidates whose canonical brand is known and differs from a known source brand. If the source brand is null, no gate is applied (all candidates pass to the LLM, where the NO-BRAND rule still governs generic-vs-branded). The gate never *adds* matches — it only removes certain-mismatches, so it cannot create a false positive.

### 3. `src/lib/llm/match-rules.ts` (new)

```ts
import { type Category } from './category-prompts'

// Cross-cutting rules sent for EVERY match (no brand list here):
export const BASE_RULES = `… product type, gender, usage-variant (夜用≠昼用),
  generic per-unit-size rule, PACK QUANTITY normalization, LOW (colors/bundles),
  NO-BRAND note (only for null-brand cases), JSON output contract …`

// Per-genre HIGH criteria — only the rules that decide a match in that genre.
export const MATCH_RULES: Record<Category, string> = {
  diapers:    `line さらさらケア≠はじめての肌… ; size+枚 STRICT (adjacent sizes mismatch)`,
  formula:    `form 缶≠キューブ≠液体 ; stage ほほえみ≠ステップ ; per-unit can size`,
  baby_food:  `line ハイハイン≠グーグーキッチン ; DISH/FLAVOR must match within line`,
  wipes:      `純水≠アルコール ; 流せる≠regular ; 手口≠おしり ; named lines differ`,
  skincare:   `SPF level part of SKU (SPF50≠35≠29≠21)`,
  thermometer:`measurement type 耳式≠非接触≠予測 ; model code decisive`,
  // … all 21, seeded from the existing inline rules + scripts/tuning/*.md …
}

// Fallback when no category is supplied (back-compat = today's union of rules).
export const GENERAL_RULES = `… union of the cross-cutting genre rules …`
```

`semanticMatch` composes: `BASE_RULES + (MATCH_RULES[opts.category] ?? GENERAL_RULES)`. Adding a genre = add one `MATCH_RULES` entry (the `Record<Category, …>` type forces it, same guarantee as `CATEGORY_PROMPTS`).

### 4. `semanticMatch` new signature + caller threading

```ts
export async function semanticMatch(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<number | null>
```

Caller updates (category passed when known; omitted callers hit the safe `GENERAL_RULES` fallback):
- **harvest** [02-match-amazon.ts](../../../scripts/harvest/02-match-amazon.ts), [reeval-nomatch.ts](../../../scripts/harvest/reeval-nomatch.ts): the batch is already per-category — pass that category.
- **serve** [lookup/stream/route.ts](../../../src/app/api/lookup/stream/route.ts), [find-equivalent.ts](../../../src/lib/matching/find-equivalent.ts), [llm-match.ts](../../../src/lib/matching/llm-match.ts): avoid double-classifying. `refineKeyword` currently calls `classifyCategory` internally and does not expose it. Mechanism: the caller calls `classifyCategory(source.title)` ONCE and passes the result to BOTH (a) `refineKeyword` — which gains an optional `category?` param so it skips its internal classify when given one — and (b) `semanticMatch` via `opts.category`. Net LLM-call count is unchanged from today (one classify per match flow). Callers that don't yet classify (or where it's not worth it) simply omit `opts.category` → `GENERAL_RULES`.
- **harnesses** probe-keyword/probe-matcher: pass the category under test.
- **unit tests** openrouter.test.ts: unchanged calls hit the fallback (still valid).

## Data flow (serve, paste-Rakuten example)

crawl source → `classifyCategory(title)` = `diapers` (once) → `refineKeyword` (diapers prompt) → search Amazon → rank → `semanticMatch(src, ranked, {category:'diapers'})` → brand gate drops non-Pampers candidates → judge with `BASE + MATCH_RULES.diapers` → cheapest match.

## Error handling / back-compat

- `normalizeBrand` returns null on no match → LLM fallback (no throw).
- Unknown/omitted category → `GENERAL_RULES` (today's behavior).
- `semanticMatch` keeps its existing try/catch → returns null on any LLM/JSON failure.
- The brand gate only removes candidates; if it removes everything, return null (same as "no match"), which is correct — they were all cross-brand.

## Testing & validation

**Unit (new, deterministic — unlike the LLM judge):**
- `brand-aliases.test.ts`: alias→canonical (JP & EN forms), case-insensitivity, longest-match, null for unknown, KIRKLAND≠RICO are distinct ids.
- brand-gate behavior (via a small exported helper or through semanticMatch with mocked LLM): cross-brand dropped, same-brand kept, null source → all pass.
- `match-rules.test.ts`: `MATCH_RULES` has an entry for every `Category` (mirror of category-prompts.test.ts); composed prompt contains the genre's rule text.

**Integration (re-probe, the precision gate):**
- Re-run `scripts/probe-matcher.ts` / `probe-keyword.ts` against the tuning sources in `scripts/tuning/*.md` across all 21 genres.
- Pass criteria: end-to-end pass **≥ pre-refactor** on every genre, AND precision guards intact — KIRKLAND≠RICO, NO-BRAND (generic≠branded), flavor (baby_food), SPF (skincare), gender swim-pants, size-adjacency (diapers) all still reject.
- Keep `openrouter.test.ts` green throughout.

## Migration steps (high level — detailed in the plan)

1. Extract the inline brand list → `BRAND_ALIASES` (faithful) + add tuning-discovered brands.
2. Extract inline per-genre rules → `MATCH_RULES`; cross-cutting rules → `BASE_RULES`; build `GENERAL_RULES` from the union (= current prompt minus brand list).
3. Add `normalizeBrand` + the brand gate to `semanticMatch`; add the `opts.category` param + prompt composition.
4. Thread category from harvest + serve callers. Add an optional `category?` param to `refineKeyword` (skips its internal `classifyCategory` when supplied); serve callers classify once and pass to both `refineKeyword` and `semanticMatch`.
5. Unit tests + full 21-genre re-probe; tune `MATCH_RULES`/`BRAND_ALIASES` until end-to-end ≥ baseline with precision intact.

## Risks & rollout

- **Core matcher, both serve + harvest paths.** Mitigation: optional param + `GENERAL_RULES` fallback means un-updated callers behave exactly as today; changes land incrementally.
- **Brand-gate false negatives** if an alias is wrong/missing → at worst reverts to today's LLM behavior (gate only acts on KNOWN brands). 
- **Ambiguous alias substrings** (a brand token that is a common word) could wrongly gate → policy: omit such tokens from the table (leave to LLM) rather than risk it; cover with a unit test.
- Validation is the re-probe gate above; do not merge if any genre regresses on precision.

## Out of scope (YAGNI)

- Adding a `brand`/`category` column to `ProductResult` or the DB (derive from title; category passed as opt).
- The Agatsuma↔LEC *maker-alias* (same SKU, two companies) — handle later as a small explicit cross-id equivalence if it proves worth it; not in this pass.
- Per-genre JUDGE *model* selection, caching changes, or live-latency work.

## Resolved decisions

- Category source: **optional `opts.category` param + `GENERAL_RULES` fallback** (serve reuses the existing `classifyCategory` result; harvest passes its known category). Not an internal extra classify call; not a forced-required param.
