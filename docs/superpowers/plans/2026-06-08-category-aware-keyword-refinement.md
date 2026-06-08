# Category-aware Keyword Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single universal keyword-refinement prompt with an LLM-classified, per-category prompt map, empirically tuned so each baby product category's cross-platform match succeeds.

**Architecture:** `refineKeyword` first calls `classifyCategory(title)` (one LLM call → a frozen category enum or `'unknown'`), then runs that category's prompt from `CATEGORY_PROMPTS`, falling back to today's universal prompt for `'unknown'`/failure. The category taxonomy and each category's prompt are derived through a browser-driven empirical loop using a throwaway probe harness that exercises the real crawl → rank → semanticMatch pipeline.

**Tech Stack:** TypeScript, Next.js, Jest + ts-jest, OpenRouter LLM, Chrome DevTools MCP (browsing), scrape.do / Rakuten API crawlers.

---

## Notes for the executor

- The plan has two kinds of tasks: **code tasks** (TDD, full code given — Tasks 1, 3, 6) and **research tasks** (browser + judgment, concrete procedure + acceptance criteria given — Tasks 2, 4, 5). Research tasks cannot be unit-tested; their "done" is the recorded artifact and acceptance criteria.
- **Prerequisite:** `.env.local` must contain working `OPENROUTER_API_KEY` (+ optional `OPENROUTER_MODEL`) and the crawler keys (scrape.do token, Rakuten app id, `AMAZON_PARTNER_TAG`). Without them the probe harness returns empty results and prompts can't be judged. Verify before Task 2.
- Today's universal prompt body lives in `src/lib/llm/openrouter.ts:38-52`. We preserve it verbatim as the fallback.

---

## Task 1: Probe harness (throwaway research tool)

A Jest-invoked script that, given a source product and a candidate prompt file, runs the **real** pipeline (LLM keyword → target-platform crawl → `rankBySimilarity` → `semanticMatch`) and prints the keyword, the chosen match, and the full ranked candidate list for the agent to judge.

**Files:**
- Create: `scripts/probe-keyword.ts`
- Create: `scripts/prompts/universal.txt` (seed candidate prompt)

- [ ] **Step 1: Write the seed candidate prompt file**

Create `scripts/prompts/universal.txt` with today's prompt body, using `{{platform}}` and `{{title}}` placeholders:

```text
Extract a search keyword for {{platform}} Japan.
Keep in this priority order:
1. Brand name (e.g. パンパース, メリーズ, Ergobaby, 明治ほほえみ — keep full brand name)
2. Product line / model name — highest priority after brand, never drop it
   (e.g. さらさらケア, OMNI Breeze, らくらくキューブ, ハイハイン, ADAPT)
3. Product type (e.g. テープ, パンツ, 抱っこひも, 粉ミルク, 離乳食)
4. Size / weight / volume from the product name — critical, always keep
   (e.g. 新生児, Sサイズ, 5kgまで, 800g, 540g, 60袋)
   Do NOT invent stage/age from context — only use what is in the title itself.
5. Count only if it distinguishes the product (e.g. 84枚, 20袋)

Remove: colors, promotional text, order codes (B0xxx, CREGBCZ, ASIN), shop names, adjectives like 送料無料/新作/おすすめ/期間限定.
Output plain text only, max 8 words.

Title: {{title}}
```

- [ ] **Step 2: Write the harness**

Create `scripts/probe-keyword.ts`:

```ts
/**
 * Throwaway research harness for tuning per-category keyword prompts.
 *
 * Run:
 *   PROBE_FROM=rakuten \
 *   PROBE_TITLE='【送料無料】パンパース さらさらケア テープ 新生児 84枚' \
 *   PROBE_PRICE=1480 \
 *   PROBE_PROMPT=scripts/prompts/universal.txt \
 *   npx jest --config jest.config.ts --runInBand --testMatch '**/scripts/probe-keyword.ts'
 *
 * Inputs (env):
 *   PROBE_FROM   'rakuten' | 'amazon' — platform the SOURCE product is from (target is the other)
 *   PROBE_TITLE  source product title
 *   PROBE_PRICE  source price in yen (integer)
 *   PROBE_PROMPT path to candidate prompt file; supports {{platform}} and {{title}}
 */
import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local into process.env (no dotenv dependency). Existing env wins.
try {
  for (const line of readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local optional if env already set */ }

async function llm(content: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b:free',
      messages: [{ role: 'user', content }],
      max_tokens: 32768,
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = (await res.json()) as { choices: { message: { content: string | null } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

test('probe', async () => {
  const from = (process.env.PROBE_FROM ?? 'rakuten') as 'rakuten' | 'amazon'
  const target: 'amazon' | 'rakuten' = from === 'rakuten' ? 'amazon' : 'rakuten'
  const title = process.env.PROBE_TITLE ?? ''
  const price = Number(process.env.PROBE_PRICE ?? '0')
  const promptTemplate = readFileSync(process.env.PROBE_PROMPT!, 'utf8')

  const { crawlAmazonSearch } = await import('@/lib/crawlers/amazon')
  const { crawlRakutenSearch } = await import('@/lib/crawlers/rakuten')
  const { rankBySimilarity } = await import('@/lib/matching/rank')
  const { semanticMatch } = await import('@/lib/llm/openrouter')
  const { ProductResult } = await import('@/lib/types')
  void ProductResult // type-only import guard for ts-jest

  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const prompt = promptTemplate
    .replace(/\{\{platform\}\}/g, target)
    .replace(/\{\{title\}\}/g, cleanTitle)

  const keyword = await llm(prompt)
  console.log('\n=== KEYWORD ===\n' + keyword)

  const results =
    target === 'amazon'
      ? await crawlAmazonSearch(keyword).catch(() => [])
      : await crawlRakutenSearch(keyword).catch(() => [])

  const source = {
    platform: from, title, imageUrl: '', shopName: '', salePrice: price,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: price, subscribeAvailable: false, rakutenCardEligible: true,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  } as unknown as import('@/lib/types').ProductResult

  const ranked = rankBySimilarity(source, results)
  console.log('\n=== RANKED CANDIDATES (top 10) ===')
  ranked.slice(0, 10).forEach((r, i) => console.log(`${i}: ¥${r.effectivePrice} ${r.title}`))

  const idx = await semanticMatch(source, ranked).catch(() => null)
  console.log('\n=== SEMANTIC MATCH ===')
  console.log(idx === null ? 'NO MATCH' : `${idx}: ¥${ranked[idx].effectivePrice} ${ranked[idx].title}`)
  console.log('=== END ===\n')

  expect(true).toBe(true) // harness always "passes"; the agent reads the log
}, 180000)
```

- [ ] **Step 3: Smoke-test the harness on one known product**

Run (replace with a real Rakuten product you can see in a browser):

```bash
PROBE_FROM=rakuten \
PROBE_TITLE='【送料無料】パンパース さらさらケア テープ 新生児 84枚' \
PROBE_PRICE=1480 \
PROBE_PROMPT=scripts/prompts/universal.txt \
npx jest --config jest.config.ts --runInBand --testMatch '**/scripts/probe-keyword.ts'
```

Expected: log prints a `=== KEYWORD ===` line, a non-empty `=== RANKED CANDIDATES ===` list, and a `=== SEMANTIC MATCH ===` line. If candidates are empty, fix env/crawler keys before continuing — the loop is blind without them.

- [ ] **Step 4: Ensure the harness is excluded from the normal test run**

Add `scripts/` to `testPathIgnorePatterns` so `npm test` never runs the network harness. In `jest.config.ts`, inside the config object:

```ts
  testPathIgnorePatterns: ['/node_modules/', '/scripts/'],
```

