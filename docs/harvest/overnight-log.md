# Overnight genre-by-genre harvest + tuning log

Started 2026-06-13 night, autonomous (user asleep, full discretion granted).
Branch: `harvest/overnight-genre-tuning` (NOT merged to master — review in the morning).

## Goal
Harvest remaining enumerated products **one genre at a time**; after each genre,
self-evaluate match precision on a sample; if a genre's precision is below ~95%,
tune that genre's prompt (refineKeyword .txt + baked, byte-identical, and/or the
`semanticMatch` JUDGE rules) and re-run; then move to the next genre. Maximize
precision. No rush.

## Scope decisions
- Only the 10 genres that have a category prompt are processed: diapers, wipes,
  formula, bottles, baby_food, carriers, strollers, car_seats, skincare, bath.
- **~4.8k "unknown" products are skipped** (toys, furniture, clothing, oral-care,
  bibs, plus some pollution like a men's polo shirt). They have no category prompt
  and are low value for a consumables price-comparator. Listed for later review.
- Order (consumables first — higher value + case-pack normalization applies):
  bath → wipes → skincare → bottles → formula → baby_food → (durables if time:
  car_seats → carriers → strollers). diapers nearly done already (24 left).
- Per-genre loop: run a ~100-cap eval batch → eyeball precision → tune if <~95%
  (max 2 rounds) → run the remainder → next genre.
- Safety: prompt changes committed on this branch only; no auto-merge to master;
  no data deletion except clear pollution; current anti-CAPTCHA sleep kept.

## Tooling added (this branch)
- `src/lib/jan/classify-local.ts` — free regex genre classifier (bucketing only).
- `scripts/harvest/02-match-amazon.ts --category=<id>` — process one genre.
- `scripts/harvest/sample-genre.ts --category=<id>` — dump matched pairs + rate.
- `scripts/harvest/reset-genre.ts --category=<id> [--apply] [--include-matched]`
  — reset a genre to 'enumerated' for re-run after tuning.

## Remaining enumerated by genre (start of night)
unknown 4826 (skipped), baby_food 620, bottles 609, formula 576, strollers 505,
skincare 480, carriers 467, car_seats 230, wipes 190, bath 28, diapers 24.

## Progress

(entries appended per genre below)

### bath — DONE, no tuning needed
- Ran 25/25 (all bath enumerated). matched=6, rate ~24%.
- Precision sample 4/4 = 100% (bath ball exact, キューピー全身ベビーソープ, スキナベーブ沐浴剤, リッチェルふかふかベビーバス; case-pack ×2 normalized). 0 CAPTCHA.
- Low recall is inherent (heterogeneous: bath toys/salts/tubs/soaps) and precision-safe (uncertain→no_match). Meets ≥95% precision gate → no prompt change.

### wipes — tuned (1 light JUDGE rule), then finishing remainder
- First batch 120: matched=56 (cumulative wipes matched=88, rate ~36%), 0 CAPTCHA.
- Precision sample 21/22 ≈ 95% — case-pack normalization excellent across レック/ムーニー/グーン/dacco/パンパース (×3/×8/×12/×24 → unit). One real sub-line mismatch: pid=1235 ムーニー「こすらずするりんっ厚手」↔「やわらか厚手」 (distinct Moony wipe lines). One borderline-acceptable: pid=1193 ちいかわ↔サンリオ print of the same LEC 80×3 wipe (character design is cosmetic/LOW).
- Tune: added a wipe sub-line rule to the JUDGE (Moony やわらか素材 ≠ 水分たっぷり厚手 ≠ こすらずするりんっ). Forward-looking (helps remaining + future wipes); did NOT reset the 120 done since 95% already meets the gate. Running the remaining enumerated wipes with it.

### wipes — COMPLETE
- All enumerated wipes processed: matched=96 no_match=184 (rate ~34%), 0 CAPTCHA. Tuned-prompt remainder (44) ran clean.

### skincare — tuned (SPF rule), running remainder
- Eval batch 120: matched=60 (cumulative 61), rate ~41%, 0 CAPTCHA.
- Precision 19/20 = 95%. One SPF mismatch: pid=8490 アトピタ 保湿UVクリーム50 (SPF50) ↔ AZ SPF29++ (アトピタ ships SPF29 & SPF50). Otherwise clean (ニベア/ピジョン/和光堂/ジョンソン/ミノン/ミキハウス; case-pack ×3/×5/×12 normalized).
- Tune: added SPF rule to JUDGE (SPF50≠35≠29≠21; "クリーム50"=SPF50). Forward-looking for the ~360 remaining; 60 done not reset (95% meets gate).

### skincare — COMPLETE (SPF tune validated)
- Remainder 258 done: matched=166, 0 CAPTCHA. Post-tune precision sample 14/14 = 100% — SPF rule confirmed working (アトピタ"50"→SPF50 ✓, SPF29→SPF29 ✓; パックスベビー SPF17/SPF30 correctly kept distinct).
- Note: distinct active Amazon listings (~90) < amazon_done products because many Rakuten shops sell the same popular SKU → same ASIN collapses under UNIQUE(platform,platform_id). Expected for consumables.

### bottles — VALIDATED (no tune); remainder deferred
- Eval batch 120: matched=55, rate ~46%, 0 CAPTCHA. Precision 20/20 ≈ 100% — nipple sizes S/M/L/SS each matched correctly, ガラス≠プラスチック kept, case-pack ×3/×5/×6 normalized, model codes (BHOP2-A/FDNK10709041) matched. Color/character design treated as cosmetic (correct).
- Strategy: prompt validated → defer the ~490-product remainder (volume, can bulk-run later) and prioritize validating the not-yet-checked genres (formula, baby_food, durables) tonight. Maximizes number of validated prompts by morning.

### formula — VALIDATED (no tune)
- Eval batch 120: matched=89, rate ~57% (highest yet — formula is well-branded/consistent), 0 CAPTCHA. Precision 20/20 = 100%.
- Per-unit can size (小缶300g≠大缶800g) respected; forms (缶/スティック/らくらくキューブ/らくらくミルク liquid/エコらくパック) distinguished; ステップ≠ほほえみ line correct; case-pack ×3/×5/×6/×20 normalized; 旧品 packaging treated as same product. Existing formula prompt + JUDGE rules sufficient. Remainder (~450) deferred for volume.

### baby_food — tuned (flavor rule), 86% → 100%
- First batch precision 12/14 = 86%: cross-flavor error (グーグーキッチン 鮭とじゃがいも↔牛肉すき焼き) + a no-brand mug→コンビ ラクマグ (also a classify miss).
- Tune: added baby-food dish/flavor rule to JUDGE (same line + different flavor = mismatch). Reset 70 baby_food, re-ran with flavor rule + searchHtml retry.
- Re-run precision 16/16 = 100% — every グーグーキッチン/栄養マルシェ/食育レシピ now matches the SAME dish (肉じゃが↔肉じゃが, かぼちゃグラタン↔かぼちゃのグラタン, 鮭のクリームシチュー↔同). rate ~53%, 0 CAPTCHA.

### car_seats — VALIDATED (no tune); durable, low recall
- Eval batch 120: matched=21, rate 18% (durable: single-unit, brand-map dependent), 0 CAPTCHA. Precision ~15/16 ≈ 94%.
- Brand coverage strong (qwen-235b knows them): MAXI-COSI/Combi/Aprica/エールベベ/GRACO/Joie/Britax/Cybex/Nebio/OSJ all matched correctly on model name + R129. The feared brand-equivalence-map bottleneck did not materialize.
- 1 borderline: pid=6382 RK has only model codes (no brand text) → Aprica クルリラ (no-brand rule muddied by SKU numbers). Not systematic → no tune. Low recall is inherent to durables.

### carriers — durable, recall 7% (heavy pollution); strollers pending
- matched=9 no_match=111, rate 7%, 0 CAPTCHA. Precision ~7/8: real branded carriers matched (キャリフリー/Buddy Buddy POLBAN/minimonkey/べべポケット). 1 pollution: TRUSCO industrial wire-rope sling leaked in via スリング token. よだれカバー drool-covers (accessory) also present.
- Low recall = durable + accessory/pollution in bucket, not a matcher fault. Note: classifyLocal carriers regex (スリング) needs an industrial-tool guard.

### A — accessory exclusion (recall denominator cleanup)
- Added ~30 accessory tokens to EXCLUDE_KEYWORDS (哺乳瓶スタンド/ラック/ホルダー/乾燥/ケース/ボックス/ポーチ/カバー/収納, 授乳クッション/枕, 母乳実感パーツ, おしりふきケース/フタ/ビタット, よだれカバー/パッド, ワイヤーロープ). Compounds avoid case-pack (ケース品) collision; baby スリング kept (only ワイヤーロープ industrial blocked).
- Deleted 130 no_match accessory products (clean-polluted-nomatch). 02-match-amazon now also skips EXCLUDE matches in the enumerated pool (no re-pollution).
- Recall measured accurately now: bottles 50%→81%, wipes 49%→59%. formula/skincare/baby_food already clean (73/63/52%). bath/car_seats/carriers low = genuinely hard (durable/heterogeneous), not pollution.

### strollers — VALIDATED (no tune); durable, recall 7%
- matched=8 no_match=112, rate 7%, 0 CAPTCHA. Precision ~8/8: real strollers matched (カトージ 二人でゴー/リッチェル コアラクーン/マキシコシ レオナ2; Aprica/MAXI-COSI/Richell/Katoji brand coverage good). Many matches are accessories (保冷シート/クリップ/フック/アタッチメント) — correct but low value.
- Low recall inherent to durables. ALL 10 GENRES now evaluated.

## Step 3: bulk-volume the validated consumable genres (formula/skincare/bottles/wipes/baby_food) with the now-validated prompts + clean accessory filter.

## 2026-06-14 — products.category now stores the ACCURATE fine genre (was uniform 'baby')
- **Problem found:** `products.category` was `'baby'` for all 8468 rows (the enumeration scope), never the fine genre. The 10-genre classification was only a runtime `classifyLocal(title)` recompute, never persisted. Biggest bucket by far was **unknown = 4686** (> all 10 genres combined).
- **unknown breakdown:** ~445 were real diapers the regex missed (brand titles `パンパース/ムーニー/メリーズ/グーン/マミーポコ + パンツ/テープ + 枚` lack the word おむつ); ~25 pollution (hardware/funeral/adult-incontinence); ~4216 genuine out-of-scope long-tail (toys/chairs/bibs/食器/dental/bouncers — correctly unharvestable).
- **Key insight (user-led):** enumeration walks 18 Rakuten parent genre IDs but discarded the per-item `genreId` — a structured signal more reliable than title regex. Items carry **leaf** genreIds (child of parent), discovered via `discover-genre-leaves.ts`.
- **Built 3-tier `resolveCategory(title, genreId)`:** tier-0 pollution (`isTrialOrSamplePack`) → tier-1 title regex (`classifyLocal`, now with diaper brands) → tier-2 Rakuten leaf-genreId map (`rakuten-genre.ts`) → unknown. Regex beats genreId (keyword precision); tier-0 first so mis-shelved pollution can't be rescued.
- **Schema:** `listings.genre_id` + `products(category)` index; enumeration stores genreId + accurate category from the start. EXCLUDE_KEYWORDS += funeral/adult/hardware tokens (they carry baby leaf genreIds).
- **Backfill:** `backfill-category.ts` killed 'baby' instantly (regex). Post-backfill: unknown 4648, baby_food 585, bottles 511, formula 498, strollers 497, carriers 428, diapers 415, skincare 384, wipes 252, car_seats 225, bath 25. (bottles/carriers dropped vs raw regex because tier-0 correctly moved accessories to unknown.)
- **In progress:** `requery-genre.ts` (bg) re-queries Rakuten genreId by itemCode for the 4648 unknowns → tier-2 rescues keyword-less consumables (esp. diapers via 205198). Then `llm-category-pass.ts` (Hybrid final tier) classifies whatever stays unknown. Commit de7619f.

### LLM tier-3 REVERTED — genreId is the precision anchor
- Ran llm-category-pass.ts on the 2630 post-genreId unknowns: rescued 580. Spot-check (sampled the rescued rows) showed systematic **force-fitting**: bath chairs + bath toys → bath, high-chair belts → carriers, feeding accessories (お食事クッション/チェア/プレート) → baby_food, dental gels (歯みがき) → skincare.
- Validated against the stored Rakuten genre_id (re-query already fetched it for every unknown): all 580 LLM rescues carry OUT-OF-SCOPE genre_ids — 食器 168, スタイ 119, 歯 88, ベビーチェア 61, バウンサー 41, おもちゃ 31. Rakuten's own taxonomy contradicts the LLM.
- **Decision (user: "dùng Rakuten genre để kiểm tra"):** reverted the LLM pass by re-running backfill-category.ts (tiers 0-2 only). products.category is now regex + Rakuten-genreId only — the structured signal, never the loose free-text LLM. Removed llm-category-pass.ts.
- Final distribution: unknown 2874, bottles 919, baby_food 875, skincare 800, formula 614, strollers 605, carriers 488, car_seats 448, diapers 429, wipes 391, bath 25. The 2874 unknown are genuinely out-of-scope (their genre_ids are bouncer/chair/bib/dental/toys/tableware).
- Note: bath (25) is under-covered — it is NOT one of the 18 enumerated Rakuten genres, so genreId can't help and regex catches few. Add a bath genre to enumeration later if bath coverage matters.

## 2026-06-14 (cont.) — scope expansion: +11 categories, total 10 → 21 genres
- **Phase 1 (re-bucket, no crawl):** +7 categories from already-stored genre_id — toothbrush, toothpaste, bibs, tableware, baby_chair, bouncer, toys. unknown 2874→328. dental split brush↔paste by TITLE regex (genre leaves mix both); tableware ordered before baby_food (離乳食食器); toys uses おもちゃ(?!付).
- **Phase 2 (bath crawl):** bath had a category but no enumerated Rakuten genre (only 25 via regex). Added 505410 (ベビーソープ) + 505413 (ベビーシャンプー) to enumeration; bath 25→698.
- **Phase 3 (niche crawl):** added 鼻吸い器 207739, ベビー体温計 567569, ベビーゲート 200841, プレイマット 568495 to enumeration + new categories nasal_aspirator/thermometer/safety_gate/playmat. Total products 8468→10975.
- **Precision decision (user: A):** the 4 niche genres are NOISY (probe covers in thermometer, a blender + cereal mis-tagged into playmat, a car door-guard in safety_gate). So they are TITLE-REGEX-ONLY — NOT mapped in rakuten-genre tier-2 — trading coverage for precision. Removed the worst mis-tags (playmat 504→127, safety_gate 480→363). Bath stays genreId-mapped (clean genre). Residual niche noise = accessories whose titles contain the device name (replacement tubes / probe covers) — inherent, low-value, left as-is.
- New genres share NEW_GENRE_PROMPT pending per-genre tune-category. 01-enumerate got a --genres= filter to crawl specific genres without re-walking the tree. Final unknown=1154 (mostly accessories/mis-tags correctly NOT force-fit).
