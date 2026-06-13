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