Run `npm test` and confirm the probe does NOT execute (no `=== KEYWORD ===` output) and existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/probe-keyword.ts scripts/prompts/universal.txt jest.config.ts
git commit -m "chore: add throwaway keyword-prompt probe harness"
```

---

## Task 2: Phase A — Discover category taxonomy (research)

Enumerate the baby sub-categories both platforms expose and reconcile into one frozen list that becomes the `Category` enum.

**Files:**
- Create: `scripts/taxonomy.md` (scratch record of findings — not shipped code)

- [ ] **Step 1: Browse Amazon JP baby tree**

Using Chrome DevTools MCP, navigate to Amazon JP `ベビー&マタニティ` department and list its left-nav sub-categories. Record the sub-category names (Japanese + English gloss) in `scripts/taxonomy.md` under an `## Amazon` heading.

- [ ] **Step 2: Browse Rakuten baby tree**

Navigate to Rakuten `ベビー・キッズ・マタニティ` genre and list its sub-genres. Record under `## Rakuten` in `scripts/taxonomy.md`.

- [ ] **Step 3: Reconcile into one taxonomy**

Merge overlapping categories into a single snake_case key list. Drop categories the app is unlikely to receive (e.g. maternity clothing) unless both sites prominently expose them. Record the final list under `## Frozen taxonomy` in `scripts/taxonomy.md`, each as `key — JP label — English gloss`.

**Acceptance criteria:** `scripts/taxonomy.md` contains a `## Frozen taxonomy` section with ≥6 snake_case keys, each present in (or cleanly reconciled across) both platforms. Candidate baseline to expect: `diapers`, `formula`, `baby_food`, `carriers`, `strollers`, `wipes` (plus any others discovered, e.g. `bottles`, `skincare`).

- [ ] **Step 4: Commit**

```bash
git add scripts/taxonomy.md
git commit -m "docs: discovered baby category taxonomy from Amazon JP + Rakuten"
```

---

## Task 3: Scaffold category-aware refineKeyword (TDD)

Add the `Category` type, `classifyCategory`, the `CATEGORY_PROMPTS` map (every entry initialized to the universal prompt — zero behavior change yet), and rewire `refineKeyword` to classify → dispatch → fallback.

**Files:**
- Modify: `src/lib/llm/openrouter.ts:27-58` (and add new exports above `refineKeyword`)
- Test: `src/lib/llm/openrouter.test.ts`

- [ ] **Step 1: Write failing tests for classifyCategory dispatch and fallback**

Add to `src/lib/llm/openrouter.test.ts` a new describe block. (Uses `mockResolvedValueOnce` to sequence the two calls refineKeyword now makes: classify, then refine.)

```ts
import { refineKeyword, semanticMatch, classifyCategory } from './openrouter'

const llmReply = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
})

describe('classifyCategory', () => {
  it('returns a known category id when the LLM names one', async () => {
    mockFetch.mockResolvedValue(llmReply('diapers'))
    expect(await classifyCategory('パンパース テープ Sサイズ 108枚')).toBe('diapers')
  })

  it('returns "unknown" when the LLM names a non-category', async () => {
    mockFetch.mockResolvedValue(llmReply('something-else'))
    expect(await classifyCategory('謎の商品')).toBe('unknown')
  })

  it('returns "unknown" when the LLM call fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await classifyCategory('パンパース テープ')).toBe('unknown')
  })
})

describe('refineKeyword dispatch', () => {
  it('uses the classified category prompt, returning the refine reply', async () => {
    // 1st call = classify, 2nd call = refine
    mockFetch
      .mockResolvedValueOnce(llmReply('diapers'))
      .mockResolvedValueOnce(llmReply('パンパース さらさらケア テープ 新生児'))
    const result = await refineKeyword('【送料無料】パンパース さらさらケア テープ 新生児 84枚', 'amazon')
    expect(result).toBe('パンパース さらさらケア テープ 新生児')
  })

  it('falls back to universal prompt when category is unknown (still returns refine reply)', async () => {
    mockFetch
      .mockResolvedValueOnce(llmReply('unknown'))
      .mockResolvedValueOnce(llmReply('和光堂 グーグーキッチン 12ヶ月'))
    const result = await refineKeyword('和光堂 グーグーキッチン 12ヶ月頃から', 'rakuten')
    expect(result).toBe('和光堂 グーグーキッチン 12ヶ月')
  })
})
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest src/lib/llm/openrouter.test.ts -t "classifyCategory" --config jest.config.ts`
Expected: FAIL — `classifyCategory is not a function` (not yet exported).

