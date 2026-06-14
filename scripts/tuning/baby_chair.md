# baby_chair (ベビーチェア — high/low/table chairs & boosters) — keyword prompt tuning log

Category: baby/kids chairs for Amazon JP ↔ Rakuten cross-platform matching.
Prompt file: `scripts/prompts/baby_chair.txt`
Pipeline: `refineKeyword(title, targetPlatform)` → crawl target → `rankBySimilarity` → `semanticMatch`.

Decisive dimensions: **brand + exact model/line + chair type** (ハイチェア vs ローチェア vs テーブルチェア vs ブースター vs ベビーソファ). Type is decisive — these are physically different products.

## Final result
- **Keyword-side PASS: 9/10** (keyword surfaces the true cross-platform equivalent at rank #0; pair 10 surfaces it at #1 behind a generic-noise item → counted as near, not clean).
- **End-to-end PASS (semanticMatch returns the true equivalent): 7/10.**
- **Matcher-side ceiling: 3 pairs** lost downstream despite a correct #1 keyword — Ingenuity, 大和屋 すくすくローチェア3, ベビービョルン. All three brands are absent from `semanticMatch`'s brand-equivalence map (`src/lib/llm/openrouter.ts` ~line 100, which lists only Pigeon/Combi/Aprica/Ergobaby + food/wipes makers). DURABLE chairs are inherently matcher-limited, as flagged in the task guardrails.

PASS = SEMANTIC MATCH returned the true equivalent SKU (or the same SKU at a lower price — the matcher is told to pick the cheapest valid match).

## Discovery findings (drove the prompt design)

- **Amazon JP returns full Japanese titles for chair BODIES** for 大和屋, カトージ, バンボ, リッチェル, インジェニュイティ — brand + model + type all present, so A→R matching is reliable.
- **STOKKE Tripp Trapp is the exception on Amazon search**: the Amazon results for ストッケ/トリップトラップ are dominated by ACCESSORIES (cushions, trays, wheels, harnesses) — the chair body barely surfaces. So matching INTO Amazon (R→A) for Stokke relies on the keyword being tight enough to rank the body over accessories. Matching INTO Rakuten (where the body is abundant) is far more reliable.
- **Accessory pollution is the #1 keyword risk for chairs.** Tripp Trapp / すくすく / Baby Base listings are surrounded by クッション・テーブル・ガード・トレイ・ハーネス sold separately. The prompt explicitly drops these accessory words unless the product IS the accessory.
- **"ブースター" collides with car booster seats.** ベビービョルン ブースターシート (a meal booster) shares the token ブースター with R129 ジュニアシート / カーブースター (a car-seat category). Searching ベビービョルン ブースターシート into Amazon pulled in car boosters and a cheap generic 2WAY booster that out-ranked the true Bjorn item. With no model line for Bjorn, brand+type is all the keyword has — pollution is inherent.
- **semanticMatch brand map omits 大和屋/STOKKE/カトージ/バンボ/リッチェル/インジェニュイティ/ベビービョルン.** Where it still passes (大和屋, ストッケ, カトージ, バンボ, リッチェル) it is because the brand TOKEN is byte-identical on both Amazon and Rakuten sides, so the judge equates them without needing the map. Where the token differs subtly or the model has a generation grade (Baby Base vs Baby Base 3.0; ローチェア "3"), the judge goes conservative → NO MATCH.

## Source → ground-truth pairs tested

1. A→R  大和屋 すくすくチェアGL 5501NA (ハイチェア木製) → すくすくチェアGL ¥18900 — **PASS** (kw `大和屋 すくすくチェアGL ハイチェア`; matcher picked cheaper exact SKU).
2. R→A  ストッケ トリップトラップ 本体 → Stokke Tripp Trapp 本体 ¥37353 — **PASS** (kw `ストッケ トリップトラップ ハイチェア 木製`; ranked bodies over accessories, matched cheaper body).
3. A→R  カトージ テーブルチェア イージーフィット 58100 → ¥6219 — **PASS** (kw `カトージ テーブルチェア イージーフィット`).
4. A→R  Bumbo バンボ マルチシート → バンボ マルチシート ¥12536 — **PASS** (kw `バンボ マルチシート ローチェア`).
5. A→R  リッチェル 2WAYごきげんチェアKR (ローチェア) → ¥6104 — **PASS** (kw `リッチェル 2WAYごきげんチェア ローチェア`; KR/KN siblings correctly stayed in family).
6. A→R  インジェニュイティ Baby Base ベビーベース ミストグリーン 16728 → exact ranked #0 — **FAIL (matcher)**: keyword surfaced the exact ミストグリーン SKU at #0, but semanticMatch = NO MATCH. Ingenuity not in brand map + Baby Base vs Baby Base 3.0 generation ambiguity. Keyword-side PASS.
7. A→R  カトージ テーブルチェア NewYork·Baby → ¥5248 — **PASS** (kw `カトージ テーブルチェア ニューヨークベビー`).
8. A→R  大和屋 すくすくチェア スリム-J 8501NA (ハイチェア) → スリム-J listing ¥17116 — **PASS** (kw `大和屋 すくすくスリム ハイチェア`; matched the Slim-J-priced listing).
9. A→R  大和屋 すくすくローチェア3 (ローチェア木製) → exact ローチェア3 ranked #0 — **FAIL (matcher)**: keyword `大和屋 すくすくローチェア３ ローチェア` surfaced the exact product at #0, but semanticMatch = NO MATCH (大和屋 not in brand map; conservative on the "3" generation). Keyword-side PASS.
10. R→A ベビービョルン ブースターシート → ベビービョルン ブースターシート ¥5489 ranked #1 — **FAIL (matcher + genre pollution)**: true equivalent present at #1; #0 was a generic non-brand 2WAY booster, and the pool was polluted with R129 car boosters. semanticMatch = NO MATCH (ベビービョルン not in brand map). Counted keyword-side NEAR (not clean #0).

## Iteration progression

- **Iter 1** (baby_chair.txt drafted from car_seats.txt + universal.txt): brand EN→JP map (大和屋/ストッケ/カトージ/バンボ/リッチェル/インジェニュイティ/ベビービョルン/アップリカ/コンビ), model/line verbatim map (すくすくチェアGL / スリム-J / アッフル / トリップトラップ / ノミ / クリック / イージーフィット / ニューヨークベビー / マルチシート / ベビーベース / 2WAYごきげんチェア), chair-type-is-decisive rule, drop colors/cushions/trays/guards/age-weight/marketing/SKU codes, no-count rule, max 5 words.
  - Result: keyword surfaced the true equivalent at #0 for 9/10 (pair 10 at #1). End-to-end 7/10. The 3 end-to-end misses are all matcher-side (brand-map gaps) — confirmed the keyword ranks the correct item, so no keyword change recovers them.
- **Stability re-runs**: pair 1 (yamatoya GL) and pair 3 (Katoji EasyFit) re-run a second time — both held PASS with the same matched SKUs. No flakiness observed.

No iter-2 keyword change was warranted: every end-to-end miss is downstream of a correct keyword. Spending iterations on the prompt would not move them.

## Unfixable failures and WHY

- **Pairs 6, 9, 10 — MATCHER (brand-map gaps)**: Ingenuity, 大和屋, ベビービョルン are not in `semanticMatch`'s brand-equivalence map. When the brand token isn't byte-identical or a model has a generation grade, the judge returns NO MATCH despite the keyword ranking the true equivalent #1. Fixable only by editing `src/lib/llm/openrouter.ts` (out of scope).
- **Pair 10 also suffers genre pollution**: "ブースター" pulls in R129 car booster seats and generic boosters. ベビービョルン has no model line, so brand+type is the tightest possible keyword; the pollution cannot be removed keyword-side.
- **Stokke R→A is body-vs-accessory dependent**: it passed here (keyword ranks the body over cushions/trays), but Amazon search for Tripp Trapp is accessory-heavy, so this direction is more fragile than A→R.

## Notes for future maintainers
- Keep the keyword TIGHT (brand + model + type ≈ 3 tokens). Adding colors / cushions / trays / age-weight / 正規品・送料無料・出産祝い / SKU codes (5501NA, 58100, 16728) shrinks or zeros Rakuten results.
- Chair TYPE is load-bearing — never let the model swap ハイチェア↔ローチェア↔テーブルチェア↔ブースター. The same brand sells all of them (大和屋 すくすくチェア = high, すくすくローチェア = low; リッチェル 2WAY = low/booster).
- The biggest lever for baby_chair accuracy is downstream: add 大和屋/yamatoya, STOKKE, カトージ/KATOJI, Bumbo/バンボ, リッチェル, Ingenuity, ベビービョルン to the semanticMatch brand map, and teach it that Baby Base ≈ Baby Base 3.0 and すくすくローチェア「3」 generations are the same line.
