# Bouncer category tuning log

Category: バウンサー / ハイローラック / ハイローチェア / 電動・オートスウィング / ゆりかご
Brands: ベビービョルン (BabyBjorn), コンビ (Combi), アップリカ (Aprica), カトージ (Katoji), ストッケ (Stokke), インジェニュイティ (Ingenuity/Kids2), リッチェル (Richell), 西松屋.
Type matters: manual バウンサー ≠ ハイローチェア ≠ 電動/オートスウィング ≠ ゆりかご. Keep type verbatim.

## Discovery (Rakuten, free)
- BabyBjorn: ブリス / ブリス エアー / バランスソフト / バランスソフト エアー (Air = mesh, distinct SKU)
- Combi: ネムリラ AUTO SWING BEDi Long / ネムリラ Auto DR (electric); ホワイトレーベル grade
- Aprica: ユラリズム スマート プレミアム (manual), ユラリズム オート (electric) — both ハイローチェア
- Katoji: スイングハイローラック ピッコロ (lots of クッション accessory noise)
- Stokke: ステップス バウンサー
- Ingenuity/Kids2: キープコージー 3-in-1, コージースポット スージング, ロッキング バウンサー (some 電動/バイブレーション)
- Richell: バウンシングシート N (バウンサー)

## Prompt design
Copied durables template (strollers/car_seats). Key rules:
- Brand + Model/line + Type, max 5 words, JP only.
- Preserve TYPE token (バウンサー vs ハイローチェア vs オートスウィング/電動 vs ゆりかご) — different products.
- Preserve エアー/Air (BabyBjorn mesh variant) and Combi grade words (BEDi/Auto DR/オートスウィング).
- Drop: colors, fabric-alone, age/weight, order codes, marketing (送料無料/正規品/保証/出産祝い/ギフト/リクライニング/洗える), accessory words unless product IS the accessory.

## Probe results

### 1. BabyBjorn Bliss Cotton/Woven (Rakuten -> Amazon) PRICE 24200
keyword: `ベビービョルン ブリス バウンサー`
Ranked correct バウンサーBliss ウーブン (true Woven equivalent) in top results. KEYWORD-SIDE PASS.
SEMANTIC MATCH: NO MATCH (re-run twice, stable). -> MATCHER-SIDE miss: judge rejects a correct keyword-side Bliss Woven match (fabric-variant strictness / BabyBjorn Bliss-line brand-map gap). Keyword correct, judge rejects. MOVE ON.

### 2. Combi Nemurila Auto DR (Rakuten -> Amazon) PRICE 46799
keyword: `コンビ ネムリラ Auto DR オートスウィング`
SEMANTIC MATCH found Combi ネムリラ Auto DR グレー (exact). KEYWORD PASS + END-TO-END PASS.

### 3. Aprica YuraLism Auto Light electric (Rakuten -> Amazon) PRICE 42000
keyword: `アップリカ ユラリズム オート 電動`
SEMANTIC MATCH found Aprica ハイローチェア ユラリズム オート ライト メランジグレー (exact model+grade+color). KEYWORD PASS + END-TO-END PASS.

### 4. Stokke Steps Bouncer (Rakuten -> Amazon) PRICE 26400
keyword: `ストッケ ステップス バウンサー`
First run: ranker returned only an unrelated TrippTrapp accessory -> NO MATCH (crawl flakiness; Amazon DOES list the Steps bouncer at ¥26400, confirmed by direct dump-search). RE-RUN: SEMANTIC MATCH found ステップス バウンサー ヘリンボーングレー (exact). KEYWORD PASS + END-TO-END PASS (flaky crawl, not keyword).

### 5. Richell Bouncing Seat N (Rakuten -> Amazon) PRICE 7700
keyword: `リッチェル バウンシングシート N バウンサー`
SEMANTIC MATCH found リッチェル バウンシングシートN (exact). KEYWORD PASS + END-TO-END PASS.

### 6. Katoji Swing Hi-Low Rack Piccolo (Rakuten -> Amazon) PRICE 16800
keyword: `カトージ スイングハイローラック ピッコロ`
SEMANTIC MATCH found カトージ スイングハイローラック ピッコロ ドットグレー (exact). KEYWORD PASS + END-TO-END PASS.

### 7. Ingenuity Rocking Bouncer Lamb 12118 (Rakuten -> Amazon) PRICE 11880
keyword: `インジェニュイティ ロッキング バウンサー 電動`
Keyword correctly dropped the design-theme word ラム (color/theme variant) and kept brand+type. But Amazon's Ingenuity/Kids2 catalog is thin and uses different model naming; the specific Lamb rocking bouncer does not surface. SEMANTIC MATCH: NO MATCH. -> COVERAGE / MATCHER-SIDE limited (sparse Amazon Ingenuity listings + Kids2 model-name divergence). Keyword reasonable; MOVE ON.

### 8. Combi Nemurila AUTO SWING BEDi Long (Rakuten -> Amazon) PRICE 66000
keyword: `コンビ ネムリラ オートスウィング BEDi ロング`
SEMANTIC MATCH found ホワイトレーベル ネムリラ AUTO SWING BEDi Long EG+ ミルキーベージュ (exact). KEYWORD PASS + END-TO-END PASS. Confirms keeping オートスウィング + BEDi + ロング works.

### Reverse-direction confirmations (Amazon -> Rakuten)
- BabyBjorn Bliss Air (Amazon ¥29700) -> keyword surfaced all Bliss Air variants; SEMANTIC MATCH found Bliss エアー メッシュ. END-TO-END PASS. (Note: reverse Bliss Air matches even though forward Bliss Cotton did not — judge handles Air variant but is strict on Cotton/Woven line.)
- BabyBjorn Balance Soft (Rakuten ¥23760) -> keyword `ベビービョルン バランスソフト バウンサー` surfaced Balance Soft (Jersey) and Balance Soft Air; SEMANTIC MATCH picked a Balance Soft Air variant (same model line, Air-vs-non-Air fabric slip). KEYWORD PASS; end-to-end matched but imperfect SKU.

## Summary
- KEYWORD-SIDE PASS: 8/8 distinct probes (keyword always surfaced the true equivalent in candidates; Stokke first-run miss was crawl flakiness, confirmed correct on re-run).
- END-TO-END PASS: 6/8 (Combi Auto DR, Aprica YuraLism Auto, Stokke Steps, Richell Bouncing Seat N, Katoji Piccolo, Combi BEDi Long) + 1 reverse (BabyBjorn Bliss Air).
- MATCHER-SIDE CEILING: 2 — (1) BabyBjorn Bliss Cotton/Woven forward (judge NO MATCH on correct Woven candidate; Bliss-line/fabric brand-map gap), (2) Ingenuity/Kids2 (sparse Amazon coverage + model-name divergence). BabyBjorn Balance Soft also shows Air-vs-non-Air fabric slip (matched but imperfect).

## Lessons
- Preserve TYPE strictly: バウンサー / ハイローチェア / オートスウィング・電動 / ゆりかご are different products. Combi electric models need オートスウィング kept.
- Keep Combi grade codes verbatim (BEDi, ロング, Auto DR) — they distinguish models and rank well.
- Keep エアー/Air for BabyBjorn (mesh = distinct SKU), but the judge is over-strict on Bliss Cotton/Woven and over-loose on Balance Soft Air — matcher-side, not fixable from keyword prompt.
- Drop design-theme words (ラム/くま/ひつじ) like colors — they over-narrow and aren't SKU-decisive.
- Tight keyword (brand + model + type, 3-4 tokens) keeps Rakuten result sets healthy; over-specification (color/fabric/age/marketing) zeros them.
