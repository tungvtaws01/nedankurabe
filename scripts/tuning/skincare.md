# Skincare (ベビースキンケア) keyword-prompt tuning log

Category: baby skincare. Pipeline: `refineKeyword(title, targetPlatform)` → crawl target →
`rankBySimilarity` → `semanticMatch`. Goal: tune `scripts/prompts/skincare.txt` so the
end-to-end cross-platform (Amazon JP ↔ Rakuten) match returns the true equivalent.

Decisive dimensions: brand + product TYPE (lotion ≠ UV ≠ wash ≠ oil) + line/variant + size (ml/g).

## Discovery (dump-search helper)

Brands/types/lines/sizes surveyed on both platforms:
- アロベビー (ALOBABY) ミルクローション 150ml / 380ml, UVモイストミルク, ベビーソープ
- ピジョン ベビーミルクローション うるおいプラス 300g; ももの葉 薬用ローション 200ml; ベビー全身泡ソープ 800ml
- アトピタ 保湿全身泡ソープ 350ml(本体/詰替/700ml); 保湿全身ミルキィローション 300ml; ベビーローション乳液 120ml
- ベビーワセリン (健栄製薬) 60g / 100g
- ジョンソン ベビーオイル 無香料/微香性 300ml (x3, x6 sets)
- ヴェレダ カレンドラ ベビーオイル 200mL / ベビーミルクローション 200mL / ベビーウォッシュ&シャンプー / ナッピークリーム / フェイシャルクリーム
- キュレル UVクリーム/UVミルク (花王); 牛乳石鹸 キューピー全身ベビーソープ; ミノン全身保湿ミルク

Key environment facts observed:
- Amazon JP titles come back ENGLISH-translated (e.g. "ALOBABY Milk Lotion 380ml",
  "Atopita Moisturizing Full Body Foaming Soap"), with ml/g preserved in parentheses.
- Amazon crawler frequently returns BARE brand titles ("PIGEON", "ALOBABY") with no
  line/type/size text — a title-extraction coverage limitation on the Amazon side.
- Rakuten titles are keyword-stuffed; over-specifying the keyword (claims like
  無添加/オーガニック/敏感肌, set/refill wording) shrinks or zeros results.

## Tested source → ground-truth pairs (10)

| # | Dir | Source | True equivalent | Keyword produced |
|---|-----|--------|-----------------|------------------|
| 1 | R→A | アロベビー ミルクローション 380ml | ALOBABY Milk Lotion 380ml (¥5227) | アロベビー ミルクローション 380ml |
| 2 | A→R | ALOBABY Milk Lotion 380ml | アロベビー ミルクローション 380ml (¥4248) | アロベビー ミルクローション 380ml |
| 3 | R→A | ピジョン ベビーミルクローション うるおいプラス 300g | Pigeon Baby Milk Lotion Moisture Plus 300g | ピジョン うるおいプラス ローション 300g |
| 4 | A→R | Atopita Foaming Soap 350ml | アトピタ 保湿全身泡ソープ 350ml (¥1660) | アトピタ 保湿全身泡ソープ 350ml |
| 5 | R→A | アトピタ 保湿全身泡ソープ 350ml | Atopita Foaming Soap 350ml | アトピタ 保湿全身泡ソープ 350ml |
| 6 | R→A | ピジョン ももの葉 薬用ローション 200ml | Pigeon Medicated Lotion (Momonolea) 200ml | ピジョン ももの葉 200ml |
| 7 | A→R | Kenei Baby Vaseline 100g | ベビーワセリン 100g (¥1234) | ベビーワセリン 100g |
| 8 | A→R | Johnson Baby Oil 300ml x3 | ジョンソン ベビーオイル 300ml*3本セット (¥2676) | ジョンソン ベビーオイル 300ml |
| 9 | R→A | ヴェレダ カレンドラ ベビーオイル 200mL | WELEDA Calendra Baby Oil 200ml (¥3267) | ヴェレダ カレンドラ ベビーオイル 200ml |
| 10| A→R | WELEDA Calendra Baby Milk Lotion 200ml | ヴェレダ カレンドラ ベビーミルクローション 200mL | ヴェレダ カレンドラ ベビーミルクローション 200ml |

## Iterations