- [ ] **Step 3: Implement the scaffold in openrouter.ts**

In `src/lib/llm/openrouter.ts`, ADD (above the existing `refineKeyword`, after `callLLM`):

```ts
// Category taxonomy — FROZEN from Task 2 discovery (scripts/taxonomy.md).
// Replace this baseline with the exact keys from the discovered taxonomy.
export type Category =
  | 'diapers'
  | 'formula'
  | 'baby_food'
  | 'carriers'
  | 'strollers'
  | 'wipes'

const CATEGORIES: readonly Category[] = [
  'diapers', 'formula', 'baby_food', 'carriers', 'strollers', 'wipes',
]

type PromptBuilder = (platform: string, title: string) => string

// Today's prompt, preserved verbatim as the fallback for unknown/low-confidence titles.
const UNIVERSAL_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan.
Keep in this priority order:
1. Brand name (e.g. パンパース, メリーズ, Ergobaby, 明治ほほえみ — keep full brand name)
2. Product line / model name — highest priority after brand, never drop it
   (e.g. さらさらケア, OMNI Breeze, らくらくキューブ, ハイハイン, ADAPT)
3. Product type (e.g. テープ, パンツ, 抱っこひも, 粉ミルク, 離乳食)
4. Size / weight / volume from the product name — critical, always keep
   (e.g. 新生児, Sサイズ, 5kgまで, 800g, 540g, 60袋)
   Do NOT invent stage/age from context — only use what is in the title itself.
5. Count only if it distinguishes the product (e.g. 84枚, 20袋)

Remove: colors, promotional text, order codes (B0xxx, CREGBCZ, ASIN), shop names, adjectives like 送料無料/新作/おすすめ/期間限定.
Output plain text only, max 8 words.

Title: ${title}`

// Per-category prompts. Each starts as UNIVERSAL_PROMPT and is replaced with a
// tuned builder in Task 4 (the empirical loop). Keys MUST match CATEGORIES.
const CATEGORY_PROMPTS: Record<Category, PromptBuilder> = {
  diapers: UNIVERSAL_PROMPT,
  formula: UNIVERSAL_PROMPT,
  baby_food: UNIVERSAL_PROMPT,
  carriers: UNIVERSAL_PROMPT,
  strollers: UNIVERSAL_PROMPT,
  wipes: UNIVERSAL_PROMPT,
}

export async function classifyCategory(title: string): Promise<Category | 'unknown'> {
  try {
    const result = await callLLM([{
      role: 'user',
      content: `Classify this Japanese baby product into exactly one category id.
Category ids: ${CATEGORIES.join(', ')}
Output ONLY the id, or "unknown" if none fit. No other text.

Title: ${title}`,
    }])
    const id = result.trim().toLowerCase()
    return (CATEGORIES as readonly string[]).includes(id) ? (id as Category) : 'unknown'
  } catch {
    return 'unknown'
  }
}
```

Then REPLACE the body of `refineKeyword` (currently `src/lib/llm/openrouter.ts:34-57`) with:

```ts
  // Strip supplementary bracket annotations before LLM sees the title.
  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const category = await classifyCategory(cleanTitle)
  const buildPrompt = category === 'unknown' ? UNIVERSAL_PROMPT : CATEGORY_PROMPTS[category]
  try {
    const result = await callLLM([{ role: 'user', content: buildPrompt(targetPlatform, cleanTitle) }])
    return result || stripBrackets(title)
  } catch {
    return stripBrackets(title)
  }
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest src/lib/llm/openrouter.test.ts --config jest.config.ts`
Expected: PASS — all `classifyCategory`, `refineKeyword dispatch`, existing `refineKeyword`, and `semanticMatch` tests green. (Existing `refineKeyword` tests still pass because their `mockResolvedValue` answers both the classify and refine calls; a non-category classify reply → `unknown` → universal prompt → same keyword as before.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat: classify product category and dispatch per-category keyword prompt (universal fallback)"
```

