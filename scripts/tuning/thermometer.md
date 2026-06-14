# Tuning log — thermometer (ベビー体温計)

Category: baby/home thermometers — ear (耳式), forehead/contactless (非接触/おでこ),
predictive armpit (予測式/わき). Pipeline: refineKeyword → crawl other platform → rank →
semanticMatch. Model: qwen/qwen3-235b-a22b-2507. Primary direction tested: Amazon→Rakuten
(Rakuten target = free crawl).

## What decides a thermometer match
- **Brand**: ピジョン/Pigeon, オムロン/OMRON, タニタ/TANITA, シチズン/CITIZEN,
  ドリテック/dretec, テルモ/TERUMO, A&D, ベビースマイル/BabySmile.
- **Model code** (decisive): 耳チビオン(C232), MC-682, TO-204/TO-206, HL710H, BT-542,
  S-712, UT-701/UTR-701A, ET-P330MZ. Strip color suffix (MC-682-BA→MC-682, TO-204WT→TO-204).
- **Measurement type** (decisive, ear ≠ forehead ≠ predictive): 耳式 / 非接触 / 予測式.
- Drop: colors, character names (マイメロディ/ちいかわ/サンリオ), counts, JAN, marketing.

## Key empirical findings
- **Rakuten zeros on a 2nd type token.** `タニタ BT-542 非接触 おでこ` → count 0;
  `タニタ BT-542 非接触` → finds it. Same for おでこ+かざす and 予測式+わき. Fix: prompt now
  emits AT MOST ONE type token and prefers 非接触 over おでこ/かざす. (iteration 2)
- **Model code is the strongest signal.** Brand + bare model code alone surfaces the exact
  product nearly every time; the type token is optional safety. Color-suffixed codes
  (TO-204WT) are kept but stripped to bare (TO-204) for wider recall.
- **Accessory exclusion works.** Pigeon プローブカバー listings rank below the 耳チビオン body;
  prompt flags カバー/ケース as out-of-scope. Not tuned as matchable products.

## Probe results (PASS = SEMANTIC MATCH returns true equivalent)

| # | Source (Amazon) | Keyword emitted | Result |
|---|---|---|---|
| 1 | ピジョン 耳チビオン N 耳式 | `ピジョン 耳チビオン 耳式` | PASS (耳チビオン N body) — rerun PASS |
| 2 | オムロン けんおんくん MC-682 | `オムロン けんおんくん MC-682 予測式` | PASS (MC-682 けんおんくん) — rerun PASS |
| 3 | ドリテック やわらかタッチ TO-204WT | `ドリテック やわらかタッチ TO-204 予測式` | PASS (TO-204WT) |
| 4 | ベビースマイル Pit+ S-712 | `ベビースマイル Pit S-712 おでこ 耳式` | PASS (Pit+ S-712 2WAY) |
| 5 | シチズン HL710H 非接触 | `シチズン HL710H 非接触` | PASS (HL710H) |
| 6 | タニタ BT-542-BL 非接触 | `タニタ BT-542 非接触` | PASS after iter2 (was NO MATCH: おでこ zeroed) — rerun PASS |
| 7 | A&D でこピッと UTR-701A | `A&D でこピッと UTR-701A 非接触` | PASS (UTR-701A-JC2) |
| 8 | A&D でこピッと UT-701 | `A&D でこピッと UT-701 非接触` | PASS (UT-701) |
| - | ドリテック サンリオ TO-206PK | `ドリテック やわらかタッチ TO-206 予測式` | keyword PASS (TO-206 #0) but judge NO MATCH → MATCHER-side |
| - | テルモ ET-P330MZ | `テルモ ET-P330MZ 予測式` | keyword PASS (exact ET-P330MZ #0) but judge NO MATCH → MATCHER-side (TERUMO not in brand map) |

Reverse (Rakuten→Amazon) spot-checks for OMRON MC-682 and CITIZEN HL710H returned 0 Amazon
candidates (empty Amazon result set for these queries) → crawl/availability on reverse path,
not a keyword defect (identical keywords pass forward).

## Scorecard
- **Keyword-side PASS: 9/10** (8 full end-to-end PASS + TERUMO & dretec-TO-206 where the
  keyword ranks the true equivalent #0 but the judge rejects it).
- **End-to-end PASS: 8/10.**
- **Matcher-side ceiling: 2** — TERUMO/テルモ (brand-equivalence map omits it) and the dretec
  TO-206 Sanrio variant (judge over-strict on character-name divergence / dretec mapping).

## Prompt iterations
1. v1 (copy of universal, customized): brand + line + model + type, accessory exclusion,
   English→JP brand/line maps. 7/8 forward PASS; TANITA failed (emitted 非接触 おでこ → Rakuten 0).
2. v2: type rule rewritten — emit AT MOST ONE type token, prefer 非接触 over おでこ/かざす,
   prefer 予測式 over わき, type optional when a model code is present. TANITA → PASS. Final.
