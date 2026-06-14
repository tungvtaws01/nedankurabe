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
  diapers: `- Product line / tier: さらさらケア ≠ はじめての肌へのいちばん ≠ 超吸収エアリー ≠ 卒業パンツ; エアスルー ≠ ぐっすりパンツ (Merries); エアフィット ≠ マシュマロ肌ごこち (Moonyman). The line is the NAMED SERIES only. The diaper FORM word is NOT a line: パンツ/さらさらパンツ is the pants cut of the さらさらケア line — "さらさらパンツ" and "さらさらケア" name the SAME line (one just abbreviates it to its pants form), so match. Likewise ignore spacing/kana spelling of the brand+line (ナチュラルムーニー = ナチュラル ムーニー = the same brand).
- Tape vs pants (テープ ≠ パンツ) is decisive ONLY when BOTH titles literally contain a form word (the kanji/kana テープ or パンツ). If a title does not literally contain テープ nor パンツ, its form is UNSPECIFIED — you must NOT guess or infer a form from the brand/size/popularity, and you must NOT reject on form. With an unspecified form, a same brand+line+size pair still MATCHES.
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