---

## Task 4: Reconcile the enum with the discovered taxonomy

If Task 2 discovered categories beyond the baseline 6, widen the enum/map so every discovered key exists (still pointing at `UNIVERSAL_PROMPT` until tuned).

**Files:**
- Modify: `src/lib/llm/openrouter.ts` (the `Category` type, `CATEGORIES`, `CATEGORY_PROMPTS`)

- [ ] **Step 1: Align keys**

For each key in `scripts/taxonomy.md` → `## Frozen taxonomy` that is NOT already in `CATEGORIES`: add it to the `Category` union, the `CATEGORIES` array, and add a `CATEGORY_PROMPTS` entry `=> UNIVERSAL_PROMPT`. Remove any baseline key the taxonomy rejected.

- [ ] **Step 2: Type-check and test**

Run: `npx tsc --noEmit && npx jest src/lib/llm/openrouter.test.ts --config jest.config.ts`
Expected: no type errors (the `Record<Category, PromptBuilder>` map forces every key to exist), tests pass. If a test referenced a removed/renamed category id, update it to a still-valid id.

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat: align category enum with discovered taxonomy"
```

---

## Task 5: Phase B — Empirical per-category prompt tuning (research)

**Repeat this entire task once per category** in `CATEGORIES`. It cannot be a unit test — it is a browse + judge + iterate loop driven by the probe harness from Task 1.

**Files (per category):**
- Create: `scripts/prompts/<category>.txt` (the tuned candidate prompt)
- Modify: `src/lib/llm/openrouter.ts` (set `CATEGORY_PROMPTS[<category>]` to a builder containing the tuned prompt)

- [ ] **Step 1: Collect ≥10 products per platform for the category**

Using Chrome DevTools MCP, browse the category on BOTH Amazon JP and Rakuten. Record ≥10 products per platform (title + price + visible product-page URL) in a scratch list. Aim for variety across the dimension that matters for this category (diapers: size/type; formula: stage/can-size; carriers: model; etc.).

- [ ] **Step 2: For each source product, identify its true cross-platform equivalent by inspection**

For a source product on platform A, find the genuinely-equivalent product on platform B by browsing (same brand / line / type / size). Note its title — this is the ground truth the pipeline must return.

- [ ] **Step 3: Create the category candidate prompt file**

Copy `scripts/prompts/universal.txt` to `scripts/prompts/<category>.txt`. Edit it to emphasize the dimensions that distinguish THIS category (e.g. for `carriers`: prioritize model name + supported-weight range, drop count rules; for `baby_food`: prioritize age stage + flavor line). Keep `{{platform}}`/`{{title}}` placeholders.

- [ ] **Step 4: Run the probe for each source product**

For each source product:

```bash
PROBE_FROM=<rakuten|amazon> \
PROBE_TITLE='<source title>' \
PROBE_PRICE=<yen> \
PROBE_PROMPT=scripts/prompts/<category>.txt \
npx jest --config jest.config.ts --runInBand --testMatch '**/scripts/probe-keyword.ts'
```

Read the `=== SEMANTIC MATCH ===` line. **Pass** = it returns the true equivalent from Step 2. **Fail** = NO MATCH or a wrong product.

- [ ] **Step 5: Iterate the prompt on failures (≥3 attempts)**

If any source product fails, diagnose from the log: was the `=== KEYWORD ===` too broad/narrow, did it drop the distinguishing dimension, or surface the wrong family? Edit `scripts/prompts/<category>.txt` and re-run Step 4. Iterate **at least 3 attempts** before accepting the best-performing prompt. Record per-attempt pass counts in `scripts/taxonomy.md` under a `## <category> tuning` heading.

**Acceptance criteria:** The chosen prompt yields the correct end-to-end match for a strict majority of the category's source products (target ≥7/10), with ≥3 iterations attempted and logged. If a category plateaus below that after honest iteration, record why (e.g. crawler coverage gap, not a prompt problem) — do not fabricate a pass.

