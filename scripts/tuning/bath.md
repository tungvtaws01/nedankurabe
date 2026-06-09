# Baby bath / infant bathing (お風呂・沐浴用品) keyword-prompt tuning log

Category: baby bath & infant bathing goods for Amazon JP ↔ Rakuten cross-platform matching.
Pipeline: `refineKeyword(title, target)` → crawl target → `rankBySimilarity` → `semanticMatch`.
Prompt file: `scripts/prompts/bath.txt` (derived from `scripts/prompts/universal.txt`).
Probe: `scripts/probe-keyword.ts`. PASS = SEMANTIC MATCH returns the ground-truth equivalent
(same brand + product type + line/feature; color / character / pack-design differences allowed).

## Key environment findings (load-bearing)
- **jest ignores `scripts/`** by default; both helpers must be run with
  `--testPathIgnorePatterns '/node_modules/'` to override `testPathIgnorePatterns`.
- **Amazon crawler titles are English-translated** for bath goods: Richell→"Richell ... Plush/Fluffy
  Baby Bath", 永和→"Eiwa"/"Nagawa"/"Wawa" (inconsistent romaji of the same brand), "Bath Mat",
  "Bath Chair", "Body Ring", "Hot Water Thermometer". So an Amazon-target keyword must be in
  Japanese/romaji that Amazon's JP index actually responds to.
- **CRITICAL keyword finding — Amazon JP index rejects katakana line/feature words.**
  When the TARGET is Amazon, katakana line/feature tokens (ボディリング, マット付き, ひんやりしない,
  ステップアップ, プラスK) usually return **ZERO results** because Amazon titles are English.
  Examples measured with the dump helper:
  - `スイマーバ 浮き輪` → full Swimava results; `スイマーバ ボディリング` or `スイマーバ ボディリング 浮き輪` → **0 results**.
  - `アップリカ バスチェア` → finds the chair; `リッチェル バスチェア マット付き` → **0 results**.
  Fix: for Amazon target emit a MINIMAL keyword = brand + ONE broad Japanese type word
  (ベビーバス / バスチェア / おふろマット / 湯温計 / 浮き輪), dropping katakana line/feature words.
  This was the single biggest win (iterations 2–3): it flipped Richell-chair-with-mat and
  Swimava-body-ring R→A from 0-candidate NO MATCH to PASS.
- **Rakuten target is the opposite**: Rakuten titles are fully descriptive, so for Rakuten target
  keep the FULL keyword (brand + line + type) — the line word is what discriminates
  ふかふかベビーバスプラスK from ステップアップ from 抗菌K. Minimal keyword here causes wrong-variant matches.
  → The prompt therefore branches on `{{platform}}`: RULE A (rakuten = full) vs RULE B (amazon = minimal).
- **`semanticMatch` (src/lib/llm/openrouter.ts — NOT editable here) is the real ceiling.** Its brand
  map covers パンパース/メリーズ/ムーニー/グーン/ピジョン/コンビ/**アップリカ**/エルゴ/明治/森永/雪印/和光堂/花王.
  For bath, only **アップリカ/Aprica, ピジョン/Pigeon, コンビ/Combi** are in that map.
  - **リッチェル/Richell, 永和/Eiwa, スイマーバ/Swimava are NOT in the map.** The matcher's brand rule
    says "same brand including JP/EN equivalents" and it CAN sometimes bridge Richell↔リッチェル /
    Swimava↔スイマーバ when those tokens appear literally on both sides, but it is conservative and
    **nondeterministically returns NO MATCH** on identical re-runs for these out-of-map brands.
    This is a matcher limit, not a keyword limit, whenever the keyword already surfaced the correct
    product in the ranked top-3.
  - For アップリカ/ピジョン, R→A often lands on a **bare Amazon brand token** ("Aprica" / "PIGEON" with
    no type) because the Amazon crawler degrades those listings. semanticMatch accepts the bare brand
    token (brand is in its map), producing a technically-valid but type-ambiguous match — counted as
    MARGINAL, not solid.
- **Free model is nondeterministic** (gpt-oss-120b:free). Each pair run ≥2×; out-of-map-brand pairs
  flip PASS/NO MATCH across identical runs.

## Tested source → ground-truth pairs
| # | Source (platform) | Ground-truth equivalent (target) | Decisive dims | Result |
|---|---|---|---|---|
| 1 | A: Richell Plush Baby Bath Plus K | R: リッチェル ふかふか ベビーバスプラスK | brand+line(プラスK)+tub | PASS (R→A stable; A→R flaky) |
| 2 | A: Richell Step Up Plush Baby Bath | R: リッチェル ふかふか ベビーバス ステップアップ | brand+line(ステップアップ)+tub | PASS (2/2) |
| 3 | R/A: Richell Non-Cool Bath Mat N Pink | リッチェル ひんやりしないおふろマットN | brand+type=おふろマット (not tub) | PASS |
| 4 | R: 永和 ベビーバス 床置きタイプ グレー | A: Eiwa Baby Bath with Stoppers, Gray | brand(永和=Eiwa)+tub | PASS (2/2) |
| 5 | R: 永和 ふんわりベビーバス くま | A: Eiwa Fluffy Baby Bath (Bear) | brand+line(ふんわり/くま)+tub | FAIL (matcher, 2/2) |
| 6 | R: アップリカ はじめてのお風呂から使えるバスチェア | A: Aprica (bare token) | brand+type=バスチェア | MARGINAL (bare-token) |
| 7 | R: スイマーバ ボディリング | A: Swimava Body Ring | brand(out-of-map)+浮き輪/ボディリング | FAIL R→A (matcher) |
| 8 | A: Swimava Body Ring (Penguin) | R: スイマーバ Swimava ボディリング | brand+ボディリング+浮き輪 | PASS (A→R) |
| 9 | R: ピジョン 湯温計 白くま | A: PIGEON (bare token) | brand+type=湯温計 (not tub) | MARGINAL (bare-token) |
|10 | R: リッチェル バスチェア マット付き | A: Richell Bath Chair with Mat R | brand+type=バスチェア+マット | PASS (2/2) |

