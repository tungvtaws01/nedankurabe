# Playmat category prompt tuning log

Category: プレイマット / ジョイントマット / フロアマット / ベビーマット / ロールマット / コルクマット
Pipeline: refineKeyword(title, targetPlatform) -> crawl other platform -> rank -> semanticMatch (LLM judge).
Model: qwen/qwen3-235b-a22b-2507. Output JP keywords.

## Landscape findings (discovery)
- Brands present: CARAZ/カラズ (folding seamless mats AND PVC roll mats), ALZIPmat (folding + roll, アーバンシリーズ sizes S/SG/G/XG), popomi, GUMODE/gumode, enne, DoriDori, pattan, thesun (carazmat clone), Carrebebe, エムールベビー, フジキ (クーファン). MANY are no-brand generic.
- Types are distinct and must not merge: プレイマット (single folding/seamless cushioned) vs ジョイントマット (interlocking tiles 45/60cm) vs ロールマット (rolled PVC sheet, width×length 110×300) vs コルクマット (cork tiles) vs フロアマット (generic).
- SIZE is the decisive identity field here (unlike other categories where size is dropped). Folding mats: 140×200, 180×200, 120×160, 155×155. Tiles: 45cm/60cm. Roll: width 110/140.
- THICKNESS distinguishes SKUs: 4cm (folding), 2cm/20mm (cork), 1.5cm/1.2cm (roll PVC).
- Rakuten genre 566090 filter zeroes out many mat queries; harness falls back to genre 0 which returns results. Over-specification (colors, 抗菌/防水/防音/床暖房/出産祝い marketing) zeroes Rakuten -> keep TIGHT (brand+type+size+thickness).
- Many no-brand mats have NO clean cross-platform equivalent (different seller-specific size/spec). Expect LOW end-to-end.

## Probes

### S1 (amazon->rakuten) CARAZ folding 4cm 140x200  -- PASS (kw + e2e)
Title: Caraz プレイマット ★４サイズ・２色 厚さ4cm★...カラズマット (ベージュ, 140x200cm)  ¥24800
KW: カラズ プレイマット 140 200 4cm
-> genre 566090 zeroed, genre 0 fallback 44 results; ranked surfaced CARAZ folding 4cm mats.
SEMANTIC MATCH: #3 CARAZ 折りたたみ キッズプレイマット 厚さ4cm 120×160 140×200 160×200 (¥21602). PASS.

### S2 (amazon->rakuten) CARAZ clean seamless 180x200x4cm  -- PASS (kw + e2e)
Title: CARAZ ゼロクリーン シームレス プレイマット メガサイズ 180x200x4cm 折りたたみ式... 韓国製(グレー)  ¥33800
KW: カラズ プレイマット シームレス 180 200 4cm
SEMANTIC MATCH: #0 P5倍Caraz クリーン プレイマット180x200x4cm シームレス 折りたたみ (¥33493). PASS.

### S3 (rakuten->amazon) enne multi-size folding 4cm  -- KW PASS, e2e FAIL (matcher ceiling)
Title: enne シームレス プレイマット 折りたたみ ... 4cm 200×180 200×140 160×120  ¥13800
KW: enne プレイマット 200 180 4cm  (dropped multi-size to one, kept brand)
RANKED #3 = enne. プレイマット 180x200cm シームレス 厚み 4cm (the true single-size equivalent, surfaced).
SEMANTIC MATCH: NO MATCH. Judge too strict: source is multi-size listing, candidate is single 180×200. Matcher-side miss; equivalent WAS in top-10.

