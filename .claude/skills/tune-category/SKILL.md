---
name: tune-category
description: Use when asked to tune, create, improve, or re-tune the keyword-refinement prompt for a product category (diapers, formula, a new category, etc.), or to raise cross-platform Amazon↔Rakuten match rates for a category in this repo.
---

# Tune a category keyword prompt

Empirically tune (or add) a per-category `refineKeyword` prompt so the cross-platform
Amazon JP ↔ Rakuten match succeeds more often. The keyword prompt's only job is to
surface the true equivalent in the target-platform search; `semanticMatch` then picks it.

**REQUIRED BACKGROUND:** Read [docs/category-prompt-tuning.md](../../../docs/category-prompt-tuning.md)
for the full runbook (architecture, exact harness commands, file locations). This skill is
the procedure + guardrails; the doc is the detail.

## Procedure

1. **Confirm scope & env.** Which category? New or existing? Acceptance defaults to **≥7/10
   end-to-end, ≥3 prompt iterations**. The loop needs a working `.env.local`
   (`OPENROUTER_API_KEY` + scrape.do/Rakuten keys) — without live crawls it is blind; stop and say so.
2. **New category only:** add the snake_case id to `CATEGORIES` in
   `src/lib/llm/category-prompts.ts` (the `Record<Category, PromptBuilder>` then forces an entry).
3. **Discover** ~10 real products per platform with `scripts/dump-search.ts`; for each source
   product find its true cross-platform equivalent (same brand/line/type/size) by reading
   crawled titles. Use the **crawlers, not a browser** — Amazon's automation snapshot serves
   English image-titles.
4. **Draft** `scripts/prompts/<cat>.txt` (copy `universal.txt`; customize for the dimensions
   that decide a match in that category).
5. **Probe & iterate** each source with `scripts/probe-keyword.ts`. PASS = `=== SEMANTIC MATCH ===`
   returns the true equivalent. Iterate the prompt ≥3× on keyword-side misses. Run each probe
   ~twice near the end (free model is nondeterministic). Log to `scripts/tuning/<cat>.md`.
6. **Bake** the final `.txt` into a `<CAT>_PROMPT` builder in `category-prompts.ts`
   (`{{platform}}`→`${platform}`, `{{title}}`→`${title}`); **verify byte-identical** to the
   `.txt` minus its trailing newline. Run `npx jest src/lib/llm/category-prompts.test.ts` and `tsc`.

## Running the jest-ignored harnesses

`/scripts/` is in `testPathIgnorePatterns`, so every harness run MUST add
`--testPathIgnorePatterns '/node_modules/'` or jest finds 0 tests. Full env-var
forms are in the runbook. Each probe ≈ 20s.

## Many categories at once

Run categories in **parallel batches of ~3 subagents**. Each subagent writes ONLY
`scripts/prompts/<cat>.txt` + `scripts/tuning/<cat>.md`, runs **no git commands**, and does
**not** edit `category-prompts.ts` (parallel writes conflict). Bake all of them in ONE
reviewed commit afterward.

## Guardrails / lessons

- Amazon JP titles come back **English-translated** → put an English→Japanese brand/line/model
  map *inside* the prompt so the keyword is Japanese.
- Rakuten **zeros out on over-specification** → keep the keyword tight (brand + line/model +
  type + size); drop counts/marketing/colors; write sizes in full form (`Mサイズ`, not `M`).
- **Know when it's not the keyword.** If the keyword already ranks the correct product #1 but
  `semanticMatch` returns NO MATCH, that is MATCHER-side — the hardcoded brand-equivalence map
  in `openrouter.ts` (~line 154) omits many brands (BabyBjörn, Graco, Cybex, Joie, ChuChu,
  Icreo, アロベビー, …). Record it as matcher-side; don't burn iterations on it. To actually
  raise match rates broadly, expanding that map is the higher-leverage task.

## Red flags — STOP

- Running the probe without the `--testPathIgnorePatterns '/node_modules/'` override (finds 0 tests).
- Using the browser to read product titles (use the crawlers).
- Parallel subagents committing or editing `category-prompts.ts` (conflicts) — they output prompt files only.
- Claiming a pass rate without re-running flaky probes; do not fabricate passes.
