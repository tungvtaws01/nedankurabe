# toys — tuning log

Category: ベビー向けおもちゃ (rattles/ラトル, mobiles/メリー, play gyms/プレイジム, teethers/歯固め,
知育 educational, busy-boxes, ride-ons, stacking toys). Model: qwen/qwen3-235b-a22b-2507.

Decisive match dimensions: **brand** + **exact product/line name (verbatim)** + type.
Toys are the most heterogeneous baby category — every toy is a unique SKU. Many Rakuten SKUs
have NO clean Amazon equivalent (store-exclusive bundles, discontinued lines). Expect low e2e.

## Discovery (crawler, ground truth)
Rakuten searches surfaced real SKUs per brand: フィッシャープライス ミュージカルジム (HBP41),
オーボール ラトル (Kids2 11487), くもん くるくるチャイム (BK-52), ピープル やりたい放題プレミアム (HD-019),
サッシー にこにこミラーラトル, エドインター 森のあそび箱 (806487), アガツマ アンパンマン
おおきなよくばりボックス, ブライトスターツ ミニーマウス・プレイジム (12937) / エクスプロア＆ゴー (11393),
タカラトミー おやすみホームシアター ぐっすりメロディ, コンビ コップがさね.
Amazon dump confirmed Bright Starts has MANY gyms but NOT エクスプロア＆ゴー → no equivalent.

## Prompt iterations
- **v1** (copy of universal, customized): brand-map (Fisher-Price/Oball/Bright Starts/Sassy/
  Ed Inter/People/KUMON/Takara Tomy/Bandai/Combi/Mattel/Anpanman) + verbatim line name + optional type.
  Drop colors/age/月齢/counts/marketing/codes.
- **v2 BUG found**: v1's type rule made the model **invent** a type word. People やりたい放題 (a busy-board)
  got keyword `ピープル やりたい放題 プレミアム ラトル` — spurious ラトル. Oball got duplicated `ラトル ラトル`.
- **v2 FIX**: type token only if it actually appears in the title AND is not already in the line name;
  never invent (no ラトル on a box/board); never repeat a word. After fix: People → `ピープル やりたい放題 プレミアム`
  (clean, e2e PASS), Oball → no dup, e2e PASS.

## Probe results (PROBE_FROM=rakuten → searches Amazon)
| # | source | keyword | keyword-side | end-to-end | note |
|---|--------|---------|--------------|------------|------|
| 1 | Oball Rattle (Kids2) | オーボール ラトル | PASS | PASS | matched canonical オーボールラトル 11487. (1 flaky NO-MATCH on a noisy v1 keyword; stable after v2) |
| 2 | Fisher-Price ラッコ ミュージカルジム HBP41 | フィッシャープライス ミュージカルジム | PASS | PASS | exact #0 |
| 3 | KUMON くるくるチャイム BK-52 | くもん くるくるチャイム | PASS | FLAKY | Amazon top = bundles (セット買い/+かさねてコーン); 1 run matched a bundle, 1 run NO MATCH (no standalone on top). e2e borderline |
| 4 | People やりたい放題 プレミアム HD-019 | ピープル やりたい放題 プレミアム | PASS | PASS | exact #0 (both runs) |
| 5 | Sassy にこにこミラーラトル | サッシー にこにこミラーラトル | PASS (kw correct) | MISS | true product not on Amazon top; judge false-matched a different Sassy (リストラトル). Amazon Sassy catalog thin |
| 6 | Anpanman おおきなよくばりボックス | アンパンマン おおきなよくばりボックス | PASS | PASS | exact #1 (おうたいっぱい) |
| 7 | Bright Starts エクスプロア＆ゴー 11393 | ブライトスターツ エクスプロア＆ゴー... | n/a | n/a | **NO EQUIVALENT** — not on Amazon. ＆ also returned 0 results. Swapped to Minnie gym (#8) |
| 8 | Bright Starts ミニーマウス・プレイジム 12937 | ブライトスターツ ミニーマウス プレイジム | PASS | PASS | exact #0, same 12937 SKU |
| 9 | Ed Inter 森のあそび箱 806487 | エドインター 森のあそび箱 | PASS (#0 exact) | MISS | **matcher-side**: keyword puts 森のあそび箱 at #0/#2 but judge NO MATCH (price gap ¥6600 vs ¥16172) |
| 10 | Takara Tomy おやすみホームシアター ぐっすりメロディ | タカラトミー おやすみホームシアター ぐっすりメロディ | PASS (#0 exact) | MISS | **matcher-side**: exact product at #0 both runs, judge NO MATCH (price gap, conservative) |
| 11 | Combi コップがさね | コンビ コップがさね | PASS | PASS | matched COMBI コップがさね #2 |

## Tally
- Keyword-side PASS: **10/10** where an equivalent existed (surfaced true product, usually #0).
  #7 had no equivalent (excluded). The keyword reliably surfaces the right SKU.
- End-to-end PASS: **6/10** (1,2,4,6,8,11). FLAKY: KUMON (#3). MISS: Sassy (#5, thin Amazon catalog
  + judge false-positive), Ed Inter (#9), Takara Tomy (#10).
- NO cross-platform equivalent: **1** (Bright Starts エクスプロア＆ゴー 11393).
- Matcher-side ceiling: **2 confirmed** (Ed Inter / エドインター, Takara Tomy / タカラトミー) where
  keyword ranks the exact product #0 but `semanticMatch` returns NO MATCH — both have large price
  gaps that make the conservative judge reject a genuine equivalent. Plus Sassy (#5) is a
  judge false-positive on a thin catalog.

## Lessons
- Verbatim line name + brand is everything; type words are dangerous (model invents them) — gate the
  type rule hard (only if in title, not in line name, no dup).
- Full-width ＆ in a line name can zero Amazon search; but this also coincided with a genuinely
  absent SKU, so left as-is (don't strip — it's part of some line names).
- The judge is conservative on toys: large price gaps (bundle vs standalone, or different retailer
  markups) drive false NO-MATCHes even when the exact SKU is ranked #1. This is the e2e ceiling, not the keyword.
