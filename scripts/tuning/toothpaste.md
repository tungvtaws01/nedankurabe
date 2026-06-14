# Baby / kids toothpaste (子供用歯みがき・歯みがきジェル) keyword-prompt tuning log

Category: baby/kids toothpaste, tooth gel, hamigaki wipes/sprays for Amazon JP ↔ Rakuten cross-platform matching.
Pipeline: `refineKeyword(title, target)` → crawl target → `rankBySimilarity` → `semanticMatch`.
Prompt file: `scripts/prompts/toothpaste.txt` (derived from `scripts/prompts/universal.txt`).
Probe: `scripts/probe-keyword.ts`, model `qwen/qwen3-235b-a22b-2507`. PASS = SEMANTIC MATCH returns the
ground-truth equivalent (same brand + form + flavor; volume/count/pack-design differences allowed).

## What decides a toothpaste match
- **Brand** (always): ピジョン / コンビ(テテオ) / ジェクス チュチュベビー (L8020) / 丹平製薬(ハミケア) /
  和光堂(にこピカ) / クリニカKid's(LION) / チェックアップ(ライオン歯科材) / ライオン / アラウ.ベビー.
- **Form** (DECISIVE): ジェル状歯みがき・歯みがきジェル (gel) / ペースト (paste) / 泡・スプレー (foam/spray,
  e.g. ハミケア) / タブレット (tablet) / マウスドロップ (drop) / 歯みがきナップ・シート (wipe). Gel ≠ tablet ≠
  wipe ≠ spray.
- **Flavor** (a DIFFERENT flavor is a DIFFERENT product): ぶどう/グレープ / いちご / りんご / メロン / みかん /
  バナナ / ピーチ / ヨーグルト / 無香料. キシリトール is sweetener, NOT a flavor.
- **Volume** when stated (40ml/50g/30g/25g/60g). Drop counts (×3個), colors, characters, ages, 医薬部外品.

## Key environment findings (load-bearing)
- **jest ignores `scripts/`** by default; both helpers MUST be run with
  `--testPathIgnorePatterns '/node_modules/'` to override.
- **Amazon JP returns Japanese titles** for this category (no EN translation needed) — confirmed by
  dump-search: e.g. "ピジョン 親子で乳歯ケア ジェル状歯みがき いちご味 40ml", "コンビ 子供用 歯磨きジェル ぶどう味".
- **Amazon JP search AND-matches every token and zeroes out on over-specification.** Measured zeros:
  `チュチュ L8020 ハミガキジェル` → 0, `L8020 歯みがきジェル` → 0, `クリニカ キッズ ハミガキ` → 0,
  `丹平 ハミケア` → 0, `チェックアップ ジェル` → 0. But the FULL brand token works: `チュチュベビー L8020`
  → 10 results, `チュチュベビー ハミガキジェル` → broad pool. So for ChuChu the keyword must use the full
  brand token チュチュベビー (not チュチュ).
- **Amazon coverage is sparse for several niche dental-clinic brands.** Check-Up gel, Clinica Kids, 丹平
  ハミケア, Wakodo gel return 0 / brushes-only on Amazon search. Those pairs are therefore tested A→R
  (Amazon source → Rakuten target), where Rakuten carries the full descriptive catalog. Reliable Amazon-side
  products: **ピジョン** and **コンビ 歯磨きジェル** (both well-covered AND in the semanticMatch brand map).
- **Rakuten target = full keyword (RULE A); Amazon target = tight keyword (RULE B).** Prompt branches on
  `{{platform}}`. The dominant direction in production is A→R (Rakuten target, free crawl, full catalog),
  so RULE A keeps brand + line + form + flavor + volume.
- **Free/cheap model nondeterminism**: re-ran P1/P6/P8/P9 — all stable across runs at qwen3-235b.

