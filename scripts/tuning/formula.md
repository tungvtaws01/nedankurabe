# Formula (粉ミルク・液体ミルク) keyword-prompt tuning log

Category: infant formula. Branch: `feat/category-aware-keyword`.
Prompt file: `scripts/prompts/formula.txt`. Probe harness: `scripts/probe-keyword.ts`.

Decisive dims for formula: **brand + line + form + stage + size**.
- Form: 粉 (can / エコらくパック) vs らくらくキューブ (cube) vs 液体ミルク (らくらくミルク) — must NOT conflate.
- Stage: ほほえみ/はぐくみ/はいはい/すこやかM1 (0ヶ月～) vs ステップ/フォローアップ (1歳～) — different products.

## Key discovery findings
- **Amazon JP titles come back English-translated** (e.g. "Meiji Hohoemi Raku-Raku Cubes", "Wakodo Lebens Milk Hai Hai", "Icreo Balance Milk"), with occasional raw Japanese. The prompt needs an English→Japanese brand/line/form map.
- **Liquid milk naming differs by platform**: Amazon = "Easy Milk" / "Liquid Milk"; Rakuten = `らくらくミルク`. Mapping Easy Milk → らくらくミルク is essential, and it must be tagged 液体 not 粉.
- Rakuten zeroes out on over-specified keywords: `和光堂 はいはい 大缶 810g` → 0 results, but `和光堂 はいはい 粉ミルク` / `和光堂 レーベンスミルク はいはい 810g` → 10. Keep keywords tight.
- Generic token `粉ミルク` in the keyword pollutes/over-broadens; better to emit brand+line+size only for plain powder cans.

## Tested source → ground-truth pairs (10; both platforms as source)
1. AMZ "Meiji Hohoemi Raku-Raku Cubes 540g (27g x 20 Bags)" → RKT `明治ほほえみ らくらくキューブ 540g (27g×20袋)`
2. AMZ "Morinaga Eco Raku Pack Refill Hagukumi 800g (400g x 2)" → RKT `森永はぐくみ エコらくパック つめかえ用 800g`
3. AMZ "Wakodo Lebens Milk Hai Hai 810g×2 Cans" → RKT `和光堂 レーベンスミルク はいはい 810g×2缶`
4. AMZ "Meiji Hohoemi Easy Milk 240ml x 24 Cans" (liquid) → RKT `明治ほほえみ らくらくミルク 240ml×24`
5. AMZ "Icreo Balance Milk 800g×2 cans" → RKT `アイクレオ バランスミルク 800g×2缶`
6. AMZ "Beanstalk Sukoyaka M1 Large Can 800g x 2" → RKT `ビーンスターク すこやかM1 大缶 800g`
7. AMZ "Meiji Step 800g×2 cans (Follow-up Milk)" → RKT `明治ステップ 800g×2缶`
8. RKT `明治ステップ らくらくキューブ(28g×60袋入)` → AMZ "Meiji Step Easy Cubes 1680g (28g x 60 Bags)"
9. RKT `森永はぐくみ 大缶 800g×2` → AMZ "Morinaga Hagukumi Large Cans 800g x 2"
10. RKT `アイクレオ バランスミルク(800g)` → AMZ "Icreo Balance Milk 800g (+bonus stick)"

PASS = SEMANTIC MATCH returns the true cross-platform equivalent (same brand+form+stage+comparable size).

## Iterations

### Iteration 1 — initial formula prompt (from universal.txt)
Built English→JP brand/line map (Meiji Hohoemi, Meiji Step, Morinaga Hagukumi, Wakodo Lebens Milk Hai Hai, Beanstalk Sukoyaka M1, Icreo Balance Milk, Snow/Megmilk Pyua), form map (Easy Cube=らくらくキューブ, Eco Raku Pack=エコらくパック つめかえ用, Easy Milk/Liquid=らくらくミルク=液体), stage rules. Output max 5 words, brand+line+form+size.

Result: **9/10 PASS.** Fails: #10 (Icreo R→A) NO MATCH.
Observed noise: keyword often included a generic `粉ミルク` token (#3,#5,#7) — still passed but redundant.

### Iteration 2 — suppress generic 粉ミルク token
Changed FORM rule: plain powder can emits NO form word (no generic `粉ミルク`); only specific form words (らくらくキューブ / らくらくミルク / エコらくパック つめかえ用). Added explicit "Never emit 粉ミルク by itself" line.

Result: keywords cleaner (`アイクレオ バランスミルク 800g`, `明治ステップ 800g`). Re-verified all pairs:
- #1-9 PASS (stable). #5 (Icreo A→R) re-confirmed PASS twice.
- #10 still flaky: candidate set is perfect (3 exact `アイクレオ バランスミルク 800g` Amazon candidates) but semanticMatch returns NO MATCH on ~2/3 runs.

### Iteration 3 — confirmation / nondeterminism characterization
Ran the flaky Icreo pairs twice each (per free-model nondeterminism guidance). #5 stable PASS; #10 = 1 PASS / 2 NO MATCH across 3 runs. Concluded #10 is a downstream `semanticMatch` limitation, not a keyword problem — see below.

## Final pass rate
**9/10 end-to-end (stable).** #10 passes intermittently (~1/3) → counted as FAIL.

| Pair | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|------|---|---|---|---|---|---|---|---|---|----|
| Iter1 | P | P | P | P | P | P | P | P | P | F |
| Final | P | P | P | P | P | P | P | P | P | F(flaky) |

## Unfixable failure + WHY
- **#10 `アイクレオ バランスミルク(800g)` (RKT→AMZ).** The keyword (`アイクレオ バランスミルク 800g`) is optimal and the crawl returns a clean candidate set of 3 exact Icreo Balance Milk 800g products. Despite this, `semanticMatch` returns NO MATCH on most runs. Root cause is in the **semantic-match LLM layer** (deciding a bare-Japanese source = English-translated Amazon candidate for the アイクレオ/Icreo brand), which `scripts/prompts/formula.txt` does not control. Fixing it would require editing `src/lib/llm/openrouter.ts` (the semanticMatch prompt) — out of scope / forbidden for this run. The mirror direction #5 (Icreo A→R, English source vs Japanese candidates) is stable PASS, confirming the keyword side is sound and the asymmetry lives in semanticMatch + the free model's nondeterminism.

## Notes on quantity (single can vs ×2 pack)
semanticMatch treats single-can vs 2-can-pack of the same brand/line/stage/can-size as equivalent (e.g. #6, #9 matched packs/singles interchangeably). This is acceptable for price comparison and not treated as a failure.
