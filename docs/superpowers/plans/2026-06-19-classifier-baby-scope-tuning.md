# Classifier + Baby-Scope Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the baby-scope search gate from rejecting real baby products (e.g. 和光堂 はいはい / レーベンスミルク) by replacing keyword pre-judging with Rakuten-genre result filtering, and make `classifyLocal` order-independent and measurable.

**Architecture:** Four layers. (1) Lexicon patch unblocks the bug immediately. (2) A scored lexicon replaces first-match-wins in `classifyLocal`. (3) The search route stops gating on `isBabyQuery` and instead filters Rakuten results to a curated baby-genre allow-set; the lookup route resolves a JAN slug against our products DB. (4) An eval harness + fixtures lock judgments against regression.

**Tech Stack:** Next.js 16 App Router, TypeScript, Jest 29, Neon Postgres (`pg`), Rakuten Ichiba API.

## Global Constraints

- Price arithmetic always `floor()`, never `round()`.
- Rakuten genre fallback must never include `"0"` (all-genres) as a *kept* result genre — it leaks non-baby items.
- `BABY_GENRE_IDS` must EXCLUDE the broad `100533` (キッズ・ベビー・マタニティ) — it contains 出産内祝い coffee/sweets gift sets (Amazon-compliance precision).
- Do not scrape Amazon or display Amazon price/image; this work does not touch the Amazon link-only model.
- All amounts are strings of digits compared as strings (`item.genreId` is stringified via `String(...)`).
- Tests run with `npx jest <path>`; harvest/eval scripts run with `node --env-file=.env.local node_modules/.bin/tsx <path>` and `USE_UNPOOLED=1`.

---

## Task 1: Lexicon patch — unblock the は​いはい bug

**Files:**
- Modify: `src/lib/jan/classify-local.ts:10` (the `formula` rule)
- Modify: `src/lib/platforms/rakuten.ts` (`getGenreId` GENRE_MAP, the `粉ミルク` entry)
- Create: `src/lib/search/baby-scope.test.ts`

