# semanticMatch Refactor — Code-side Brand Matching + Per-genre Judge Rules

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move brand-equivalence out of the `semanticMatch` LLM prompt into a deterministic `BRAND_ALIASES` table + brand gate, and split the one shared judge prompt into per-genre `MATCH_RULES` (optional `category` param, `GENERAL_RULES` fallback) — raising durable-genre end-to-end match rate while keeping precision.

**Architecture:** A new pure module `brand-aliases.ts` (`normalizeBrand`, `brandsAreDistinct`) lets `semanticMatch` drop certain-cross-brand candidates BEFORE the LLM. A new `match-rules.ts` holds `BASE_RULES` + `MATCH_RULES: Record<Category,string>` + `GENERAL_RULES`; `semanticMatch` composes `BASE + (MATCH_RULES[category] ?? GENERAL_RULES)`. `semanticMatch` gains `opts?: { category?: Category }`; `refineKeyword` gains `category?: Category` so the serve flow classifies once and feeds both. Un-updated callers keep working via the fallback.

**Tech Stack:** TypeScript, Next.js, Jest (ts-jest), OpenRouter LLM (`JUDGE_MODEL`/`FAST_MODEL`). Spec: `docs/superpowers/specs/2026-06-14-semanticmatch-brand-genre-refactor-design.md`.

---

## File Structure

- **Create** `src/lib/llm/brand-aliases.ts` — `BRAND_ALIASES`, `normalizeBrand(title)`, `brandsAreDistinct(a,b)`. Pure, no deps.
- **Create** `src/lib/llm/brand-aliases.test.ts` — unit tests for the above.
- **Create** `src/lib/llm/match-rules.ts` — `BASE_RULES`, `MATCH_RULES`, `GENERAL_RULES`, `composeMatchPrompt(category?)`.
- **Create** `src/lib/llm/match-rules.test.ts` — every `Category` has a rule; composition correctness.
- **Modify** `src/lib/llm/openrouter.ts` — `semanticMatch` (brand gate + `opts.category` + composed prompt); `refineKeyword` (optional `category`).
- **Modify** `src/lib/llm/openrouter.test.ts` — keep green; add brand-gate + category-routing assertions.
- **Modify** callers to thread category: `src/lib/matching/find-equivalent.ts`, `src/lib/matching/llm-match.ts`, `src/app/api/lookup/stream/route.ts`, `scripts/harvest/02-match-amazon.ts`, `scripts/harvest/reeval-nomatch.ts`, `scripts/probe-keyword.ts`, `scripts/probe-matcher.ts`.

---

## Task 1: Brand alias table + `normalizeBrand`

**Files:**
- Create: `src/lib/llm/brand-aliases.ts`
- Test: `src/lib/llm/brand-aliases.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/brand-aliases.test.ts
import { normalizeBrand, brandsAreDistinct } from './brand-aliases'

describe('normalizeBrand', () => {
  it('maps JP and EN surface forms to the same canonical id', () => {
    expect(normalizeBrand('P&Gジャパン パンパース テープ Mサイズ')).toBe('pampers')
    expect(normalizeBrand('Pampers Baby Dry Tape M')).toBe('pampers')
  })
  it('is case-insensitive for latin aliases', () => {
    expect(normalizeBrand('babydan ベビーゲート')).toBe('babydan')
    expect(normalizeBrand('BABYDAN gate')).toBe('babydan')
  })
  it('returns null when no known brand appears', () => {
    expect(normalizeBrand('謎の無名ブランド プレイマット 180×200')).toBeNull()
  })
  it('keeps KIRKLAND and RICO as DISTINCT canonical ids', () => {
    expect(normalizeBrand('カークランド おしりふき 100枚')).toBe('kirkland')
    expect(normalizeBrand('RICO ベビー おしりふき')).toBe('rico')
    expect(normalizeBrand('カークランド')).not.toBe(normalizeBrand('RICO'))
  })
})

describe('brandsAreDistinct', () => {
  it('true only when BOTH titles name a known brand and they differ', () => {
    expect(brandsAreDistinct('カークランド おしりふき', 'RICO おしりふき')).toBe(true)
    expect(brandsAreDistinct('パンパース テープ M', 'Pampers Tape M')).toBe(false) // same canonical
  })
  it('false when either side has no known brand (defer to LLM)', () => {
    expect(brandsAreDistinct('無名 プレイマット', 'パンパース テープ')).toBe(false)
    expect(brandsAreDistinct('無名 A', '無名 B')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/lib/llm/brand-aliases.test.ts`
