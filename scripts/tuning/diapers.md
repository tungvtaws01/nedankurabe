# diapers prompt tuning

## 2026-06-13 — preserve swim-pants line + gender + named products

**Problem found** (via harvest no_match investigation + browser keyword experiments):
refineKeyword over-stripped distinguishing tokens for several diaper products, reducing
them to a too-generic `brand + パンツ + size`:
- `ムーニー水あそびパンツ ... 女の子` → `ムーニー パンツ ビッグサイズ` (lost 水あそび line + 女の子 gender)
- `ムーニーマン ゆるうんちモレ安心 M` → `ムーニーマン パンツ Mサイズ` (lost line)

The generic keyword surfaces regular diapers, the matcher correctly rejects them → no_match.
Root cause: the diapers prompt's product-line list lacked swim/night/training products and
had no gender-preservation rule, and gender risked being treated like a color.

**Change:** added to scripts/prompts/diapers.txt (and baked DIAPERS_PROMPT):
- swim/water-play pants (水あそびパンツ) as a DISTINCT line, never reduced to plain パンツ
- named distinct products kept verbatim: オヤスミマン (night), トレパンマン (training), ゆるうんちモレ安心
- a catch-all: keep any clearly-named line verbatim, do not generalize to パンツ
- rule 5: KEEP 男の子用 / 女の子用 (gender-specific SKUs; not a color/character)
- clarified colors to remove include 青/ピンク/ブルー; raised word cap 6→7

**Probe (PROBE_FROM=rakuten, ムーニー水あそびパンツ女の子):**
- KEYWORD now: `ムーニー 水あそびパンツ パンツ ビッグサイズ 女の子用` (line + gender preserved ✓)
- Candidate rank 0 = ムーニー水あそびパンツ ブルー ビッグ (swim pants now surfaced ✓)
- SEMANTIC MATCH = NO MATCH — correct: the surfaced candidate is ブルー (=男の子用) vs the
  女の子 source; the tightened matcher holds the gender line. The 女の子 variant wasn't in
  Amazon's top results for this keyword, so this remains a (correct) no_match.

Net: keyword-side defect fixed (line + gender preserved); residual no_match here is the
gender-strict policy working as designed, not a keyword failure.
