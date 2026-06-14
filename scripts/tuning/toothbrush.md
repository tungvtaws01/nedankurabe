# Toothbrush category — keyword-prompt tuning log

Category: `toothbrush` (baby/kids 歯ブラシ・ハブラシ). Model: `qwen/qwen3-235b-a22b-2507`.
Goal: keyword surfaces the true cross-platform equivalent; `semanticMatch` then picks it.

## Discovery (crawler dumps, ground truth)

Per-platform dumps via `scripts/dump-search.ts`. Amazon JP returned Japanese titles (no EN→JP map needed).

Product structure that decides a match:
- **Brand**: ピジョン / コンビ テテオ / エビス(EBiSU) / ライオン クリニカKid's / HAMICO.
- **Line (Pigeon only)**: 乳歯ブラシ レッスン段階N (N is decisive — each stage is a different product) ; 乳歯ケア (finishing).
- **Type**: plain 歯ブラシ vs **仕上げみがき用/仕上げ専用** (finishing, parent-applied — DISTINCT product) vs **電動仕上げブラシ** (electric — DISTINCT).
- **Age/stage**: レッスン段階3/4, 0-2才用, 0.5〜2歳向け, 12か月~, 1才6か月~ — keep verbatim, never invent.
- Drop: colors, characters (ドラえもん/ハローキティ/いないいないばあっ/シナモロール…), counts (2本入/12本), codes (Ci602/B-6382), marketing.

Note: for Combi, brand `コンビ テテオ` alone identifies the line; appending `はじめて歯みがき` bloats the query and zeros Rakuten — dropped.

## Probes (PASS = SEMANTIC MATCH returns the true equivalent)

| # | Source (from) | Keyword (final) | Result |
|---|---|---|---|
| 1 | ピジョン 乳歯ブラシ レッスン段階4 1才6か月~ (amazon) | ピジョン 乳歯ブラシ レッスン段階4 1才6か月~ | PASS (matched 段階4 ブルー) |
| 2 | ピジョン 乳歯ブラシ レッスン段階2 (amazon) | ピジョン 乳歯ブラシ レッスン段階2 | PASS |
| 3 | ピジョン 乳歯ケア 仕上げ専用 全体みがき 12か月~ (amazon) | ピジョン 乳歯ケア 仕上げ専用 全体みがき 12か月~ | PASS (exact) |
| 4 | コンビ テテオ はじめて歯みがき 仕上げみがき用 (amazon) | コンビ テテオ 仕上げみがき用 歯ブラシ | PASS |
| 5 | コンビ テテオ あてて磨くだけ 電動仕上げブラシ グリーン (amazon) | コンビ テテオ 電動仕上げブラシ | PASS (picked actual brush, not 替えブラシ) |
| 6 | ライオン クリニカ Kids ハブラシ 0-2才用 (amazon) | ライオン クリニカKid's ハブラシ 0-2才用 | PASS (exact 0-2才用) |
| 7 | EBiSU エビス いないいないばあっ 仕上げみがき用 Sやわらかめ (amazon) | エビス 仕上げみがき用 歯ブラシ | PASS (exact, after age-rule fix) |
| 8 | HAMICO ハミコ ベビー歯ブラシ ドラえもん (amazon) | HAMICO 歯ブラシ | PASS (matched ドラえもん variant) |
| 9 | ピジョン 乳歯ブラシ レッスン段階3 グリーン 12か月頃から (rakuten→amazon) | ピジョン 乳歯ブラシ レッスン段階3 12か月頃から | PASS (re-run; first run had thin Amazon crawl) |
| 10 | コンビ テテオあてて磨くだけ電動仕上げブラシ グリーン (rakuten→amazon) | コンビ テテオ 電動仕上げブラシ | PASS (exact グリーン, distinguished from ピンク) |

**Keyword-side pass rate: 10/10.** Matcher-side ceilings (keyword #1 but judge NO MATCH): 0.

## Iterations & lessons

- **v1**: copied universal, added brand/line/type/age maps. Bug: model truncated `レッスン段階4`→bare `レッスン段階` and injected spurious 仕上げみがき用.
  Fix: step 4 demands the digit; step 3 says add 仕上げ/電動 ONLY if literally in the title.
- **v2 (key fix)**: Combi probes zeroed Rakuten — keyword was over-long (`コンビ テテオ はじめて歯みがき 仕上げみがき用`) AND model **invented** `1才6か月~`.
  Fix: drop `はじめて歯みがき` for Combi (brand suffices); use `電動仕上げブラシ` as the electric type token.
- **v3 (key fix)**: Ebisu consistently invented `0.5〜2歳向け` (the prompt's per-brand age *examples* were teaching the model to attach an age). Zeroed Rakuten.
  Fix: rewrote step 4 with an ABSOLUTE RULE — copy an age token ONLY if the exact characters appear in the title; otherwise emit none. This also stabilized Combi (stopped inventing 1才6か月~).

Near-final re-runs (free model is nondeterministic): Combi finishing, Ebisu, Pigeon stage-3 each re-run — stable PASS after v3.

## Brand-equivalence map (matcher-side) — follow-up
No matcher-side NO-MATCH ceilings hit in this category. The judge already handles ピジョン/コンビ/エビス/ライオン クリニカ/HAMICO equivalence (incl. JP/EN brand forms like EBiSU↔エビス, Combi↔コンビ). No additions required for toothbrush. Brands not yet probed (no follow-up evidence): 和光堂/にこピカ, シュシュ, チュチュ.