Expected: FAIL — "Cannot find module './brand-aliases'".

- [ ] **Step 3: Implement `brand-aliases.ts`**

Seed `BRAND_ALIASES` from (a) the brand list currently inline in `openrouter.ts:98-102`, and (b) the brands the 2026-06-14 tuning logs flagged as missing (see `scripts/tuning/*.md` and the `semantic-match-brand-map-bottleneck` memory). Keep KIRKLAND and RICO as separate ids.

```ts
// src/lib/llm/brand-aliases.ts
// Canonical brand id → every surface form seen on either platform (JP / EN / variants).
// Adding a brand = add one row. KIRKLAND and RICO are SEPARATE ids on purpose, so the
// brand gate treats them as a mismatch (same retailer/sheet-count ≠ same product).
export const BRAND_ALIASES: Record<string, string[]> = {
  // existing inline brands
  pampers: ['パンパース', 'Pampers'],
  merries: ['メリーズ', 'Merries', 'Merys', 'Melys'],
  moony: ['ムーニー', 'Moony'],
  goon: ['グーン', 'GOON', 'Goo.n'],
  pigeon: ['ピジョン', 'Pigeon'],
  combi: ['コンビ', 'Combi'],
  aprica: ['アップリカ', 'Aprica'],
  ergobaby: ['エルゴベビー', 'エルゴ', 'Ergobaby', 'Ergo'],
  meiji: ['明治', 'Meiji'],
  morinaga: ['森永', 'Morinaga'],
  snowbrand: ['雪印', 'Snow Brand'],
  wakodo: ['和光堂', 'Wakodo'],
  kao: ['花王', 'Kao'],
  lec: ['レック', 'LEC'],
  iris: ['アイリスオーヤマ', 'Genki!'],
  nishimatsuya: ['西松屋'],
  kirkland: ['カークランド', 'KIRKLAND', 'Kirkland'],
  rico: ['RICO', 'リコ'],
  // tuning-discovered (durables + niche)
  babybjorn: ['ベビービョルン', 'BabyBjorn', 'BabyBjörn', 'Baby Bjorn'],
  stokke: ['ストッケ', 'STOKKE', 'Stokke'],
  katoji: ['カトージ', 'KATOJI'],
  bumbo: ['バンボ', 'Bumbo'],
  ingenuity: ['インジェニュイティ', 'Ingenuity', 'Kids2'],
  yamatoya: ['大和屋', 'yamatoya'],
  richell: ['リッチェル', 'Richell'],
  babydan: ['ベビーダン', 'Babydan', 'BabyDan'],
  lascal: ['ラスカル', 'Lascal'],
  nihonikuji: ['日本育児'],
  omron: ['オムロン', 'OMRON'],
  tanita: ['タニタ', 'TANITA'],
  citizen: ['シチズン', 'CITIZEN'],
  dretec: ['ドリテック', 'dretec'],
  terumo: ['テルモ', 'TERUMO'],
  babysmile: ['ベビースマイル', 'BabySmile'],
  seastar: ['シースター'],
  tampei: ['丹平製薬', '丹平', 'Tampei'],
  lion: ['ライオン', 'LION'],
  jex: ['ジェクス', 'チュチュベビー', 'チュチュ', 'ChuChu'],
  edinter: ['エドインター', 'Ed Inter'],
  takaratomy: ['タカラトミー', 'Takara Tomy'],
  fisherprice: ['フィッシャープライス', 'Fisher-Price', 'Fisher Price'],
  sassy: ['サッシー', 'Sassy'],
  people: ['ピープル', 'People'],
  brightstarts: ['ブライトスターツ', 'Bright Starts'],
  kumon: ['くもん', 'KUMON', '公文'],
  marlmarl: ['マールマール', 'MARLMARL'],
  tenmois: ['10mois', 'ディモワ'],
  skater: ['スケーター', 'Skater'],
  edisonmama: ['エジソンママ', 'EDISONmama', 'Edison Mama'],
}

const NORMALIZED: Array<[string, string[]]> = Object.entries(BRAND_ALIASES).map(
  ([id, forms]) => [id, forms.map((f) => f.toLowerCase())],
)

// Returns the canonical brand id whose alias appears in the title, else null.
// Case-insensitive; on overlap the LONGEST matching alias wins (avoids a short
// alias shadowing a more specific brand).
export function normalizeBrand(title: string): string | null {
  const hay = title.toLowerCase()
  let bestId: string | null = null
  let bestLen = 0
  for (const [id, forms] of NORMALIZED) {
    for (const f of forms) {
      if (f.length > bestLen && hay.includes(f)) {
        bestId = id
        bestLen = f.length
      }
    }
  }
  return bestId
}

// True iff BOTH titles name a KNOWN brand and the brands differ. When either side
// has no recognised brand, returns false (defer to the LLM + NO-BRAND rule).
export function brandsAreDistinct(a: string, b: string): boolean {
  const ba = normalizeBrand(a)
  const bb = normalizeBrand(b)
  return ba !== null && bb !== null && ba !== bb
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/llm/brand-aliases.test.ts`
Expected: PASS (3 normalizeBrand + 2 brandsAreDistinct).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/brand-aliases.ts src/lib/llm/brand-aliases.test.ts
git commit -m "feat(match): deterministic brand-aliases table + normalizeBrand/brandsAreDistinct"
```

---

## Task 2: Per-genre `MATCH_RULES` module

**Files:**
- Create: `src/lib/llm/match-rules.ts`
- Test: `src/lib/llm/match-rules.test.ts`

**Content extraction map** (from the current inline prompt in `openrouter.ts`, lines 95-148):
- `BASE_RULES` ← the cross-cutting parts: the lead-in ("List ALL candidates…"), **Product type**, **Usage variant** (夜用≠昼用), **Gender** (swim-pants color rule), the **General** per-unit-size line, **PACK QUANTITY** block, **LOW** block, and the **Return JSON** contract. PLUS a slim brand note replacing the old list: `"- Brand: the caller has already dropped obvious cross-brand candidates. Still reject if a candidate names a DIFFERENT maker than the source, or if one side is brand-less (no maker named) and the other names a specific brand (NO-BRAND rule) — identical specs do not prove the same product."`
- `MATCH_RULES[diapers]` ← the Diapers line/size bullets. `[formula]` ← Formula bullets. `[baby_food]` ← Baby food dish/flavor bullets. `[wipes]` ← Wipes bullets. `[skincare]` ← Sunscreen/UV SPF bullet. Move each verbatim from the current prompt.
- `GENERAL_RULES` ← the union of all the per-genre line/model bullets currently in the prompt (i.e. today's behavior for callers that pass no category). Build it by concatenating the existing per-genre bullets.
- For the **new genres with no existing inline rules** (carriers/strollers/car_seats already have some; toothbrush, toothpaste, bibs, tableware, baby_chair, bouncer, toys, nasal_aspirator, thermometer, safety_gate, playmat), write fresh rules from the tuning logs (`scripts/tuning/<cat>.md`). Full text below.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/match-rules.test.ts
import { CATEGORIES } from './category-prompts'
import { MATCH_RULES, GENERAL_RULES, composeMatchPrompt } from './match-rules'

describe('MATCH_RULES', () => {
  it('has a rule string for every category in CATEGORIES', () => {
    for (const c of CATEGORIES) {
      expect(typeof MATCH_RULES[c]).toBe('string')
      expect(MATCH_RULES[c].length).toBeGreaterThan(0)
    }
  })
})

describe('composeMatchPrompt', () => {
  it('includes BASE rules and the genre rule when a category is given', () => {
    const out = composeMatchPrompt('thermometer')
    expect(out).toContain('JSON')                 // BASE contract present
    expect(out).toContain(MATCH_RULES.thermometer) // genre block present
  })
  it('falls back to GENERAL_RULES when no category is given', () => {
    const out = composeMatchPrompt(undefined)
    expect(out).toContain(GENERAL_RULES)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest src/lib/llm/match-rules.test.ts`
