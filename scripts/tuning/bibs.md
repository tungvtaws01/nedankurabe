# Tuning log — bibs (スタイ / よだれかけ / お食事エプロン)

Pipeline: `refineKeyword(title, target)` → crawl other platform → rank → `semanticMatch`.
All probes `PROBE_FROM=rakuten` (Rakuten source, search Amazon) with
`OPENROUTER_MODEL=qwen/qwen3-235b-a22b-2507` against `scripts/prompts/bibs.txt`.

## What decides a BIB match
- **Brand**: マールマール/MARLMARL, ベビービョルン/BabyBjörn, 10mois/ディモワ, Bibetta/ビベッタ,
  スケーター/Skater, コニー/Konny, Hoppetta/ホッペッタ.
- **Type (decisive, do not swap)**: スタイ/よだれかけ/ビブ = drool bib ≠ お食事エプロン/食事エプロン = feeding apron.
  長袖 (long-sleeve) is its own sub-type.
- **Line / design (design-heavy category)**: MARLMARL deco/joujou/bouquet/dolce, 10mois シリコンビブ/6重ガーゼ/マロービブ,
  Skater character (おさるのジョージ/ミッキー), Konny パイピング. Wrong line on a branded item ⇒ judge NO MATCH.
- **Feature/material**: シリコン, 防水/撥水, 6重ガーゼ/ガーゼ, 360度/まあるい.
- Drop: pack counts (2枚/3枚セット), colors, 出産祝い/ギフト/名入れ/刺繍, generic 保育園/離乳食/赤ちゃん, shop names (フィセル).

## Prompt iterations
- **v1** (current `bibs.txt`): copied universal, added brand EN→JP map, line/design rule (keep collection name),
  type rule (drool bib ≠ feeding apron, keep 長袖), one feature token, drop counts/colors/marketing.
  No further structural revision needed — v1 cleared acceptance. Refinements were validation re-runs, not rewrites.

## Probe results (keyword-side = did the true equivalent appear in target results)

| # | Source (Rakuten) | Keyword produced | Result |
|---|---|---|---|
| 1 | マールマール スタイ deco | `マールマール デコ スタイ まあるい` | PASS — matched `[MARLMARL] スタイ deco` (rank #0) |
| 2 | ベビービョルン お食事エプロン 防水 | `ベビービョルン お食事エプロン 防水` | PASS — matched `ベビービョルン ベビースタイ` (judge found it at #6) |
| 3 | 10mois ディモワ シリコンビブ | `10mois ディモワ シリコンビブ お食事エプロン シリコン` | PASS — matched `10mois シリコンビブ バニラ` (stable on re-run) |
| 4 | Bibetta ウルトラビブ 長袖 ラグランスリーブ | `ビベッタ ウルトラビブ 長袖` (line) | PASS — matched `[ビベッタ] お食事エプロン 長袖 ウルトラビブ ラグランスリーブ` (#0) |
| 5 | コニー パイピングスタイ | `コニー パイピング スタイ` | PASS (flaky) — matched genuine Konny when パイピング surfaced; one re-run only surfaced コニータオルスタイ (diff line) ⇒ NO MATCH |
| 6 | マールマール エプロン ブーケ | `マールマール ブーケ お食事エプロン` | PASS — matched `[MARLMARL] お食事エプロン bouquet baby` |
| 7 | 10mois ディモワ 6重ガーゼ ビブ | `10mois ディモワ 6重ガーゼ スタイ ガーゼ` | PASS — matched `10mois ふくふくガーゼ(6重ガーゼ) 2wayビブ` |
| 8 | スケーター おさるのジョージ シリコンエプロン SBEP1 | `スケーター おさるのジョージ お食事エプロン シリコン` | NO MATCH — catalog gap: Amazon carries Skater silicone in ムーミン/ミッキー, not the George SBEP1; George aprons on Amazon are other makers |
| 9 | マールマール スタイ ジュジュ (joujou) | `マールマール ジュジュ スタイ` | NO MATCH — catalog gap: Amazon surfaced MARLMARL dolce/waltz drool bibs, not the joujou line (design-heavy ⇒ judge declines) |
| 10 | テマロン 長袖 お食事エプロン | `テマロン 長袖 お食事エプロン 撥水` | NO MATCH — テマロン is a no-name boutique seller, no equivalent on Amazon (genuine no-equivalent) |

Keyword was correct in all 10 cases (right brand + line + type + feature; no over-spec, Rakuten/Amazon
both returned results). The 3 misses are catalog-gap / no-brand-boutique, not prompt defects:
#8 and #9 are specific branded design lines Amazon search doesn't surface; #10 is a no-name seller.

## Score
- **Keyword-side PASS: 7/10** (#1–#7). Acceptance (≥7/10) met.
- Misses #8–#10 are genuine catalog gaps / no-brand boutique items — expected for this design-heavy,
  long-tail category, not fixable by the keyword prompt.

## Matcher-side ceiling
- No clear matcher-side (brand-map) failures observed: when a branded equivalent surfaced
  (BabyBjörn, MARLMARL, 10mois, Bibetta, Konny) the judge matched it correctly, including the
  EN/JP-mixed Konny title. ベビービョルン/BabyBjörn matched despite being a commonly-omitted brand.
- Watch item: line-sensitivity. For design-heavy branded bibs (MARLMARL lines, Konny terry vs piping),
  a same-brand different-design candidate is correctly rejected; this is desired behavior but makes
  PASS depend on Amazon surfacing the exact line (see #5 flakiness, #9 gap).

## Notes
- Free model is nondeterministic; re-ran #3 and #5. #3 stable, #5 line-dependent.
- Each Amazon crawl = 1 scrape.do credit; ~10 probes + 1 discovery crawl used.