- [ ] **Step 6: Bake the tuned prompt into CATEGORY_PROMPTS**

In `src/lib/llm/openrouter.ts`, replace `CATEGORY_PROMPTS.<category>` with a `PromptBuilder` whose body is the final `scripts/prompts/<category>.txt` content (substitute `{{platform}}` → `${platform}` and `{{title}}` → `${title}` in a template literal). Example shape:

```ts
const DIAPERS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan.
<the tuned diapers prompt body…>
Title: ${title}`

const CATEGORY_PROMPTS: Record<Category, PromptBuilder> = {
  diapers: DIAPERS_PROMPT,
  // …others…
}
```

- [ ] **Step 7: Verify the baked prompt matches the file**

Re-run the probe for one previously-passing source product of this category (Step 4 command). Confirm the `=== KEYWORD ===` output matches what the file produced. Run `npx jest src/lib/llm/openrouter.test.ts --config jest.config.ts` — existing tests still green.

- [ ] **Step 8: Commit (per category)**

```bash
git add src/lib/llm/openrouter.ts scripts/prompts/<category>.txt scripts/taxonomy.md
git commit -m "feat(<category>): empirically tuned keyword prompt"
```

---

## Task 6: Finalize and clean up

**Files:**
- Modify: `src/lib/llm/openrouter.test.ts`
- Delete (optional): `scripts/` harness

- [ ] **Step 1: Add a regression test per tuned category (mocked)**

For each category, add a test asserting the dispatch picks that category and returns its refine reply (proves the map wiring, not the prompt quality):

```ts
describe('refineKeyword per-category wiring', () => {
  it.each([
    ['diapers', 'パンパース テープ 新生児', 'パンパース テープ 新生児'],
    // add one row per category in CATEGORIES, with a representative title + expected keyword
  ])('dispatches %s', async (category, title, keyword) => {
    mockFetch.mockResolvedValueOnce(llmReply(category)).mockResolvedValueOnce(llmReply(keyword))
    expect(await refineKeyword(title, 'amazon')).toBe(keyword)
  })
})
```

- [ ] **Step 2: Full verification**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors. Confirm `npm test` does NOT trigger the network probe (Task 1 Step 4 ignore-pattern).

- [ ] **Step 3: Decide on harness retention**

The probe harness made real network calls and is not part of the product. Either delete it or keep it for future tuning. If keeping, ensure it stays in `testPathIgnorePatterns`. If deleting:

```bash
git rm -r scripts/probe-keyword.ts scripts/prompts
git commit -m "chore: remove keyword-prompt probe harness after tuning"
```

(Keep `scripts/taxonomy.md` either way — it documents the derived map.)

- [ ] **Step 4: Final commit**

```bash
git add src/lib/llm/openrouter.test.ts
git commit -m "test: per-category refineKeyword dispatch regression tests"
```

---

## Self-review notes

- **Spec coverage:** LLM classification dispatch (Task 3), full empirical loop (Tasks 2+5), taxonomy discovered from sites (Task 2, frozen into enum in Tasks 3–4), end-to-end success signal via real semanticMatch (Task 1 harness + Task 5 judging), deliverable = classifier + `CATEGORY_PROMPTS` + universal fallback (Tasks 3–6). No separate map doc shipped (taxonomy.md is research scratch); no shipped eval harness (probe is throwaway) — matches spec's out-of-scope.
- **Signatures consistent:** `classifyCategory(title): Promise<Category|'unknown'>`, `PromptBuilder = (platform, title) => string`, `CATEGORY_PROMPTS: Record<Category, PromptBuilder>`, `refineKeyword(title, targetPlatform)` unchanged — used identically across Tasks 1, 3, 4, 5, 6.
- **Risk:** prompt quality depends on live crawler/LLM keys (flagged in prerequisites) and on crawler recall (Task 5 Step 5 distinguishes prompt failure from coverage gap).