Expected: FAIL — "Cannot find module './match-rules'".

- [ ] **Step 3: Implement `match-rules.ts`**

```ts
// src/lib/llm/match-rules.ts
import { type Category } from './category-prompts'

// Cross-cutting judge rules sent for EVERY match. The brand-equivalence LIST has
// moved to brand-aliases.ts (a deterministic gate runs before the LLM); only the
// NO-BRAND backstop remains here for null-brand candidates that reach the LLM.
export const BASE_RULES = `You are a product matching engine for Japanese e-commerce platforms (Amazon JP ↔ Rakuten).

List ALL candidates that satisfy ALL HIGH criteria below. The caller will pick the cheapest — just identify every valid match.

HIGH (all must match):
- Brand: the caller already dropped obvious cross-brand candidates. Still reject a candidate that names a DIFFERENT maker than the source, or where one side is brand-less (no maker named) and the other names a specific brand (NO-BRAND rule) — identical size/type/specs do not prove the same product.
- Product type: must be the same (tape≠pants, cube≠powder, carrier≠stroller, liquid≠solid).
- Usage variant: 夜用 (night) ≠ 昼用/標準 (day/regular) — different product lines, treat as mismatch.
- Gender: 男の子用 ≠ 女の子用. For gender-split products (esp. 水あそびパンツ swim pants), COLOR encodes gender: ブルー/青 = 男の子用, ピンク = 女の子用 — blue-vs-pink, or a color on one side vs the opposite gender label on the other, is a gender MISMATCH. (A plain color on a NON-gender-split product is fine — see LOW.)
- Size / stage / per-unit volume: must match. Treat any per-unit size or stage difference as a mismatch.
{{GENRE_RULES}}