**Interfaces:**
- Consumes: `isBabyQuery(keyword: string): boolean` (from `src/lib/search/baby-scope.ts`), `classifyLocal`, `getGenreId`.
- Produces: nothing new; behavior change only (these terms now classify as `formula` / genre `401171`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/search/baby-scope.test.ts`:

```ts
import { isBabyQuery } from './baby-scope'

describe('isBabyQuery — formula brand-lines (regression: 和光堂 はいはい was rejected)', () => {
  it.each([
    'はいはい',
    '和光堂 はいはい',
    'レーベンスミルク',
    '和光堂 レーベンスミルク はいはい',
  ])('treats %s as a baby query', (kw) => {
    expect(isBabyQuery(kw)).toBe(true)
  })

  it.each(['コーヒー', 'ノートパソコン', '日本酒'])('treats off-topic %s as non-baby', (kw) => {
    expect(isBabyQuery(kw)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/search/baby-scope.test.ts`
Expected: FAIL — the four formula terms return `false` (off-topic cases already pass).

- [ ] **Step 3: Add the formula lines to classifyLocal**

In `src/lib/jan/classify-local.ts`, the `formula` rule (line 10) currently is:

```ts
  ['formula',   /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク/],
```

Replace with (adds 和光堂's lines; keeps everything else):

```ts
  ['formula',   /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク|はいはい|レーベンスミルク|ぴゅあ|ごくごく/],
```

- [ ] **Step 4: Add the same lines to getGenreId's 粉ミルク key**

In `src/lib/platforms/rakuten.ts`, the GENRE_MAP entry:

```ts
  [/粉ミルク/,                                                             "401171"], // 粉ミルク
```

Replace with:

```ts
  [/粉ミルク|はいはい|レーベンスミルク|ぴゅあ|ごくごく/,                       "401171"], // 粉ミルク (incl. 和光堂 brand-lines)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest src/lib/search/baby-scope.test.ts src/lib/platforms/rakuten.test.ts`
Expected: PASS for baby-scope; rakuten.test.ts unchanged (still the 3 known pre-existing 490-vs-700 shipping failures, none in `getGenreId`). Confirm no NEW failures in `getGenreId` tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/jan/classify-local.ts src/lib/platforms/rakuten.ts src/lib/search/baby-scope.test.ts
git commit -m "fix(baby-scope): recognize 和光堂 formula lines (はいはい/レーベンスミルク)"
```

---

## Task 2: Eval harness — measure classifyLocal before changing it

Build the measurement first so Task 4's redesign is provably non-regressing.

**Files:**
- Create: `scripts/eval/classify-eval.ts`
- Create: `src/lib/search/baby-scope.fixtures.ts`

**Interfaces:**
- Consumes: `classifyLocal(title: string): Category | 'unknown'`, `query`/`pool` from `src/lib/db`.
- Produces: `BABY_KEYWORD_FIXTURES: ReadonlyArray<{ keyword: string; baby: boolean }>` (consumed by Task 3 + Task 5 tests).

- [ ] **Step 1: Create the keyword fixture set**

Create `src/lib/search/baby-scope.fixtures.ts`:

```ts
// Labeled keyword fixtures for the baby-scope gate. baby=true must pass isBabyQuery;
// baby=false must be rejected. Add real-world misses here as they are discovered.
export const BABY_KEYWORD_FIXTURES: ReadonlyArray<{ keyword: string; baby: boolean }> = [
  { keyword: 'はいはい', baby: true },
  { keyword: '和光堂 はいはい', baby: true },
  { keyword: 'レーベンスミルク', baby: true },
  { keyword: 'ほほえみ', baby: true },
  { keyword: 'パンパース テープ M', baby: true },
  { keyword: 'メリーズ おしりふき', baby: true },
  { keyword: '哺乳瓶', baby: true },
  { keyword: '離乳食', baby: true },
  { keyword: 'コーヒー', baby: false },
  { keyword: 'ノートパソコン', baby: false },
  { keyword: '日本酒', baby: false },
  { keyword: '出産内祝い コーヒー', baby: false },
]
```

- [ ] **Step 2: Write the eval script**

Create `scripts/eval/classify-eval.ts`:

```ts
process.env.USE_UNPOOLED = '1'
/**
 * Eval classifyLocal precision/recall against harvested products (label = stored category).
 * Free, no crawl. Run: node --env-file=.env.local node_modules/.bin/tsx scripts/eval/classify-eval.ts
 */
import { query, pool } from '../../src/lib/db'
import { classifyLocal } from '../../src/lib/jan/classify-local'

async function main() {
  const rows = await query<{ title: string; category: string }>(
    `SELECT title, category FROM products WHERE category IS NOT NULL AND category <> 'unknown'`)
  const cats = [...new Set(rows.map((r) => r.category))].sort()
  const stat: Record<string, { tp: number; fp: number; fn: number }> = {}
  for (const c of cats) stat[c] = { tp: 0, fp: 0, fn: 0 }
  let correct = 0
  for (const r of rows) {
    const pred = classifyLocal(r.title)
    if (pred === r.category) { correct++; stat[r.category].tp++ }
    else {
      stat[r.category].fn++
      if (stat[pred]) stat[pred].fp++
    }
  }
  console.log(`overall accuracy: ${correct}/${rows.length} = ${(100 * correct / rows.length).toFixed(1)}%`)
  console.log('category\tprecision\trecall\tn')
  for (const c of cats) {
    const { tp, fp, fn } = stat[c]
    const prec = tp + fp ? tp / (tp + fp) : 0
    const rec = tp + fn ? tp / (tp + fn) : 0
    console.log(`${c}\t${(100 * prec).toFixed(1)}%\t${(100 * rec).toFixed(1)}%\t${tp + fn}`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Run the eval to capture the baseline**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/eval/classify-eval.ts`
Expected: prints overall accuracy + per-category precision/recall. Record the overall accuracy number in the commit message as the baseline Task 4 must not regress below.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval/classify-eval.ts src/lib/search/baby-scope.fixtures.ts
git commit -m "test(classify): eval harness + baby-scope keyword fixtures (baseline)"
```

---

## Task 3: Gate redesign — search-then-filter by baby genre

Replace the `isBabyQuery` keyword pre-gate in the search route with Rakuten-genre result filtering.

**Files:**
- Modify: `src/lib/platforms/rakuten.ts` (add `BABY_GENRE_IDS`; filter in `searchRakutenKeyword`)
- Modify: `src/app/api/search/route.ts` (drop the `isBabyQuery` pre-gate; bump cache prefix)
- Create: `src/lib/platforms/rakuten-genre.test.ts`

**Interfaces:**
- Consumes: `searchRakuten(keyword)`, `parseRakutenItem`, `RawRakutenItem` (has `genreId?: string`).
- Produces: `BABY_GENRE_IDS: ReadonlySet<string>` (exported for Task 5 test).

- [ ] **Step 1: Write the failing genre-filter test**

Create `src/lib/platforms/rakuten-genre.test.ts`:

```ts
import { BABY_GENRE_IDS, isBabyGenre } from './rakuten'

describe('BABY_GENRE_IDS allow-set', () => {
  it('includes specific baby genres', () => {
    expect(BABY_GENRE_IDS.has('401171')).toBe(true) // 粉ミルク
    expect(BABY_GENRE_IDS.has('205197')).toBe(true) // おむつ
  })
  it('excludes the broad gift-leaking genres', () => {
    expect(BABY_GENRE_IDS.has('100533')).toBe(false)
    expect(BABY_GENRE_IDS.has('0')).toBe(false)
  })
  it('isBabyGenre handles numeric and missing ids', () => {
    expect(isBabyGenre(401171)).toBe(true)
    expect(isBabyGenre('100533')).toBe(false)
    expect(isBabyGenre(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/platforms/rakuten-genre.test.ts`
Expected: FAIL — `BABY_GENRE_IDS`/`isBabyGenre` not exported yet.

- [ ] **Step 3: Add the allow-set + helper to rakuten.ts**

In `src/lib/platforms/rakuten.ts`, after the `GENRE_MAP` definition add:

```ts
// Specific baby genres only — the authoritative precision signal for search results.
// EXCLUDES the broad 100533 (キッズ・ベビー・マタニティ, which contains 出産内祝い gift
// coffee/sweets) and "0" (all-genres). Values are the specific GENRE_MAP genres plus
// the food genres used for reduced-tax baby consumables.
export const BABY_GENRE_IDS: ReadonlySet<string> = new Set<string>([
  '205197', // おむつ
  '205194', // おしりふき
  '205208', // 哺乳びん・授乳用品
  '401171', // 粉ミルク
  '568293', // 液体ミルク
  '213980', // 離乳食・ベビーフード
  '204417', // (food genre, reduced tax)
  '207753', // ストローマグ
  '207750', // ベビー食器
  '407002', // スタイ・お食事エプロン
  '200833', // ベビーカー
  '566089', // 抱っこひも・スリング
  '566088', // チャイルドシート
  '551691', // 歯ブラシ・虫歯ケア
  '205205', // ベビーローション・オイル
  '401166', // 日焼け止め
  '201591', // ベビー向けおもちゃ
  '566090', // ベビー用インテリア
  '213968', // バウンサー
  '566882', // ベビーチェア
])

export function isBabyGenre(genreId: string | number | undefined | null): boolean {
  if (genreId == null) return false
  return BABY_GENRE_IDS.has(String(genreId))
}
```

- [ ] **Step 4: Run the genre test to verify it passes**

Run: `npx jest src/lib/platforms/rakuten-genre.test.ts`
Expected: PASS.

- [ ] **Step 5: Filter search results by baby genre**

In `src/lib/platforms/rakuten.ts`, `searchRakutenKeyword`, the items are built as:

```ts
    const filtered = (data.Items ?? [])
      .filter(({ Item }) => !isTrialOrSamplePack(Item.itemName ?? ""))
      .map(({ Item }) => parseRakutenItem(Item, affiliateId));
    if (filtered.length > 0) return filtered;
```

Replace with (drop non-baby-genre items using the raw `Item.genreId` before mapping):

```ts
    const filtered = (data.Items ?? [])
      .filter(({ Item }) => !isTrialOrSamplePack(Item.itemName ?? ""))
      .filter(({ Item }) => isBabyGenre(Item.genreId)) // authoritative baby-scope filter
      .map(({ Item }) => parseRakutenItem(Item, affiliateId));
    if (filtered.length > 0) return filtered;
```

- [ ] **Step 6: Drop the isBabyQuery pre-gate in the search route**

In `src/app/api/search/route.ts`, replace the gated block (lines ~45–56):

```ts
  const [rakutenResults, amazonResults] = isBabyQuery(query)
    ? await Promise.all([
        crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
        amazonFromDb(query),
      ])
    : [[] as ProductResult[], [] as ProductResult[]]
```

with (always search; Rakuten results are now genre-filtered, so off-topic queries return empty and the UI shows the baby-only empty state):

```ts
  const [rakutenResults, amazonResults] = await Promise.all([
    crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
    amazonFromDb(query),
  ])
```

Remove the now-unused import: delete `import { isBabyQuery } from '@/lib/search/baby-scope'`.
Bump the cache prefix on line 35 from `kw6:` to `kw7:` (response semantics changed):

```ts
  const cacheKey = makeCacheKey(`kw7:${query}`)
```

- [ ] **Step 7: Run the full suite**

Run: `npx jest`
Expected: all green except the 3 known pre-existing rakuten shipping failures (490 vs 700). No new failures. `tsc` clean (`npx tsc --noEmit`).

- [ ] **Step 8: Commit**

```bash
git add src/lib/platforms/rakuten.ts src/lib/platforms/rakuten-genre.test.ts src/app/api/search/route.ts
git commit -m "fix(search): filter Rakuten results by baby-genre allow-set instead of gating keywords"
```

---

## Task 4: Classifier redesign — scored lexicon (order-independent)

Replace first-match-wins with a scored lexicon so bucketing no longer depends on rule order.

**Files:**
- Create: `src/lib/jan/lexicon.ts`
- Modify: `src/lib/jan/classify-local.ts` (rewrite the function body; keep signature)
- Create: `src/lib/jan/classify-local.test.ts`

**Interfaces:**
- Consumes: `Category` from `src/lib/llm/category-prompts`.
- Produces: `classifyLocal(title: string): Category | 'unknown'` (unchanged signature); `LEXICON: ReadonlyArray<{ category: Category; tokens: RegExp; weight: number }>`.

- [ ] **Step 1: Write failing tests for order-independence + scoring**

Create `src/lib/jan/classify-local.test.ts`:

```ts
import { classifyLocal } from './classify-local'

describe('classifyLocal scored lexicon', () => {
  it('formula brand-lines win', () => {
    expect(classifyLocal('和光堂 レーベンスミルク はいはい 810g×8缶')).toBe('formula')
  })
  it('weaning dish with 離乳食 word still classifies as tableware (specificity beats baby_food)', () => {
    expect(classifyLocal('ベビー食器 離乳食 スプーン セット')).toBe('tableware')
  })
  it('diaper brand without the word おむつ', () => {
    expect(classifyLocal('メリーズ パンツ Mサイズ 58枚')).toBe('diapers')
  })
  it('unrelated text → unknown', () => {
    expect(classifyLocal('ノートパソコン 15インチ')).toBe('unknown')
  })
})
```

- [ ] **Step 2: Run tests to verify the new behavioral cases fail or are unverified**

Run: `npx jest src/lib/jan/classify-local.test.ts`
Expected: passes today by luck of ordering EXCEPT this is the safety net for the rewrite. Note current results; the rewrite (Step 3–4) must keep all four green.

- [ ] **Step 3: Create the weighted lexicon**

Create `src/lib/jan/lexicon.ts` (migrate every regex from the current `RULES`; `weight` encodes specificity — higher wins ties; specific noun/brand tokens are 3, broad category words 1):

```ts
import { type Category } from '../llm/category-prompts'

// One entry per (category, token-group). Score = sum of weights of matching groups;
// the highest-scoring category above THRESHOLD wins. Order does NOT matter — specificity
// is expressed by `weight`, replacing the old first-match-wins ordering.
export const LEXICON: ReadonlyArray<{ category: Category; tokens: RegExp; weight: number }> = [
  { category: 'wipes', tokens: /おしりふき|お尻ふき|おしり拭き|お尻拭き|手口ふき|ウェットティッシュ|ウエットティッシュ|純水.*ふき/, weight: 3 },
  { category: 'formula', tokens: /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク|はいはい|レーベンスミルク|ぴゅあ|ごくごく/, weight: 3 },
  { category: 'tableware', tokens: /ベビー食器|お食事プレート|ランチプレート|ベビープレート|お食事ボウル|離乳食用.*(食器|スプーン|皿)/, weight: 4 },
  { category: 'baby_food', tokens: /離乳食|ベビーフード|ハイハイン|グーグーキッチン|赤ちゃん.*おやつ|ベビーおやつ|幼児.*おやつ|手づかみ|きほんのだし|ベビーだし|お米.*(パンケーキ|せんべい|パン)|ボーロ|ウエハース|赤ちゃん.*せんべい|幼児.*飲料/, weight: 3 },
  { category: 'bottles', tokens: /哺乳瓶|哺乳びん|乳首|ニップル|ストローマグ|マグマグ|コップマグ|ベビーマグ|ラクマグ|レッスンマグ|スパウト|搾乳|授乳クッション/, weight: 3 },
  { category: 'skincare', tokens: /ベビーローション|ベビークリーム|ベビーオイル|ベビーパウダー|保湿|日焼け止め|UVケア|UVミルク|UVクリーム|UV.*(クリーム|ジェル)|スキンケア|ヒルマイルド/, weight: 3 },
  { category: 'bath', tokens: /ベビーソープ|ベビーシャンプー|沐浴|ベビーバス|入浴剤|泡ソープ|ボディソープ|全身ソープ/, weight: 3 },
  { category: 'toothbrush', tokens: /歯ブラシ|ハブラシ|歯刷子/, weight: 3 },
  { category: 'toothpaste', tokens: /歯みがき|歯磨き|ハミガキ|ジェル状歯|歯みがきジェル|歯磨きジェル/, weight: 3 },
  { category: 'bibs', tokens: /スタイ|よだれかけ|お食事エプロン|食事用エプロン/, weight: 3 },
  { category: 'baby_chair', tokens: /ベビーチェア|ハイチェア|ローチェア|お食事チェア|バンボ|チェアベルト|テーブルチェア/, weight: 3 },
  { category: 'bouncer', tokens: /バウンサー|ベビーラック|電動ラック|ベビースウィング|電動.*ゆりかご|ハイローチェア|ハイローラック/, weight: 3 },
  { category: 'toys', tokens: /おもちゃ(?!付)|乗用玩具|ベビージム|プレイジム|ガラガラ|ラトル|歯固め|オルゴールメリー|ベビーメリー|回転メリー|知育玩具|にぎにぎ|布絵本/, weight: 3 },
  { category: 'nasal_aspirator', tokens: /鼻吸い器|鼻水吸引|電動鼻吸|手動鼻吸|メルシーポット|ベビースマイル.*鼻|鼻吸引器/, weight: 3 },
  { category: 'thermometer', tokens: /体温計(?!カバー|ケース|入れ)|検温(?!カバー)|耳式体温|非接触.*体温/, weight: 3 },
  { category: 'safety_gate', tokens: /ベビーゲート|安全ゲート|セーフティゲート|ベビーフェンス|階段ゲート|ドアゲート|オートゲート/, weight: 3 },
  { category: 'playmat', tokens: /プレイマット|ジョイントマット|ベビーマット|フロアマット.*ベビー|ベビー.*フロアマット|おくだけマット/, weight: 3 },
  { category: 'carriers', tokens: /抱っこ紐|抱っこひも|抱っこ補助|ベビーキャリア|スリング|ヒップシート|おんぶ紐/, weight: 3 },
  { category: 'strollers', tokens: /ベビーカー|バギー/, weight: 3 },
  { category: 'car_seats', tokens: /チャイルドシート|ジュニアシート|カーシート|回転式シート/, weight: 3 },
  { category: 'diapers', tokens: /おむつ|オムツ|紙おむつ|パンツタイプ|テープタイプ|トレパン|オヤスミマン|水あそびパンツ|スイミングパンツ|水遊び.*パンツ|お産用パッド|母乳パッド|パンパース|ム[ーー−\-]ニ|メリーズ|グ[ーー−\-]ン|GOON|マミ[ーー−\-]?ポコ|ゲンキ|ネピア|nepia/i, weight: 2 },
]

export const THRESHOLD = 1
```

- [ ] **Step 4: Rewrite classifyLocal to score**

Replace the body of `src/lib/jan/classify-local.ts` (keep the file's doc comment; remove the old `RULES`):

```ts
import { type Category } from '../llm/category-prompts'
import { LEXICON, THRESHOLD } from './lexicon'

// Score every category by summed weights of matching token groups; return the highest
// scorer at or above THRESHOLD. Order-independent — specificity lives in `weight`, not
// list position. Ties broken by the higher weight already encoded; exact score ties fall
// through to 'unknown' (ambiguous) to avoid arbitrary first-match bias.
export function classifyLocal(title: string): Category | 'unknown' {
  const score = new Map<Category, number>()
  for (const { category, tokens, weight } of LEXICON) {
    if (tokens.test(title)) score.set(category, (score.get(category) ?? 0) + weight)
  }
  let best: Category | 'unknown' = 'unknown'
  let bestScore = THRESHOLD - 1
  let tied = false
  for (const [cat, s] of score) {
    if (s > bestScore) { best = cat; bestScore = s; tied = false }
    else if (s === bestScore) { tied = true }
  }
  return tied ? 'unknown' : best
}
```

- [ ] **Step 5: Run unit tests + eval to verify no regression**

Run: `npx jest src/lib/jan/classify-local.test.ts && npx jest src/lib/search/baby-scope.test.ts`
Expected: PASS (all four classify cases + the gate cases).
Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/eval/classify-eval.ts`
Expected: overall accuracy ≥ the Task 2 baseline. If lower, adjust weights in `lexicon.ts` (raise specific-noun weights) and re-run — do not proceed until ≥ baseline.

- [ ] **Step 6: Run full suite + tsc**

Run: `npx jest && npx tsc --noEmit`
Expected: green except the 3 known rakuten shipping failures.

- [ ] **Step 7: Commit**

```bash
git add src/lib/jan/lexicon.ts src/lib/jan/classify-local.ts src/lib/jan/classify-local.test.ts
git commit -m "refactor(classify): scored lexicon replaces first-match-wins"
```

---

## Task 5: URL/JAN lookup path + gate fixture regression test

Resolve a JAN-slug Rakuten URL against our products DB, and lock the keyword fixtures as a test.

**Files:**
- Create: `src/lib/harvest/repo.ts` — add `findByJan` (modify file; append function)
- Modify: `src/app/api/lookup/route.ts` (`parseProductUrl` + Rakuten branch)
- Modify: `src/lib/search/baby-scope.test.ts` (add fixture-driven test)

**Interfaces:**
- Consumes: `BABY_KEYWORD_FIXTURES` (Task 2), `query` from `src/lib/db`, existing `findMatchByAsin` shape `{ productTitle, productImageUrl, rakutenItemCode }`.
- Produces: `findByJan(jan: string): Promise<{ productTitle: string; productImageUrl: string; rakutenItemCode: string | null; asin: string | null } | null>`.

- [ ] **Step 1: Write the fixture regression test**

Append to `src/lib/search/baby-scope.test.ts`:

```ts
import { BABY_KEYWORD_FIXTURES } from './baby-scope.fixtures'

describe('isBabyQuery — labeled fixtures', () => {
  it.each(BABY_KEYWORD_FIXTURES)('$keyword → baby=$baby', ({ keyword, baby }) => {
    expect(isBabyQuery(keyword)).toBe(baby)
  })
})
```

- [ ] **Step 2: Run it to verify it passes (post-Task-1/4)**

Run: `npx jest src/lib/search/baby-scope.test.ts`
Expected: PASS (Tasks 1 and 4 already made the formula terms baby; off-topic stay non-baby). If any baby fixture fails, add its tokens to `lexicon.ts` formula/relevant group and re-run.

- [ ] **Step 3: Add findByJan to the repo**

In `src/lib/harvest/repo.ts`, append:

```ts
// Resolve a JAN (EAN-13) to its product + active listings. Used by the lookup route when a
// Rakuten URL slug is a bare JAN (e.g. /netbaby/4987244195937/) rather than an itemCode.
export async function findByJan(jan: string): Promise<
  { productTitle: string; productImageUrl: string; rakutenItemCode: string | null; asin: string | null } | null
> {
  const rows = await query<{ title: string; image_url: string; rakuten_id: string | null; asin: string | null }>(`
    SELECT p.title,
           p.image_url,
           (SELECT l.platform_id FROM listings l WHERE l.product_id=p.id AND l.platform='rakuten' AND l.is_active=true LIMIT 1) AS rakuten_id,
           (SELECT l.platform_id FROM listings l WHERE l.product_id=p.id AND l.platform='amazon'  AND l.is_active=true LIMIT 1) AS asin
    FROM products p WHERE p.jan=$1 LIMIT 1`, [jan])
  const r = rows[0]
  if (!r) return null
  return { productTitle: r.title, productImageUrl: r.image_url, rakutenItemCode: r.rakuten_id, asin: r.asin }
}
```

(Confirm `products.image_url` exists — per CLAUDE.md the products table has `image_url`. If a `query` import is not already present at top of repo.ts, it is — `findMatchByAsin` uses it.)

- [ ] **Step 4: Detect a JAN slug in the Rakuten lookup branch**

In `src/app/api/lookup/route.ts`, add an import:

```ts
import { findMatchByAsin, findByJan } from '@/lib/harvest/repo'
```

In `parseProductUrl`, the Rakuten branch returns the whole normalized URL as `id`. Before the existing `crawlRakutenProduct` call in the `else` branch (line ~84), insert a JAN fast-path:

```ts
  } else {
    // If the Rakuten URL slug is a bare JAN (EAN-13), resolve it authoritatively from our DB
    // first (slug ≠ itemCode, so crawlRakutenProduct cannot resolve these).
    const janMatch = parsed.id.match(/rakuten\.co\.jp\/[^/]+\/(\d{13})\b/)
    if (janMatch) {
      const hit = await findByJan(janMatch[1]).catch(() => null)
      if (hit?.rakutenItemCode) {
        const rk = await lookupRakuten(hit.rakutenItemCode).catch(() => null)
        const amazonCard = hit.asin
          ? buildAmazonLinkResult({ asin: hit.asin, title: hit.productTitle, imageUrl: hit.productImageUrl })
          : null
        const merged = [...(rk ? [rk] : []), ...(amazonCard ? [amazonCard] : [])].sort(byEffectivePrice)
        if (merged.length) {
          await setCached(cacheKey, merged).catch(() => {})
          return NextResponse.json({
            mode: 'comparison', rakutenResults: [], amazonResults: [], results: merged, query: url, cached: false,
          } satisfies SearchResponse)
        }
      }
    }
    const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
```

(The existing `crawlRakutenProduct` path remains as the fallback when the slug is not a JAN or the JAN is unharvested.)

- [ ] **Step 5: Run lookup-related checks + full suite**

Run: `npx jest && npx tsc --noEmit`
Expected: green except the 3 known rakuten shipping failures. No type errors from the new import/branch.

- [ ] **Step 6: Manual smoke (optional, requires STAGE=acp env)**

Run a dev server and POST `{ "url": "https://item.rakuten.co.jp/netbaby/4987244195937/" }` to `/api/lookup`. Expected: resolves via JAN if harvested; otherwise falls through to the live crawl (this exact JAN is unharvested, so it exercises the fallback — confirm it no longer 500s and returns a product or a clean 404).

- [ ] **Step 7: Commit**

```bash
git add src/lib/harvest/repo.ts src/app/api/lookup/route.ts src/lib/search/baby-scope.test.ts
git commit -m "fix(lookup): resolve JAN-slug Rakuten URLs via products DB; lock gate fixtures"
```

---

## Self-Review

**Spec coverage:**
- Layer 1 (lexicon patch) → Task 1. ✓
- Layer 2 (scored classifier) → Task 4. ✓
- Layer 3 (gate: search-then-filter + BABY_GENRE_IDS) → Task 3; (JAN→DB lookup) → Task 5. ✓
- Layer 4 (eval harness + fixtures) → Task 2 + Task 5 fixture test. ✓
- Cache bump kw6→kw7 → Task 3 Step 6. ✓
- BABY_GENRE_IDS excludes 100533/"0" → Task 3 Step 3 + test. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. ✓

**Type consistency:** `classifyLocal(title) => Category | 'unknown'` unchanged across Tasks 1/4/5. `BABY_GENRE_IDS: ReadonlySet<string>` + `isBabyGenre` consistent between Task 3 def and Task 3/5 tests. `findByJan` return shape matches its consumer in Task 5 Step 4. `BABY_KEYWORD_FIXTURES` shape `{keyword, baby}` consistent between Task 2 def and Task 5 test. ✓

**Note on build order:** Tasks are ordered 1 (unblock) → 2 (measure) → 3 (gate) → 4 (classifier, validated against the Task 2 baseline) → 5 (lookup + fixtures). Task 3 and Task 4 both touch `classify-local.ts`/`rakuten.ts` only in non-overlapping regions, but execute sequentially to keep reviews clean.
