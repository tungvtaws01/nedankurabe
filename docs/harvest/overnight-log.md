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