PACK QUANTITY — normalized downstream, NOT a matching criterion:
- The number of identical retail units (×N, N個セット, ケース, 箱×N, まとめ買い, "Case Product") may differ freely. A case-pack and a single pack of the SAME unit product ARE a match — unit price is compared downstream. Do NOT reject because one side is a multi-pack/セット/ケース and the other is a single.
- Per-unit count WITHIN one pack: small differences are fine (82枚 vs 84枚). A drastically different per-unit count signalling a different SKU (3-piece trial vs 64-piece pack) is a mismatch. N/A for single-unit items.

LOW (may differ freely): plain colors (without a gender label), pack design, promotional bundles.

Return JSON only: {"matches": [i, j, ...]} listing every valid candidate index, or {"matches": []} if none qualify.`

// Per-genre HIGH line/model/size discriminators. Existing genres mirror today's
// inline bullets; the 2026-06-14 genres are seeded from scripts/tuning/<cat>.md.
export const MATCH_RULES: Record<Category, string> = {
  diapers: `- Product line / tier: さらさらケア ≠ はじめての肌へのいちばん ≠ 超吸収エアリー ≠ 卒業パンツ; エアスルー ≠ ぐっすりパンツ (Merries); エアフィット ≠ マシュマロ肌ごこち (Moonyman).
