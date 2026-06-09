# Category prompt-tuning pipeline

How to empirically tune or add a per-category keyword-refinement prompt for
cross-platform product matching (Amazon JP ↔ Rakuten). All 10 baby categories
were tuned this way; follow the same loop for any new category.

## How it fits together

`refineKeyword(title, targetPlatform)` in [`src/lib/llm/openrouter.ts`](../src/lib/llm/openrouter.ts):

1. `classifyCategory(title)` — one LLM call → a category id from `CATEGORIES`, or `unknown`.
2. Dispatch to `CATEGORY_PROMPTS[category]` (or `UNIVERSAL_PROMPT` if `unknown`).
3. The refined keyword is crawled on the target platform → `rankBySimilarity` → `semanticMatch` picks the true cross-platform equivalent.

The taxonomy and prompts live in
[`src/lib/llm/category-prompts.ts`](../src/lib/llm/category-prompts.ts):

- `CATEGORIES` — `as const` array, the **single source of truth**. `Category = typeof CATEGORIES[number]`.
- `UNIVERSAL_PROMPT` — the generic fallback (never regresses unknown titles).
- One `<CAT>_PROMPT: PromptBuilder` per category, wired in `CATEGORY_PROMPTS: Record<Category, PromptBuilder>` (the `Record` type forces every category to have an entry).

Prompt sources and tuning logs:

- `scripts/prompts/<cat>.txt` — the prompt body (uses `{{platform}}` / `{{title}}` placeholders).
- `scripts/tuning/<cat>.md` — the empirical tuning log for that category.

## Harnesses (throwaway, jest-ignored)

`jest.config.ts` ignores `/scripts/`, so these only run with an explicit
`--testPathIgnorePatterns '/node_modules/'` override. They need a working
`.env.local` (`OPENROUTER_API_KEY` + scrape.do / Rakuten crawler keys). Each
probe ≈ 20s (2 LLM calls + a live crawl).

**Discover products** ([`scripts/dump-search.ts`](../scripts/dump-search.ts)) — crawler-based, no browser:

```bash
DUMP_PLATFORM=<amazon|rakuten> DUMP_KEYWORD='明治ほほえみ らくらくキューブ' \
npx jest --config jest.config.ts --runInBand \
  --testPathIgnorePatterns '/node_modules/' --testMatch '**/scripts/dump-search.ts'
```

**Probe a candidate prompt** ([`scripts/probe-keyword.ts`](../scripts/probe-keyword.ts)) — the pass/fail signal:

```bash
PROBE_FROM=<rakuten|amazon> PROBE_TITLE='<exact source title>' PROBE_PRICE=<yen> \
PROBE_PROMPT=scripts/prompts/<cat>.txt \
npx jest --config jest.config.ts --runInBand \
  --testPathIgnorePatterns '/node_modules/' --testMatch '**/scripts/probe-keyword.ts'
```

It prints `=== KEYWORD ===`, `=== RANKED CANDIDATES ===`, and `=== SEMANTIC MATCH ===`
(the product the pipeline chose, or `NO MATCH`). `PROBE_FROM` is the platform the
source is *from*; it searches the other one.

> Use the crawlers (not a browser) for discovery and ground truth — they return
> exactly what the matching pipeline sees. Amazon's automation snapshot serves
> English, image-based titles, which is misleading.

## Loop for a new category

1. **Add the key.** Add the snake_case id to `CATEGORIES` in `category-prompts.ts`.
   The `Record<Category, PromptBuilder>` will fail to compile until you add a
   `CATEGORY_PROMPTS` entry; `classifyCategory` picks the id up automatically.
2. **Discover.** Use the dump helper to collect ~10 real products per platform.
   For each source product, find its true equivalent on the other platform
   (same brand / line / type / size) and note the title — that's the ground truth.
3. **Draft the prompt.** Copy `scripts/prompts/universal.txt` to
   `scripts/prompts/<cat>.txt` and customize for the dimensions that decide a
   match in that category.
4. **Probe & iterate.** Run the probe for each source product. PASS = the
   `=== SEMANTIC MATCH ===` line returns the true equivalent. Iterate the prompt
   (**≥3 revisions**) on keyword-side failures. Acceptance: **≥7/10** end-to-end.
5. **Bake it in.** Replace the category's `CATEGORY_PROMPTS` entry with a
   `<CAT>_PROMPT` builder whose body mirrors the `.txt` (`{{platform}}`→`${platform}`,
   `{{title}}`→`${title}`). Verify byte-identical to the `.txt` (minus its trailing
   newline). [`src/lib/llm/category-prompts.test.ts`](../src/lib/llm/category-prompts.test.ts)
   asserts every category wires a non-universal prompt.

## Reusable lessons

- **Amazon JP titles come back English-translated** — put an English→Japanese
  brand / line / model map *inside* the prompt so the keyword comes out Japanese.
- **Rakuten zeros out on over-specification** — keep the keyword tight
  (brand + line/model + type + size). Drop counts, marketing, colors. Write letter
  sizes in full form (`Mサイズ`, not bare `M`).
- **The free OpenRouter model is nondeterministic** — run each probe ~twice near
  the end; don't over-iterate chasing a flaky pass.
- **Know when it's not the keyword.** If the keyword already surfaces the correct
  product at rank #1 but `semanticMatch` returns `NO MATCH`, that's matcher-side.
  The dominant ceiling is `semanticMatch`'s hardcoded brand-equivalence map in
  `openrouter.ts` (it omits BabyBjörn, Graco, Cybex, Joie, ChuChu, Icreo, LEC,
  アロベビー, ヴェレダ, and more). Expanding that map is the highest-value
  follow-up — bigger than further keyword tuning.