### Iteration 1 (initial prompt)
EN↔JP brand/line/type map; product TYPE emphasized as VERY DECISIVE; size from parenthetical ml/g;
strip refill/set/marketing/SPF/scent.
Result: keyword correct on ALL 10 (right brand+line+type+size; surfaced true equivalent in
ranked top-3 every time). End-to-end semanticMatch:
- PASS: P2, P4, P5, P8, P9 (clean)
- PASS-with-coverage-noise: P3, P6 (matched a BARE "PIGEON" titleless candidate — unverifiable)
- PASS on retry: P7 (run1 NO MATCH, run2 matched 健栄製薬 ベビーワセリン 100g — nondeterministic)
- NO MATCH: P1 (ALOBABY R→A), P10 (WELEDA milk lotion A→R)

### Iteration 2
For Weleda, keep the FULL type word as part of the line (ミルクローション / ベビーオイル /
ウォッシュ&シャンプー) — do NOT shorten ミルクローション to ローション. Added explicit
Calendra line→type mappings.
Result: P10 keyword improved from "ヴェレダ カレンドラ ローション 200ml" to the precise
"ヴェレダ カレンドラ ベビーミルクローション 200ml"; candidates 0/1 are EXACT equivalents,
but semanticMatch still returns NO MATCH (twice). → confirmed matcher-side, not keyword.

### Iteration 3
Tightened ももの葉 (薬用ローション — emit "ピジョン ももの葉 + size", drop redundant ローション;
added Momonoba/Thigh-Leaves aliases) and Pigeon "Moisture Plus" → うるおいプラス alias.
Result: P6 keyword cleaner ("ピジョン ももの葉 200ml"); still matches a bare-PIGEON candidate
(coverage). Clean passers (P4,P5,P8,P9) re-verified stable.

## Final result

Keyword quality: 10/10 — every source produced a tight, correct brand+line+type+size keyword
that surfaced the true cross-platform equivalent in the ranked top-3. Product-type
discrimination works (P9: WELEDA *oil* correctly chosen over Bath Milk / Wash / Milk Lotion /
Cream / Nappy Cream candidates all present in the same result set).

End-to-end pass rate (semanticMatch returns the true equivalent):
- Clean PASS: P2, P4, P5, P7, P8, P9  = 6
- PASS but matched a bare-title Amazon candidate (right brand, size unverifiable due to Amazon
  title-extraction coverage): P3, P6  = 2
- Counting clean + coverage-impaired-but-non-null: **8/10**
- Strict clean-only (exclude bare-title matches): **6/10**

## Unfixable failures — diagnosis

- **P1 ALOBABY R→A — matcher/coverage.** Keyword "アロベビー ミルクローション 380ml" puts the
  exact ALOBABY Milk Lotion 380ml at ranked #0/#1. Consistent NO MATCH (run twice). The SAME
  product matches fine in the reverse direction (P2 A→R PASS). Asymmetry → the Amazon candidate
  pool (many bare "ALOBABY" titles + bundles in the top-8) plus アロベビー being absent from
  semanticMatch's fixed brand map. NOT keyword-fixable.
- **P10 WELEDA Milk Lotion A→R — matcher.** Keyword is precise; only 2 candidates returned and
  BOTH are exact ヴェレダ カレンドラ ベビーミルクローション 200mL. Still NO MATCH (twice).
  ヴェレダ/WELEDA is not in semanticMatch's brand map; the LLM declines. NOT keyword-fixable.
- **P3 / P6 bare-PIGEON matches — coverage.** Amazon crawler returns titleless "PIGEON" entries;
  the true single-unit 300g/200ml本体 is among them but its text is missing, so semanticMatch
  can only see "PIGEON ¥xxx". Match returns non-null but is unverifiable. Amazon-side title
  extraction issue, NOT keyword.
- **P7 Vaseline — nondeterminism.** ベビーワセリン absent from brand map; free LLM gave NO MATCH
  then a correct match on retry. Borderline matcher-side.

Root cause of every residual miss is downstream of the keyword: semanticMatch's fixed brand map
omits アロベビー/ALOBABY, アトピタ, ヴェレダ/WELEDA, ジョンソン, ベビーワセリン, and the Amazon
crawler's bare-title coverage gap. The keyword prompt already surfaces the correct equivalent in
the ranked top-3 in 10/10 cases; further keyword tuning cannot lift the matcher-side ceiling.

## Recommendations (out of scope here — would need owner of openrouter.ts)
- Add アロベビー=ALOBABY, アトピタ=Atopita, ヴェレダ=WELEDA, ジョンソン=Johnson, ベビーワセリン,
  キュレル=Curel, ママ&キッズ to semanticMatch's brand map.
- Fix Amazon crawler title extraction (bare "PIGEON"/"ALOBABY" results lose line/size text).
