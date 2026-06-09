# Carriers (抱っこひも / baby carriers) — keyword prompt tuning log

Category prompt: `scripts/prompts/carriers.txt`
Pipeline: `refineKeyword(title, targetPlatform)` → crawl target → `rankBySimilarity` → `semanticMatch`.
Decisive dimensions for carriers: **brand + EXACT model/line** (katakana ⇄ English). Essentially no count dimension; carry-position/size is secondary.

## Method
- Discovered ~10 carrier products per platform via the dump helper across brands
  (Ergobaby, BabyBjorn, Aprica, napnap, Combi, Konny) and models.
- Confirmed the prior lesson: **Amazon JP carrier titles come back English-translated**
  (e.g. "Ergobaby ... OMNI Breeze Baby Carrier, Heathered Denim Blue ... CREGBCZ360PHTRDNM"),
  while Rakuten titles are katakana. Prompt therefore carries an EN→JP brand + model map and outputs JP only.
- Built a 10-product canonical test set (mix of both source platforms) + 3 extra robustness probes.
- PASS = `semanticMatch` returns the true cross-platform equivalent (same brand + exact model).
- Ran each probe at least once; re-ran the lone failure (Harmony) 3× to confirm it is non-deterministic / matcher-side.

## Canonical test set (source → ground-truth equivalent)
| # | Dir | Source (brand / model) | Result |
|---|-----|------------------------|--------|
| 1 | R→A | Ergobaby OMNI Breeze, Heathered Denim Blue | PASS — matched OMNI Breeze Heathered Denim Blue |
| 2 | A→R | Ergobaby ADAPT SoftFlex Onyx Black | PASS — matched アダプト ソフトフレックス |
| 3 | R→A | BabyBjorn Harmony Anthracite | **NO MATCH** (matcher-side; see below) |
| 4 | A→R | BabyBjorn Mini Air Gray | PASS — matched ミニ エアー MINI Air |
| 5 | R→A | Aprica Koala Ultra Mesh EX | PASS — matched Koala Ultra Mesh EX |
| 6 | A→R | napnap Tran Hip Seat double-shoulder | PASS — matched トラン ヒップシート |
| 7 | R→A | Ergobaby EMBRACE | PASS — matched EMBRACE Soft Air |
| 8 | A→R | Ergobaby OMNI Breeze Pearl Gray (EN, bonus bundle) | PASS — matched オムニ ブリーズ |
| 9 | A→R | BabyBjorn One KAI Air Anthracite | PASS — matched ONE KAI Air アンスラサイト |
| 10 | A→R | Aprica Koala Ultra Mesh EX Heather Blue (EN) | PASS — matched コアラ ウルトラメッシュ EX ヘザーブルー |

Extra robustness probes (all PASS):
- R→A Ergobaby OMNI 360 Cool Air → OMNI 360 Cool Air/Oxford Blue
- R→A BabyBjorn Move (エアリーメッシュ) → BabyBjörn Move Airy Mesh
- A→R Ergobaby EMBRACE Grey (EN) → エンブレース ソフトエア

## Iterations
**Iteration 1 (initial prompt):** EN→JP brand map (Ergobaby/BabyBjorn/Aprica/Combi/napnap/POGNAE/BABY&Me/Konny/montbell) + model map (OMNI Breeze/360/Deluxe, ADAPT SoftFlex/SoftTouch, EMBRACE, Aerloom, Alta; Harmony/Move/One KAI Air/Mini Air/Free; Koala Ultra Mesh EX/Koala/Colanghug; Tran/Vision/BASIC). Priority brand → exact model → carry-type only if distinguishing (napnap Tran ヒップシート). Tight 2-4 tokens; explicit "do NOT add color/新生児/4WAY/メッシュ/marketing".
Result: **9/10** canonical PASS. Only miss = Harmony R→A.

**Iteration 2:** Refined model map for OMNI 360 (note Rakuten form `オムニ 360 クールエア`, keep クールエア when Cool Air present) and Move/MOVE=ムーブ. Added 2 new probes (Omni 360 R→A, Move R→A) — both PASS. Re-verified Aprica R→A — no regression.

**Iteration 3:** Disambiguated the One Air vs One KAI Air mapping (`One KAI Air=ワンカイエアー`, `One Air=ワンエアー` on separate lines). Added Embrace A→R (English source) probe — PASS. One KAI Air regression — PASS. Re-ran Harmony R→A (2nd & 3rd time) — still NO MATCH.

## Final pass rate
**9/10 end-to-end on the canonical set (+3/3 extra robustness probes = 12/13 overall).** Exceeds the ≥7/10 acceptance bar.

## Unfixable failure — diagnosis (keyword vs matcher vs coverage)
**#3 BabyBjorn Harmony (R→A): MATCHER-SIDE, not keyword-fixable.**
- The generated keyword is optimal: `ベビービョルン ハーモニー`. The Amazon search returns the
  exact ground truth and `rankBySimilarity` places it in the **top 3**
  (idx 2: "BabyBjörn Harmony Anthracite Baby Carrier, ... From 0 to 36 Months" — same brand, model, AND color).
- Despite the perfect candidate being ranked top-3, `semanticMatch` returns `{"matches": []}` consistently
  across 3 runs.
- Root cause (read-only inspection of `src/lib/llm/openrouter.ts` semanticMatch brand-equivalence list, lines ~154-157):
  the brand map enumerates Pampers/Merries/Moony/Goon/Pigeon/Combi/Aprica/**Ergobaby**/Meiji/Morinaga/Snow/Wakodo/Kao
  but has **NO `BabyBjörn = ベビービョルン` entry**. Combined with the English title using the umlaut form
  "BabyBjörn", the matcher fails to confirm brand equivalence between JP source and EN candidate.
- Consistent corroboration: BabyBjorn matches that target **Rakuten** (Mini Air #4, One KAI Air #9, Move) PASS,
  because Rakuten candidate titles contain BOTH `ベビービョルン` and `BabyBjorn`, giving the matcher enough
  anchor without the missing map entry. Only the R→A direction (searching English-only Amazon titles) fails.
- Fix would require adding `BabyBjorn/BabyBjörn = ベビービョルン` to the semanticMatch brand map in
  `src/lib/llm/openrouter.ts` — OUT OF SCOPE for this task (must not edit that file). Recorded as a matcher-side
  follow-up, not a keyword deficiency.

## Notes / lessons reused & confirmed
- Amazon carrier titles are English-translated → EN↔JP brand+MODEL map in the prompt is essential. Confirmed.
- Keep the Rakuten keyword TIGHT (brand + model, 2-4 tokens). Dropping color/新生児/4WAY/メッシュ/marketing
  keeps result sets healthy. Confirmed — no zeroed searches across 13 probes.
- Model name is the single decisive token and the prompt forbids dropping/generalizing it. Confirmed: every
  PASS hinged on the correct katakana model surfacing.