- Size: weight range (新生児/5kg ≠ Sサイズ/6-11kg). Letter sizes STRICT — 新生児 ≠ S ≠ M ≠ L ≠ ビッグ ≠ ビッグより大きい/スーパービッグ. ADJACENT sizes are STILL a mismatch (M≠L, L≠ビッグ).`,
  wipes: `- Line/type: 純水/水99% ≠ アルコール除菌タイプ; トイレに流せる (flushable) ≠ regular; 手口ふき (hand & mouth) ≠ おしりふき (bottom). Within a brand named lines differ (Moony やわらか素材 ≠ 水分たっぷり厚手 ≠ こすらずするりんっ; 厚手 ≠ 通常 only when one explicitly says 厚手).`,
  formula: `- Form/stage: らくらくキューブ ≠ 缶タイプ ≠ 液体 (different form); ほほえみ ≠ ステップ (different stage). PER-UNIT can size: a 400g can ≠ an 800g can. Age stage 0ヶ月 ≠ 6ヶ月頃.`,
  baby_food: `- Line: ハイハイン ≠ グーグーキッチン (different lines). The DISH/FLAVOR must match within a line — グーグーキッチン 鮭とじゃがいもの和風煮 ≠ 牛肉のすき焼き風ごはん ≠ ラタトゥイユ; 栄養マルシェ flavors differ. Same line + different dish/flavor = a different product (mismatch).`,
  bottles: `- Type/line: 哺乳瓶 ≠ 乳首(nipple) ≠ ストローマグ ≠ 搾乳器. Within a brand the line differs (母乳実感 ≠ etc.). PER-UNIT volume matters (160ml ≠ 240ml).`,
  carriers: `- Model: OMNI Breeze ≠ ADAPT ≠ EMBRACE; キャリフリー ≠ POLBAN. Supported weight range (newborn ≠ toddler) if specified.`,
  strollers: `- Model/type: A型 ≠ B型 ≠ 三輪; the model name decides (e.g. Aprica オプティア ≠ ラクーナ).`,
  car_seats: `- Model + standard: R129 ≠ old standard; 回転式 ≠ 固定; the model name (クルリラ/フラディア/etc.) decides.`,
  skincare: `- Sunscreen/UV: the SPF rating is part of the SKU — SPF50/50+ ≠ SPF35 ≠ SPF29 ≠ SPF21 (a number like "クリーム50" usually denotes SPF50). Line/type (ローション ≠ クリーム ≠ オイル ≠ ミルク) must match.`,
  bath: `- Type/line: ベビーソープ/全身シャンプー ≠ シャンプー ≠ 入浴剤 ≠ 沐浴剤. 泡タイプ ≠ 液体; within a brand named lines differ.`,
  toothbrush: `- Type: 歯ブラシ ≠ 仕上げ磨き用ブラシ ≠ 電動歯ブラシ ≠ 替えブラシ — these are different products. Age stage (0-2才/6ヶ月/1.5-7才) is part of the SKU; keep it. Line name (レッスン段階N for Pigeon) with its stage digit decides.`,
  toothpaste: `- Form: ジェル状/ジェル ≠ ペースト ≠ 泡 ≠ タブレット ≠ 歯みがきナップ/シート (wipe) — different products. FLAVOR is part of the SKU: ぶどう/グレープ ≠ いちご ≠ りんご ≠ メロン ≠ ミント. フッ素 ppm (950ppm) and volume (40ml/g) when present.`,
  bibs: `- Type: スタイ/よだれかけ (drool bib) ≠ お食事エプロン (feeding apron) ≠ 長袖エプロン — never swap. Bibs are design-heavy: a named collection/line (MARLMARL deco/joujou/bouquet) decides; same brand + different design = different product.`,
  tableware: `- Item type: プレート/お皿 ≠ ボウル ≠ スプーン/フォーク ≠ おはし ≠ コップ; SET vs single is decisive. Line/character series (EdisonMama あつまる/くるくる/もぐもぐ; Richell ピーナッツ vs トライ) decides; material (メラミン/ステンレス).`,
  baby_chair: `- Chair type is DECISIVE, never swap: ハイチェア ≠ ローチェア ≠ テーブルチェア/卓上 ≠ ブースター ≠ ベビーソファ/お座り補助. Model/line (すくすく, アッフル, トリップトラップ, ノミ, ニューヨークベビー, ベビーベース) within the brand decides.`,
  bouncer: `- Type: バウンサー (manual rocker) ≠ ハイローラック/ハイローチェア ≠ 電動/オートスイング (electric) ≠ ゆりかご — never swap. Model/line (Bliss/ブリス, バランスソフト, STEPS, ネムリラ, ユラリズム) and grade (オート/エアー mesh) decide.`,
  toys: `- The specific product/line name (オーボール, レインフォレストジム, やりたい放題, おやすみホームシアター) is the identity — must match. Type (メリー/モビール ≠ ジム ≠ ガラガラ/ラトル ≠ 歯固め ≠ 知育 ≠ 乗用). Many toys are store-exclusive SKUs with no cross-platform equivalent.`,
  nasal_aspirator: `- Type: 電動 (stationary electric) ≠ ハンディ (handheld electric) ≠ ハンドポンプ/手動 (manual) ≠ 口で吸う (mouth-suction) — never swap. Model code (メルシーポット S-503/504/505, ベビースマイル S-303, ベベキュア) decides. A replacement part/nozzle ≠ the device.`,
  thermometer: `- Measurement type: 耳式 (ear) ≠ 非接触/おでこ (forehead) ≠ 予測式 ≠ わき/実測 — different products. Model code (耳チビオン C231, けんおんくん MC-682, TO-204) decides. A プローブカバー/ケース is an accessory, NOT a thermometer.`,
  safety_gate: `- Type: ゲート (opening barrier) ≠ フェンス (free-standing) ≠ サークル/プレイヤード (enclosed pen) — never swap. Model/line (スマートゲイトII, おくだけとおせんぼ, マルチダン, キディガード) and mount (突っ張り ≠ 置くだけ ≠ ネジ固定) decide.`,
  playmat: `- Type: プレイマット (folding) ≠ ジョイントマット (interlocking tiles) ≠ ロールマット ≠ コルクマット ≠ フロアマット — never swap. SIZE is decisive here (140×200 ≠ 180×200; tile 45cm ≠ 60cm) UNLESS it is a multi-size listing. Thickness (4cm/2cm) when stated.`,
}

// Union fallback for callers that pass no category (= today's behavior).
export const GENERAL_RULES = Object.values(MATCH_RULES).join('\n')

export function composeMatchPrompt(category?: Category): string {
  const genre = category ? MATCH_RULES[category] : GENERAL_RULES
  return BASE_RULES.replace('{{GENRE_RULES}}', genre)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/llm/match-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/match-rules.ts src/lib/llm/match-rules.test.ts
git commit -m "feat(match): per-genre MATCH_RULES + BASE/GENERAL judge-prompt composition"
```

---

## Task 3: Wire brand gate + category into `semanticMatch`