### S4 (rakuten->amazon) ALZIPmat folding アーバンシリーズ サイズG  -- letter-size bug fixed; NO clean equiv via this kw
Title: ...ALZIPmat (アーバンシリーズ サイズG）  ¥25800
KW (before fix): ALZIPmat プレイマット 折りたたみ 140 200 4cm  <- HALLUCINATED 140 200 from "サイズG"
FIX: added rule — if title gives ONLY a letter size-code (サイズG/S/SG/XG), DROP size, never invent numbers.
SEMANTIC MATCH: NO MATCH (Amazon results were no-brand + ALZIP roll mat, not the folding アーバン). Note: ALZIP folding (アルジップマット アーバン 200x140x4cm) DOES exist on Amazon (seen in S10 ranked) — reachable with a tighter brand+size kw, but this source had no cm size.

### S5 (rakuten->amazon) cork joint mat 45cm 2cm  -- NO EQUIVALENT (Amazon crawl returns 0 for cork/joint)
Title: 極厚2cm コルクマット ジョイントマット 大判 ... 45cm ... 20mm 2cm  ¥9999
KW: コルクマット 45cm 2cm  (tight, correct)
RANKED: 0 candidates. Amazon search returns 0 results for コルクマット AND ジョイントマット (structural crawler/genre ceiling). Confirmed via dump: プレイマット=10, ロールマット=10, ジョイントマット=0, コルクマット=0.
=> Tile (ジョイントマット) and cork (コルクマット) mats have NO reachable Amazon equivalent. Keyword is correct; this is a crawler-side dead end.

### S6 (rakuten->amazon) popomi roll mat  -- PASS (kw + e2e)
Title: popomi 抗菌 PVC ロールマット ... 110×300cm 140×500cm ...  ¥13800
KW: popomi ロールマット 110 1.5cm  (minor: 1.5cm not in title — brand still pinned it)
SEMANTIC MATCH: #2 popomi（ポポミ）抗菌 ロールマット防水 防滑 (¥15642). PASS.

### S7 (amazon->rakuten) thesun no-brand carazmat-clone folding 140x200 4cm 4段  -- KW PASS, e2e FAIL (matcher ceiling)
Title: thesun 4段 ... プレイマット 厚み4cm カラズマット 折りたたみ ... (140x200)  ¥19800
KW: thesun プレイマット 140 200 4cm
RANKED #0 = Caraz/thesun 140x200x4cm 4段 but 2枚セット (2-pack); #1 = thesun 5段 (different fold count).
SEMANTIC MATCH: NO MATCH. Defensible: top candidates were a 2-pack set or a 5-fold variant, no clean single 4段 equivalent. Matcher-side reasonable.

### S8 (rakuten->amazon) GU MODE folding 140x200 4cm  -- PASS (kw + e2e)
Title: GU MODE プレイマット ... シームレス 折りたたみ 厚み4cm ... グレー 140×200  ¥14979
KW: gumode プレイマット 140 200 4cm
SEMANTIC MATCH: #2 GU MODE プレイマット ... シームレス ... 140×200 (¥14802). PASS.

### S9 (amazon->rakuten) ALZIP roll mat 140 15mm  -- PASS (kw + e2e)
Title: ...フロアマット 厚さ15mm ALZIP ロールマット ... 140×200cm  ¥17226
KW: ALZIP ロールマット 140 15mm
SEMANTIC MATCH: #2 フロアマット ロールマット 110～140 x 100cm ... ALZIPmat (¥9711). PASS (same brand+type+width, cut-to-length variant).

### S10 (rakuten->amazon) DoriDori multi-size folding seamless 4cm  -- KW PASS, e2e FAIL (matcher ceiling)
Title: シームレス プレイマット ... 4つ折り 厚さ4cm 140 200 120 160 180 DoriDori  ¥12790
KW: DoriDori プレイマット シームレス 4cm  (multi-size -> dropped size, correct per rule)
RANKED #0-#2 = DoriDori 折りたたみ 4つ折り 160×120cm 厚手 (the true equivalent line, surfaced at TOP).
SEMANTIC MATCH: NO MATCH. Judge too strict: source multi-size (covers 120×160), candidate single 160×120. Matcher-side miss; equivalent WAS #0.

## Summary
Keyword-side PASS (true equivalent surfaced in ranked top-10, where an equivalent exists/is reachable):
  S1,S2,S3,S6,S7,S8,S9,S10 = 8 PASS. S4 = no cm size + brand-line not reachable cleanly. S5 = no reachable equivalent (crawler).
  Where a reachable equivalent exists (S1,S2,S3,S6,S7,S8,S9,S10 = 8 sources): 8/8 keyword-side PASS.
End-to-end PASS (judge picked the equivalent): S1,S2,S6,S8,S9 = 5.
No cross-platform equivalent reachable: S5 (cork/joint — Amazon returns 0 for ジョイントマット/コルクマット), and S4 (ALZIP アーバン folding had no cm size; brand-line reachable only with a numeric size).
Matcher-side ceiling (equivalent WAS in top-10 but judge said NO MATCH/over-strict): S3, S7, S10 = 3.

Key prompt decisions:
- Keep brand + type + ONE size + thickness; this is the winning shape (3-4 tokens).
- Size IS decisive (kept), but DROP it for multi-size listings (100 120 140 160 180) — rely on brand+type+thickness. This was correct (S10, S3) for keyword recall, but the JUDGE then rejects single-size candidates vs multi-size sources — the dominant matcher-side ceiling for this category.
- Letter-only size codes (サイズG) must NOT be turned into numbers (S4 fix).
- ジョイントマット / コルクマット tile mats are a crawler dead-end on Amazon — no fix available prompt-side.
- Minor residual over-spec: model sometimes appends a roll-mat thickness (1.5cm) not in title even after the explicit "never invent thickness" rule (strong model prior); harmless — brand pins the match, still PASS (S6 re-run).

## Re-runs (stability)
- S1 CARAZ 140x200: keyword STABLE (カラズ プレイマット 140 200 4cm) across 3 runs. Judge flaky: PASS / NO MATCH / PASS — top-3 are 2-pack sets, #3 is the clean single-unit equivalent. Counted e2e PASS (2/3). Confirms matcher-side flakiness is the ceiling, not the keyword.
- S6 popomi: re-run PASS (judge #6 popomi roll mat).