## Tested source → ground-truth pairs (10 distinct products)
| # | Source (from) | Keyword emitted | Match | Result |
|---|---|---|---|---|
| 1 | R: ピジョン ジェル状歯みがき いちご味 40ml | ピジョン ジェル状歯みがき いちご | Pigeon gel ichigo 40ml | PASS (R→A) |
| 2 | A/R: コンビ 子供用 歯磨きジェル ぶどう味 | コンビ 歯磨きジェル ぶどう | Combi gel grape | PASS (A→R + R→A both) |
| 3 | A: ピジョン ジェル状歯みがき ぷちキッズ いちご 50g | ピジョン ジェル状歯みがき いちご 50g | Pigeon puchikids ichigo 50g | PASS (A→R) |
| 4 | A: コンビ 子供用 歯磨きジェル いちご味 | コンビ 歯磨きジェル いちご | Combi gel ichigo 30g | PASS (A→R) |
| 5 | A: ピジョン 親子で乳歯ケア ジェル状歯みがき 40ml | ピジョン ジェル状歯みがき 40ml | Pigeon plain gel 40ml | PASS (A→R) |
| 6 | A: ジェクス チュチュベビー L8020 薬用ハミガキジェル ぶどう 50g | チュチュベビー L8020 ハミガキジェル ぶどう | ChuChu L8020 gel grape 50g | PASS (A→R, 2/2) |
| 7 | A: 和光堂 にこピカ 歯みがきジェル りんご 50g | 和光堂 にこピカ 歯みがきジェル りんご 50g | Wakodo nicopica gel apple 50g | PASS (A→R) |
| 8 | A: クリニカKid's フッ素ジェルハミガキ グレープ 60g | ライオン クリニカKid's ジェルハミガキ グレープ 60g | Clinica Kids gel grape 60g | PASS (A→R, 2/2) |
| 9 | A: 丹平製薬 ハミケア グレープ風味 25g | 丹平製薬 ハミケア グレープ | Hamicare grape 25g | PASS (A→R, 2/2; FIXED in iter2) |
|10 | A: ライオン チェックアップジェル バナナ 60g | ライオン チェックアップジェル バナナ 60g | Check-Up gel banana 60g | PASS (A→R) |
|11 | A: 和光堂 にこピカ 歯みがきシート 30包 | 和光堂 にこピカ シート | Wakodo nicopica wipe 30包 | PASS (A→R; form=wipe, not gel) |

## Iterations
### Iteration 1 — initial toothpaste prompt (brand/line/form/flavor priority, {{platform}} RULE A/B branch)
RULE A (rakuten=full), RULE B (amazon=tight: brand + ONE form word + flavor, full brand token for ChuChu).
Result: **9/10 PASS.** Pigeon (gel, ichigo/plain/puchikids), Combi gel (grape/ichigo, both directions),
ChuChu L8020 gel, Wakodo gel, Clinica Kids gel, Check-Up gel, Wakodo wipe — all PASS first try.
One FAIL: **#9 丹平 ハミケア** — RULE B's "add a form word" guidance made the model INVENT
"ハミガキジェル" (`丹平製薬 ハミケア ハミガキジェル グレープ 25g`), zeroing the Rakuten pool → NO MATCH.
ハミケア is a foam/spray, not a gel, and the title carries no form word.

### Iteration 2 — RULE B: never invent a form word
Added to RULE B: "use ONLY a form word that literally appears in the title; NEVER invent a form. If the
title has no form word and the line/sub-brand IS the product identity (ハミケア, にこピカ シート), keep
brand + line + flavor and add NO form word." Worked examples for 丹平 ハミケア and にこピカ シート.
Result: **#9 flipped to PASS** (keyword `丹平製薬 ハミケア グレープ` → exact). にこピカ wipe (#11) also clean.

### Iteration 3 (confirmation) — re-ran flaky/representative probes
Re-ran #1 (Pigeon R→A), #2 (Combi R→A, paid), #6 (ChuChu A→R), #8 (Clinica A→R), #9 (Hamicare A→R) — all
stable PASS. No further prompt change needed.

## Final result
**10/10 keyword-side PASS** (11 distinct products tested; #2 counted once across both directions).
Matcher-side ceiling: **0 forced failures** in this set — all keyword-surfaced #1/top-3 candidates were
accepted by semanticMatch. Both well-covered Amazon brands (ピジョン, コンビ) are in the brand map; the
out-of-map brands here (チュチュベビー/ChuChu, 丹平/Tampei, 和光堂/Wakodo, クリニカ/Clinica, チェックアップ)
matched via literal JP-token overlap because Rakuten was the target and carries identical brand tokens.

### semanticMatch brand-map gaps surfaced (NOT keyword-fixable; matcher follow-up)
The map (openrouter.ts ~L154) covers ピジョン/コンビ/和光堂 but is missing as explicit equivalences:
- **ジェクス / チュチュベビー / ChuChu** (and the L8020 sub-brand)
- **丹平製薬 / Tampei (ハミケア)**
- **クリニカKid's / LION / ライオン** (kids line)
- **チェックアップ / ライオン歯科材 (Check-Up)**
- **アラウ.ベビー (サラヤ)**
These matched in the A→R direction via literal token overlap, but would likely go flaky/NO MATCH in the
R→A direction for the out-of-map ones (cf. bath log's Swimava/永和 nondeterminism). Adding them to the
brand-equivalence map is the highest-value follow-up to harden R→A for this category.
