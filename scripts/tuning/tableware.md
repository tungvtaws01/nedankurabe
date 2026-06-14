# Tableware (ベビー食器) keyword-prompt tuning log

Category: baby tableware — plates / bowls / cups / spoons-forks / chopsticks / sets.
NOT mugs (マグ/ストローマグ are bottles). Pipeline: `refineKeyword` → crawl other
platform → rank → `semanticMatch`. Model: `qwen/qwen3-235b-a22b-2507`.

## What decides a tableware match
- **Brand**: リッチェル/Richell, ピジョン, コンビ, エジソンママ/EDISONmama, NUK,
  スケーター/Skater, アガツマ, レック/LEC, ル・クルーゼ, ミキハウス.
- **Line / character series** (defines the SKU): Richell ピーナッツ コレクション (Snoopy);
  Pigeon KIPPOI; Combi ベビーレーベル + ステップアップ食器セット / ナビゲート食器セット;
  EDISONmama あつまる / もぐもぐ / くるくる; character series アンパンマン / スヌーピー /
  ミッフィー / ドラえもん / くまのプーさん.
- **Item TYPE — decisive**: 食器セット (multi-piece) vs single プレート / ボウル / コップ /
  スプーンフォーク / おはし. A set is not a single piece; a plate is not a bowl.
- **Material**: メラミン / ステンレス / 木製 / シリコン / 燕三条.
- Drop: colors, counts, 出産祝い/ギフト/お食い初め, 食洗機/レンジ/BPAフリー marketing.

## Discovery (crawler, not browser)
Rakuten searches (free) for リッチェル/エジソンママ/スケーター/ピジョン/コンビ/アガツマ/NUK
tableware. Findings:
- リッチェル: ピーナッツ コレクション (Snoopy) line dominant; お食事セットFS, single
  スプーン・フォーク (つまみ持ち/にぎり持ち/おはし持ち), SY-1 budget set. Also a separate
  トライ line (no character).
- ピジョン: only one tableware SKU — KIPPOI 食器セット.
- コンビ: ベビーレーベル ステップアップ食器セット / ナビゲート食器セット.
- エジソンママ: フォーク&スプーン (燕三条 ステンレス, character variants), あつまるプレート/
  あつまるボウル, もぐもぐトレイ, くるくるプレート, 木製カトラリーセット.
- スケーター: メラミン character lunch plates — **Amazon JP returns 0 results for any
  スケーター kids melamine query** (true cross-platform absence; not a keyword fault).
- NUK on Rakuten = mostly bottles (ラーナーボトル); weak tableware brand here.
- アンパンマン まいにち食器セット = made by レック/LEC (4-point set).

## Probe results (PROBE_FROM=rakuten → searches Amazon)

| # | Source (Rakuten) | Keyword emitted | Result |
|---|---|---|---|
| 1 | ピジョン KIPPOI 食器セット | `ピジョン KIPPOI 食器セット` | PASS (#0, stable on re-run) |
| 2 | リッチェル ピーナッツ お食事セットFS | `リッチェル ピーナッツ コレクション 食器セット …` | PASS (#0, stable) |
| 3 | コンビ ベビーレーベル ステップアップ食器セットC | `コンビ ベビーレーベル ステップアップ食器セット …` | PASS (#0) |
| 4 | EDISONmama フォーク&スプーン 燕三条 | `エジソンママ ステンレス スプーンフォーク カトラリー` | PASS (same line) |
| 5 | EDISONmama あつまるプレート | `エジソンママ あつまる プレート ラバー底面` | PASS (#0) after prompt fix |
| 6 | EDISONmama 木製カトラリーセットBaby | `エジソンママ 木製 カトラリー 食器セット` | PASS (#0) |
| 7 | コンビ ベビーレーベル ナビゲート食器セットC | `コンビ ベビーレーベル ナビゲート食器セット …` | PASS (#0) |
| 8 | EDISONmama フォーク&スプーン ドラえもん | `エジソンママ ドラえもん スプーンフォーク ステンレス` | PASS (#0) |
| 9 | リッチェル ベビー食器セット SY-1 スヌーピー | `リッチェル スヌーピー 食器セット` | PASS (#0, exact SY-1) |
| A | スケーター メラミンランチプレート おさるのジョージ | `スケーター おさるのジョージ プレート メラミン` | MISS — Amazon has 0 Skater kids melamine (true absence) |
| B | アンパンマン まいにち食器セット (LEC) | `アンパンマン まいにち 食器セット` | MISS — matcher-side: keyword surfaced LEC 4点セット #0, judge said NO MATCH |
| C | リッチェル ピーナッツ つまみ持ちスプーン・フォーク | `リッチェル ピーナッツ コレクション スプーンフォーク つまみ持ち` | MISS — matcher-side: correct Snoopy item ranked #0, judge picked #5 トライ (wrong line) |

**Keyword-side pass rate: 9/10** of the searchable sources (excluding A, the true
absence). 9 distinct sources surface the true equivalent at rank #0.

## Iterations
1. **v1** (copy of universal, customized): brand-map + line + type + material. Passed
   most sets immediately.
2. **v2 fix** — EDISONmama あつまる/もぐもぐ/くるくる line names added (probe #5 had dropped
   "あつまる", so judge matched あつまるボウル instead of あつまるプレート). After adding the
   line list, the keyword keeps あつまる → matches あつまるプレート #0.
3. Removed トライ from the Richell *line* list (it was being hallucinated onto Peanuts
   titles); kept トライ only as a material/break-resistant token. Confirmed stable on
   re-runs (#1, #2 re-probed twice, identical PASS).

## Matcher-side ceiling (not keyword — do not chase here)
- **#B Anpanman**: Rakuten title "まいにち食器セット" (maker LEC, brand token absent) vs
  Amazon "LEC アンパンマン 離乳食セット 4点セット". Judge won't equate まいにち = the 4-point
  set. Brand-equivalence / set-naming gap.
- **#C Richell utensils**: judge prefers same-type different-line (トライ) over the correct
  ピーナッツ コレクション (Snoopy) item that ranked #0. Line-discrimination gap in the judge.

## Brands the judge brand-map is missing (matcher-side follow-up)
- **アガツマ / Agatsuma ↔ レック / LEC** — the アンパンマン まいにち food-set is sold under
  both maker names; judge can't bridge them.
- **EDISONmama line equivalence** (あつまる vs くるくる vs もぐもぐ) — judge sometimes treats
  sibling lines as interchangeable.
- Skater is moot here (no Amazon supply), so no judge entry is worth adding.