**Files:**
- Modify: `src/lib/llm/openrouter.ts` (semanticMatch, lines 76-160)
- Test: `src/lib/llm/openrouter.test.ts`

- [ ] **Step 1: Write the failing test** (append to the existing `describe('semanticMatch')`)

```ts
  it('drops a known cross-brand candidate before the LLM (brand gate)', async () => {
    // LLM would say match index 0, but the gate removes it (different known brand).
    mockLLM('{"matches":[0]}')
    const source = mockProduct('カークランド おしりふき 100枚', 500)
    const idx = await semanticMatch(source, [mockProduct('RICO おしりふき 100枚', 400)])
    expect(idx).toBeNull()
  })

  it('routes to the per-genre rule when category is supplied', async () => {
    // Spy on callLLM content to assert the thermometer rule is in the prompt.
    const spy = mockLLMCapture('{"matches":[0]}')
    const source = mockProduct('ピジョン 耳チビオン 耳式体温計 C231', 3000)
    await semanticMatch(source, [mockProduct('ピジョン 耳チビオン C231 体温計', 2800)], { category: 'thermometer' })
    expect(spy.lastContent).toContain('耳式 (ear)')
  })
```

(Use the file's existing LLM-mock helper; `mockLLMCapture` = a variant that records the last prompt content. If the test file lacks a capture helper, add a minimal one that stores `callLLM`'s first message content.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/llm/openrouter.test.ts -t semanticMatch`
Expected: FAIL — cross-brand test returns 0 (no gate yet); category test can't find the rule text.

- [ ] **Step 3: Implement**

In `openrouter.ts`: import the new helpers and rewrite `semanticMatch`. Replace the inline prompt + the `pool = candidates.slice(0,8)` logic with a brand-gated pool that tracks original indices, and compose the prompt.

```ts
import { normalizeBrand, brandsAreDistinct } from './brand-aliases'
import { composeMatchPrompt } from './match-rules'
import { type Category } from './category-prompts'

export async function semanticMatch(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<number | null> {
  if (!candidates.length) return null
  try {
    // Brand gate: drop candidates whose KNOWN brand differs from the source's known
    // brand. Keeps original indices so the return value still indexes `candidates`.
    const gated = candidates
      .map((c, origIdx) => ({ c, origIdx }))
      .filter(({ c }) => !brandsAreDistinct(source.title, c.title))
    if (!gated.length) return null
    const pool = gated.slice(0, 8) // reasoning models exhaust tokens on long lists
    const fmt = (p: ProductResult, i?: number) => {
      const prefix = i !== undefined ? `${i}: ` : 'Source: '
      const desc = p.description ? ` [${p.description.slice(0, 120)}]` : ''
      return `${prefix}${p.title.slice(0, 100)} ¥${p.salePrice.toLocaleString()}${desc}`
    }
    const candidateList = pool.map(({ c }, i) => fmt(c, i)).join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `${composeMatchPrompt(opts?.category)}\n\n${fmt(source)}\nCandidates:\n${candidateList}`,
    }], { model: JUDGE_MODEL, maxTokens: 600 })
    const cleaned = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { matches: number[] }
    if (!Array.isArray(parsed.matches) || parsed.matches.length === 0) return null
    // LLM indices are into `pool`; map back to original `candidates` indices.
    const validOrig = parsed.matches
      .filter((i) => typeof i === 'number' && pool[i] !== undefined)
      .map((i) => pool[i].origIdx)
    if (validOrig.length === 0) return null
    return validOrig.reduce((best, i) =>
      candidates[i].effectivePrice < candidates[best].effectivePrice ? i : best
    )
  } catch {
    return null
  }
}
```

Then DELETE the old inline brand list + per-genre prose from the function (now sourced from `match-rules.ts`). `normalizeBrand` import is used transitively via `brandsAreDistinct`; keep the explicit import only if referenced (remove if unused to satisfy lint).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/llm/openrouter.test.ts`
Expected: PASS — all existing semanticMatch tests (they pass no category → `GENERAL_RULES`; their candidates share/none-known brand so the gate doesn't drop them) plus the two new ones.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat(match): semanticMatch brand gate + per-genre prompt via opts.category"
```

---

## Task 4: Optional `category` on `refineKeyword`

**Files:**
- Modify: `src/lib/llm/openrouter.ts` (refineKeyword, lines 58-74)
- Test: `src/lib/llm/openrouter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  it('skips internal classifyCategory when a category is supplied', async () => {
    const spy = mockLLMCapture('パンパース テープ Sサイズ')
    await refineKeyword('パンパース テープ Sサイズ 108枚', 'amazon', 'diapers')
    // Only ONE LLM call (the keyword build) — no classify call.
    expect(spy.callCount).toBe(1)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest src/lib/llm/openrouter.test.ts -t refineKeyword`
Expected: FAIL — current refineKeyword always calls classifyCategory (2 calls), and the 3rd arg is ignored.

- [ ] **Step 3: Implement**

```ts
export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
  category?: Category | 'unknown',
): Promise<string> {
  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const cat = category ?? await classifyCategory(cleanTitle)
  const buildPrompt = cat === 'unknown' ? UNIVERSAL_PROMPT : CATEGORY_PROMPTS[cat]
  try {
    const result = await callLLM([{ role: 'user', content: buildPrompt(targetPlatform, cleanTitle) }], { model: FAST_MODEL, maxTokens: 120 })
    return result || stripBrackets(title)
  } catch {
    return stripBrackets(title)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/lib/llm/openrouter.test.ts -t refineKeyword`
Expected: PASS (existing 3 + new 1).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/openrouter.ts src/lib/llm/openrouter.test.ts
git commit -m "feat(match): refineKeyword accepts optional category to skip re-classify"
```

---

## Task 5: Thread category through the harvest callers

**Files:**
- Modify: `scripts/harvest/02-match-amazon.ts:108-135`
- Modify: `scripts/harvest/reeval-nomatch.ts:43-65`

Harvest already knows the genre (`--category` arg / `classifyLocal`). Pass it to both `refineKeyword` and `semanticMatch`.

- [ ] **Step 1: 02-match-amazon — pass category**

In the `--category=<id>` path, the loop variable genre is `category` (the CLI arg). For each product, pass it:
- `refineKeyword(p.title, 'amazon', category as Category)` (both call sites at ~110 and ~133's kw2 if present)
- `semanticMatch(source, ranked, { category: category as Category })`

When no `--category` arg is set (full-pool run), derive per-product with `classifyLocal(p.title)` and pass that (`'unknown'` → omit).

- [ ] **Step 2: reeval-nomatch — pass category**

`category` is the `arg('category')`; pass `{ category }` to `semanticMatch` and `refineKeyword(..., category)`.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/harvest/02-match-amazon.ts scripts/harvest/reeval-nomatch.ts
git commit -m "feat(harvest): pass known category into refineKeyword + semanticMatch"
```

---

## Task 6: Thread category through the serve + harness callers

**Files:**
- Modify: `src/lib/matching/find-equivalent.ts:45,59-63`
- Modify: `src/lib/matching/llm-match.ts`
- Modify: `src/app/api/lookup/stream/route.ts:129-131, 187-196`
- Modify: `scripts/probe-keyword.ts:83`, `scripts/probe-matcher.ts:39`

Classify ONCE per flow, pass to both `refineKeyword` and `semanticMatch`.

- [ ] **Step 1: find-equivalent.ts**

At the top of the LLM flow, classify the source once and thread it:
```ts
import { classifyCategory } from '@/lib/llm/openrouter'
// ...
const category = await classifyCategory(source.title).catch(() => 'unknown' as const)
const targeted = await searchTargeted(source, targetPlatform, category)
// ...
const idx = await semanticMatch(source, ranked, { category: category === 'unknown' ? undefined : category }).catch(() => null)
```
And give `searchTargeted` a `category` param it forwards to `refineKeyword`:
```ts
async function searchTargeted(source: ProductResult, targetPlatform: Platform, category?: Category | 'unknown') {
  const keyword = await refineKeyword(source.title, targetPlatform, category).catch(() => source.title)
  // ...unchanged
}
```

- [ ] **Step 2: llm-match.ts — accept + forward optional category**

```ts
export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<ProductResult | null> {
  if (!candidates.length) return null
  const idx = await semanticMatch(source, candidates, opts).catch(() => null)
  if (idx === null) return null
  return candidates[idx] ?? null
}
```

- [ ] **Step 3: lookup/stream/route.ts — both branches**

Rakuten branch (~129): classify the rakuten source once, reuse:
```ts
const category = await classifyCategory(rakutenProduct.title).catch(() => 'unknown' as const)
const catOpt = category === 'unknown' ? undefined : category
const kw = await refineKeyword(rakutenProduct.title, 'amazon', category).catch(() => rakutenProduct.title)
const candidates = await crawlAmazonSearch(kw).catch(() => [] as ProductResult[])
const idx = await semanticMatch(rakutenProduct, candidates, { category: catOpt }).catch(() => null)
```
Amazon branch (~187): same pattern keyed off `amazonProduct.title`.
Add `import { classifyCategory } from '@/lib/llm/openrouter'`.

- [ ] **Step 4: probe-keyword.ts / probe-matcher.ts — pass category**

Add an optional `PROBE_CATEGORY` env var; if set, pass `{ category: process.env.PROBE_CATEGORY as Category }` to `semanticMatch` (and as the 3rd arg to `refineKeyword` in probe-keyword). This lets the re-probe in Task 7 exercise the per-genre path.

- [ ] **Step 5: Type-check + tests**

Run: `npx tsc --noEmit && npx jest src/lib/llm src/lib/matching`
Expected: no tsc errors; tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/matching/find-equivalent.ts src/lib/matching/llm-match.ts src/app/api/lookup/stream/route.ts scripts/probe-keyword.ts scripts/probe-matcher.ts
git commit -m "feat(serve+harness): classify once, thread category into refineKeyword + semanticMatch"
```

---

## Task 7: Validation — 21-genre re-probe + precision gate

**Files:** none (validation); may edit `src/lib/llm/brand-aliases.ts` / `match-rules.ts` to fix regressions found.

This is the acceptance gate from the spec. NOT optional.

- [ ] **Step 1: Re-probe each genre from its tuning sources**

For every genre, take the source titles recorded in `scripts/tuning/<cat>.md` and run:
```bash
PROBE_FROM=amazon PROBE_TITLE='<source title>' PROBE_PRICE=<yen> \
PROBE_PROMPT=scripts/prompts/<cat>.txt PROBE_CATEGORY=<cat> OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507 \
npx jest --config jest.config.ts --runInBand --testPathIgnorePatterns '/node_modules/' --testMatch '**/scripts/probe-keyword.ts'
```
Record end-to-end PASS per genre.

- [ ] **Step 2: Compare to the pre-refactor baseline**

Baseline (keyword-side / end-to-end) is in `scripts/tuning/<cat>.md`. **Pass criteria:** end-to-end pass ≥ baseline for every genre, AND these precision guards still REJECT:
- KIRKLAND vs RICO (wipes) → no match
- generic (no-brand) vs branded → no match (NO-BRAND rule)
- baby_food same line, different flavor → no match
- skincare different SPF → no match
- swim-pants blue vs pink → no match
- diapers adjacent sizes (M vs L) → no match

- [ ] **Step 3: Fix regressions in the data modules only**

If a genre regressed: add the missing brand to `BRAND_ALIASES` or tighten/loosen the genre's `MATCH_RULES` string. Re-run that genre. Do NOT change `semanticMatch` logic. Re-run flaky probes twice (free model nondeterminism).

- [ ] **Step 4: Record results**

Append a results table (genre → baseline vs after) to `docs/harvest/overnight-log.md`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/brand-aliases.ts src/lib/llm/match-rules.ts docs/harvest/overnight-log.md
git commit -m "test(match): 21-genre re-probe validation + brand/rule fixes; precision guards intact"
```

---

## Task 8: Final sweep

**Files:** any touched.

- [ ] **Step 1: Full type-check + test suite**

Run: `npx tsc --noEmit && npx jest`
Expected: tsc clean; only the 3 known pre-existing rakuten failures remain (rakuten.test shippingCost ×2 + crawlers/rakuten JSON-LD). No new failures.

- [ ] **Step 2: Confirm the old inline brand list is fully gone**

Run: `grep -n "Pampers=パンパース" src/lib/llm/openrouter.ts` → expect NO output (moved to brand-aliases.ts).

- [ ] **Step 3: Update memory**

Update `semantic-match-brand-map-bottleneck` memory: the map is now a code table (`brand-aliases.ts`), the judge prompt is per-genre (`match-rules.ts`), and note the post-refactor end-to-end numbers.

- [ ] **Step 4: Commit (if anything changed)**

```bash
git add -A
git commit -m "chore(match): finalize semanticMatch refactor — verify + memory update"
```

---

## Notes for the implementer

- The free OpenRouter judge model is **nondeterministic** — re-run a flaky probe ~twice before treating it as a regression (Task 7).
- The brand gate **only removes** candidates; it can never create a false positive. Its only risk is a wrong/missing alias → which at worst reverts to today's LLM behavior.
- Keep `BRAND_ALIASES` aliases specific enough not to substring-collide with unrelated words; if a token is ambiguous (a brand that is a common word), OMIT it and let the LLM decide.
- `MATCH_RULES` strings are the place to add a genre's discriminators; `semanticMatch` logic should not need to change again to add a genre or brand.
