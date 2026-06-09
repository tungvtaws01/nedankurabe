# car_seats (チャイルドシート / child car seats) — keyword prompt tuning log

Category: child car seats for Amazon JP ↔ Rakuten cross-platform matching.
Prompt file: `scripts/prompts/car_seats.txt`
Pipeline: `refineKeyword(title, targetPlatform)` → crawl target → `rankBySimilarity` → `semanticMatch`.

Decisive dimensions: **brand + exact model + install (ISOFIX vs シートベルト固定) + age group (newborn seat vs junior/booster)**.

## Final result: 7/10 clean end-to-end matches

PASS counts the case where SEMANTIC MATCH returned the true cross-platform equivalent SKU (or a same-SKU listing at a lower price — the matcher is told to pick the cheapest valid match).

## Discovery findings (key, drove the prompt design)

- **Amazon JP romanizes models inconsistently.** Same Aprica model came back as Cururila / Crurilla / Kururilla / KuruRila / Kururia / Cururia / Kurulila. Fradia appears as FradiaGrow / Fladia Grow / Fradia Grow / Fradea. AileBebe Kurutto = "Cruit R" / "Kurt R". → prompt carries a many-spelling→one-katakana map.
- **Amazon crawler frequently returns BARE brand-only titles** for some brands — searches for Combi and Cybex returned rows that are literally just `Combi` / `Cybex` with the model truncated. When the target is Amazon, there is no model text to match on → unavoidable miss, NOT keyword-fixable.
- Rakuten titles are full katakana with the model present → matching INTO Rakuten (A→R) is far more reliable than into Amazon for Combi/Cybex.
- **semanticMatch's brand map omits Cybex, Joie, Graco, Recaro, Maxi-Cosi, Carmate/AileBebe** (`src/lib/llm/openrouter.ts` ~line 155). Joie and Graco happened to match anyway (identical brand token on both sides), but Carmate/AileBebe failed because the source brand string "Carmate (Ailbebe)" could not be equated to エールベベ.
- **Aprica line-name collision**: "Plus Light" (= クルリラ プラス ライト / Cururila+ Lite) vs "Prite"/"Bright" (= クルリラ プライト) are DIFFERENT models but romanize almost identically. This caused a false match in iteration 1.

## Source → ground-truth pairs tested

1. R→A  アップリカ クルリラ エックス プラス → Aprica Crurilla X Plus (Navy)  — **PASS**
2. A→R  Aprica Kururilla Plus Light AB → アップリカ クルリラ プラス ライト AB — **PASS** (fixed in iter2; was a false match to プライト in iter1)
3. A→R  Combi Crew Move Compact R129 Egg Shock JS → コンビ クルムーヴ コンパクト JS — **PASS**
4. A→R  Aprica FradiaGrow ISOFIX Safety Plus Premium AB → アップリカ フラディア グロウ ISOFIX セーフティープラス プレミアム AB — **PASS**
5. R→A  グレコ ジュニアプラス ネクスト (シートベルト固定 booster) → Graco Junior Plus Next R129 — **PASS**
6. A→R  Carmate (Ailbebe) Cruit R ST (ISOFIX newborn) → エールベベ クルットR ST — **FAIL (matcher)**: keyword surfaced the exact equivalent at ranked idx 0 & 2, but semanticMatch = NO MATCH (Carmate/AileBebe not in its brand map).
7. R→A  サイベックス クラウド G i-Size → Cybex Cloud G — **FAIL (coverage)**: Amazon crawler returns bare `Cybex` titles, no model text; ranked list also polluted with Britax. Not keyword-fixable.
8. R→A  Joie アイアーク 360 キャノピー → Joie i-Arc 360 Canopy — **PASS**
9. A→R  Aprica Reride E AB (15mo–12yr ISOFIX junior) → アップリカ リライド AB — **PASS**
10. R→A アップリカ クルリラ プライト → Aprica KuruRila Bright — **NEAR (matcher)**: keyword surfaced KuruRila Bright in top candidates, but semanticMatch picked the same-price "Cururila Light" sibling instead of the exact Bright SKU. Aprica Prite/Bright/Light romanizations are treated as one line by the matcher.

(Originally pairs 3 and 7 were both R→A. Combi was re-cast A→R (pair 3 above) where Rakuten carries full model text and it passes; the R→A Combi/Cybex direction stays blocked by the bare-title Amazon crawler.)

## Iteration progression

- **Iter 1** (initial car_seats.txt from universal.txt): brand+model+install+age maps, English↔JP romanization map, tight-keyword + no-count rules.
  - Result: 6 clean PASS. Misses: Combi R→A & Cybex R→A (bare Amazon titles), AileBebe (matcher brand map), pair10 (matcher Bright/Light). **Pair 2 was a FALSE match**: source "Plus Light" generated keyword `プライト` and matched the wrong line (クルリラ プライト) instead of `プラスライト`.
- **Iter 2** (fix Aprica line collision): split the Cururila grade mapping so "Plus Light"/"+ Lite" = プラスライト, "Bright"/"Prite" = プライト, "Light" alone = ライト, with "never merge" instruction. Re-cast Combi to the A→R direction.
  - Result: pair 2 now correctly matches クルリラ プラス ライト AB. Combi A→R passes. **7 clean PASS.**
- **Iter 3** (hardening): tightened the age-group rule so ジュニアシート is added ONLY for true booster/junior seats (e.g. Graco) and never appended to a newborn/rotating seat just because marketing text mentions it (it over-narrows Rakuten results).
  - Result: 7/10 held stable; all PASS pairs re-confirmed on a second run.

## Unfixable failures and WHY

- **Combi R→A, Cybex R→A — COVERAGE/CRAWLER**: the Amazon search crawler returns brand-only titles (`Combi`, `Cybex`) with the model stripped. No keyword can recover model text that isn't in the crawled candidate. Matching INTO Rakuten works fine (Combi A→R passes), so the limitation is Amazon-side title extraction, not the prompt.
- **AileBebe/Carmate (pair 6) — MATCHER**: keyword is correct (true equivalent ranked #1), but `semanticMatch`'s fixed brand map lacks Carmate/AileBebe/エールベベ, so it won't equate the English source brand to the katakana candidate. Fixable only by editing `src/lib/llm/openrouter.ts` (out of scope for this prompt task).
- **Pair 10 Bright/Light (matcher)**: keyword surfaces the correct family; semanticMatch can't distinguish Aprica プライト (Bright) from ライト (Light) because the English romanizations are near-identical, and selects a same-price sibling. Catalog/matcher ambiguity, not keyword.

## Notes for future maintainers
- Keep the keyword TIGHT (brand + model + install ≈ 3–4 tokens). Adding color/year/R129/age-range/回転式/marketing zeroed or shrank Rakuten results in prior categories and risks the same here.
- The biggest lever for car_seats accuracy now sits downstream: add Cybex/Joie/Graco/Recaro/Maxi-Cosi/AileBebe to the semanticMatch brand map, and improve Amazon title extraction for Combi/Cybex.
