# Full matched-pair verification — 2026-06-17

Exhaustive **600px image** + description vision audit of **every active Amazon↔Rakuten matched
pair** (the user-facing churn-risk bucket). Goal: a trustworthy gold set + the false-positives to
remove + the signal to tune `refineKeyword` / `semanticMatch`. No DB was mutated.

## Method
- **Crawl** (`crawl-pairs.ts`): Rakuten via the free Ichiba API (full referrer headers — the
  bare-Referer `lookupRakuten` 403s), Amazon detail via scrape.do with 4-token rotation. Both images downloaded.
  1,622 pairs → 1,582 both images, 0 with no image, 22 Rakuten delisted.
- **Judge** (`verify-workflow.js`): Sonnet vision agents (5 pairs each) open BOTH product images +
  titles+descriptions. Verdict = **product identity only** (brand/line/type/size/SPF/stage/flavor/scent);
  pack quantity captured separately in `qtyDiffers` (app normalizes price via `pack_count`).
- **Two-resolution process.** First pass at 300px over-flagged fine print (flavor/line/character).
  Re-fetched every judged pair at **600px** from the public CDNs (free, no scrape.do) and re-judged.
  Final gold set = 600px verdicts (1,594/1,600 re-verified; 6 original UNSURE left as-is).

## Final results (1,622 pairs, 600px)
| verdict | n | |
|---|---|---|
| KEEP | 1,434 | correct match |
| **REMOVE** | **158** | **confirmed false-positive (9.9% of judged)** |
| UNSURE | 8 | unverifiable (often a native-low-res Rakuten photo) |
| NEEDS_REFRESH | 22 | Rakuten item delisted (stale listing) |

**584 KEEP pairs have `qtyDiffers=true`** — same product, different pack quantity; price correctness
depends on `pack_count` normalization working.

### What the 600px re-check changed vs 300px
- **REMOVE bucket (175):** 50 flipped to KEEP/UNSURE (low-res false-removes — brand/line actually
  matched at full res), 125 confirmed.
- **KEEP bucket (1,419):** **33 flipped to REMOVE + 1 to UNSURE — these are false-KEEPs, the real
  churn risk** (genuine mismatches shown to users as matches), 1,385 confirmed.
- Net: 158 genuine false-positives (125 + 33). Lesson: should have crawled at 600px from the start.

### REMOVE by mismatch type (the tuning signal)
BRAND 36, LINE 34, TYPE 32, BUNDLE_CONTENTS 19, OTHER 12, SIZE 11, FLAVOR_SCENT 10, SPF_STAGE 3, WIDTH 1.

### Worst categories (REMOVE / judged)
baby_chair 3/5 (60%, tiny n), bibs 32.6%, carriers 28.6%, safety_gate 27.0%, toothpaste 11.6%,
wipes 11.5%, toothbrush 10.3%, baby_food 9.7%. Best: formula 2.8%, car_seats 5.6%, skincare 6.3%.

## Key insight
`semanticMatch` only sees **titles + a 120-char description** — never images. Most false-positives
(both the 125 and especially the 33 false-KEEPs) are only visible in the package image (different
line generation, print, form, or small logo not in the title). Two levers: (a) tighten the text
matcher per the mismatch table; (b) bigger win — give the matcher image access for the final
tie-break.

## Artifacts (`docs/harvest/verify/`)
- `verdicts-all.tsv` — full 1,622-row labeled table (600px verdicts)
- `proposed-removals.csv` — the 158 REMOVE rows + amazon_url + rakuten_url + evidence
- `goldset.jsonl` — 1,600 labeled pairs (1,434 KEEP / 158 REMOVE) = regression fixture for tuning
- `verdicts/{raw-verdicts,hires-remove,hires-keep,raw-verdicts-reconciled}.json` — provenance
- `img/` (300px) + `img-hi/` (600px) — product images for spot-checking

## Pending user decisions (DB untouched)
1. **Soft-remove the 158** (reversible: `is_active=false` + `stage='no_match'`, as with the prior 42).
2. **Refresh the 22 delisted** Rakuten listings vs deactivate.
3. **Tune** `refineKeyword`/`semanticMatch` against `goldset.jsonl` (mismatch-type table above).
4. **no_match recall pass** (4,004) — separate heavier pipeline (fresh Amazon *search* per item);
   ~1,425 scrape.do requests remain (covers ~1/3).