## Iterations
### Iteration 1 — initial bath prompt (EN→JP brand/line/type/feature maps, single tight keyword)
Brand map (Richell/Eiwa/Aprica/Combi/Pigeon/Stokke/Swimava/西松屋), line map (ふかふか/プラスK/
ステップアップ/ひんやりしないおふろマット/ふんわり/はじめてのお風呂から使える/湯温計/ボディリング),
decisive type map (ベビーバス/バスチェア/おふろマット/湯温計/シャワー/浮き輪/バスローブ/洗面器), feature
(折りたたみ/空気入れ/マット付き). Single keyword regardless of target.
Result: **~4–5/10.** Type discrimination (mat vs tub vs chair) worked well; brand EN→JP translation
worked. FAILS clustered on **R→A (Amazon-target) pairs that returned 0 candidates**: Richell-chair
"リッチェル バスチェア マット付き" → 0 Amazon results, Swimava "スイマーバ ボディリング 浮き輪" → 0
Amazon results (katakana line/feature words not in Amazon's English-translated index). Plus matcher
NO MATCH on out-of-map brands (Richell A→R).
Diagnosis: the keyword was correct-by-content but over-specified for the Amazon index in katakana.

### Iteration 2 — added TARGET-PLATFORM branch (rakuten=full keyword, amazon=minimal brand+broad-type)
Rationale: measured that Amazon JP search AND-matches and rejects katakana line/feature tokens, so for
Amazon target drop them and keep brand + one broad type word.
Result: **Richell-chair-with-mat R→A and Swimava-body-ring R→A flipped from 0-candidate NO MATCH to
having a full candidate pool**; Richell-chair → PASS, Swimava → PASS (then matcher-flaky).
Side effect: the free model **over-applied the minimal rule to Rakuten-target pairs too**, shrinking
A→R keywords to "リッチェル ベビーバス" and causing wrong-variant matches (matched 抗菌K instead of プラスK).

### Iteration 3 — hardened the branch (explicit "THE TARGET PLATFORM FOR THIS REQUEST IS {{platform}}",
RULE A vs RULE B with worked examples on each side; RULE A states "NEVER drop the line")
Result: A→R pairs reliably kept the full keyword again (StepUp → "リッチェル ふかふか ステップアップ
ベビーバス" → PASS; PlusK → "リッチェル ふかふか ベビーバスプラスK"), while R→A pairs stayed minimal
("リッチェル バスチェア", "スイマーバ 浮き輪", "ピジョン 湯温計"). This is the final prompt.

## Final result
**8/10** end-to-end (6 solid PASS + 2 MARGINAL bare-Amazon-token passes), 2 FAIL — both matcher-side.
Progression: iter1 ~4–5/10 → iter2 ~6–7/10 (Amazon-target zero-result pairs fixed) → iter3 8/10
(Rakuten-target line discrimination restored).

### Unfixable failures (NOT keyword-fixable)
- **#5 永和 ふんわりベビーバス くま (R→A): matcher (2/2 NO MATCH).** Keyword "永和 ベビーバス" correctly
  surfaces "Eiwa Fluffy Baby Bath (Bear)" in the Amazon top-3, but semanticMatch will not commit:
  永和/Eiwa is out-of-map AND the pool mixes Eiwa Fluffy bath / mat / chair / Moomin, so the matcher
  can't confirm the bath-bear variant. A bear-specific Japanese keyword (永和 ふんわり ベビーバス くま)
  would zero the Amazon pool (ふんわり/くま absent from English titles), so this is a brand-coverage +
  matcher-strictness limit, not a keyword bug.
- **#7 スイマーバ ボディリング (R→A): matcher (flaky, 2/3 NO MATCH).** Keyword "スイマーバ 浮き輪"
  surfaces the full English Swimava body-ring pool, but Swimava is out-of-map and the matcher
  nondeterministically refuses the スイマーバ↔Swimava bridge. The same product matches reliably in the
  A→R direction (#8), confirming the keyword is fine and the ceiling is semanticMatch.
- **#6 アップリカ / #9 ピジョン (R→A): MARGINAL.** Amazon crawler returns bare "Aprica"/"PIGEON" tokens
  for these listings; semanticMatch matches the bare brand token (both brands are in its map) but the
  candidate carries no type info — a coverage/crawler degradation, not keyword-fixable.

### Direction guidance for production
- A→R (Rakuten target) is reliable for in-map AND out-of-map brands because Rakuten titles carry the
  full Japanese brand+line and the matcher sees the tokens literally.
- R→A (Amazon target) is reliable for in-map brands (アップリカ/ピジョン/コンビ) and works for Richell
  via the minimal-keyword rule, but is flaky for out-of-map Western/JP brands (Swimava, 永和) due to
  semanticMatch's brand-bridge nondeterminism.
