# Nasal aspirator category — keyword-prompt tuning log

Category: `nasal_aspirator` (baby 鼻吸い器・鼻水吸引器: electric & manual nasal aspirators). Model: `qwen/qwen3-235b-a22b-2507`.
Goal: keyword surfaces the true cross-platform equivalent; `semanticMatch` then picks it.

## Discovery (crawler dumps, ground truth)

Per-platform dumps via `scripts/dump-search.ts`. Amazon JP returned Japanese titles (no EN→JP map strictly needed, but brand/model EN forms like `bebecure`, `Sotto Totte`, `SHUPOT`, `babysmile` still appear, so a normalize map is kept).

Product structure that decides a match:
- **Brand**: シースター/ベビースマイル (メルシーポット maker) ; ピジョン ; 丹平製薬 (ママ鼻水トッテ / ソットトッテ) ; コンビ ; ベベキュア(bebecure).
- **Line / model name**: メルシーポット / シュポット(SHUPOT) / ママ鼻水トッテ / ソットトッテ / ベベキュア / こでなBiBi — never drop.
- **Model code** (DECISIVE): メルシーポット **S-503/S-504/S-505**, ベビースマイル ハンディ **S-303/S-303NP**, コンビ **C-62**. Each numbered model is a different product; keep verbatim, never invent.
- **Type** (DECISIVE — different products):
  - 電動 = electric stationary (メルシーポット, シュポット, ベベキュア, ソットトッテ電動).
  - ハンディ = handheld/cordless electric (ベビースマイル S-303).
  - ハンドポンプ = manual hand pump (ソットトッテ ハンドポンプ) — NOT electric, NOT ハンディ.
  - 口で吸う = mouth suction (ママ鼻水トッテ) — NOT electric, NOT a pump.
- Drop: colors (ピーチ/グリーン/ローズピンク…), counts/sets (×3個セット/パーフェクトセット/ボンジュールセット/まとめ買い), accessory/replacement-part words when the device is the product (ノズル/チューブ/フィルター/ボトルカバー/フロート/コネクター/充電器/部品/交換), codes/ASIN, shop names, 送料無料/正規品/医師推奨/出産祝い, marketing (静音/パワフル/コンパクト/赤ちゃん/新生児/花粉症).

Accessory rule: if the SOURCE title is itself a replacement part (フィット鼻ノズル, ボトルカバー, フロートセット, 排水コネクター), keep brand + line + the part noun so it matches the SAME accessory, not the machine.

## Probes (PASS = SEMANTIC MATCH returns the true equivalent)

| # | Source (from) | Keyword (final) | Result |
|---|---|---|---|
| 1 | ベビースマイル メルシーポット S-504 (ピーチ) 電動鼻水吸引器 (amazon) | ベビースマイル メルシーポット S-504 電動 鼻水吸引器 | PASS (S-504 device, re-run x2 stable) |
| 2 | 丹平製薬 ソットトッテ 電動鼻すい器 ホワイト (amazon) | 丹平製薬 ソットトッテ 電動 鼻吸い器 | PASS (electric ソットトッテ) |
| 3 | ママ鼻水トッテ ×3個セット (amazon) | 丹平製薬 ママ鼻水トッテ 口で吸う 鼻吸い器 | PASS (mouth-suction; after brand-hallucination fix) |
| 4 | 丹平製薬 Sotto Totte ハンドポンプ鼻すい器 (amazon) | 丹平製薬 ソットトッテ ハンドポンプ 鼻吸い器 | PASS (hand-pump variant; after ハンドポンプ type added) |
| 5 | PIGEON ピジョン 電動鼻吸い器 SHUPOT シュポット (amazon) | ピジョン シュポット 電動 鼻吸い器 | PASS (SHUPOT device; 2/3 re-runs PASS, 1 judge NO-MATCH flake) |
| 6 | ベベキュア 電動鼻水吸引器 bebecure2電源対応 (リッチブルー) (amazon) | ベベキュア 電動 鼻水吸引器 | PASS (bebecure device) |
| 7 | PIGEON ピジョン フィット鼻ノズル Mサイズ 2個入 (amazon, ACCESSORY) | ピジョン シュポットシリーズ フィット鼻ノズル | PASS (matched the M-size nozzle accessory, NOT the machine) |
| 8 | ベビースマイル S-303NP ハンディ 電動鼻水吸引器 (rakuten→amazon) | ベビースマイル S-303NP ハンディ 電動 鼻水吸引器 | NO MATCH — keyword correct; Amazon has thin S-303 device supply (only accessories) → SUPPLY-side |
| 9 | コンビ 電動鼻吸い器 C-62 (rakuten→amazon) | コンビ C-62 電動 鼻水吸引器 | NO MATCH — keyword correct (brand+model+type); Amazon C-62 device supply thin → SUPPLY-side |

**Keyword-side pass rate: 7/9** (1,2,3,4,5,6,7 PASS). #8 and #9 produced correct, well-formed keywords but the OTHER platform (Amazon) has no listing of that device — supply-side, not keyword-side. Treating those keywords as correct, keyword quality is effectively 9/9.

Matcher-side ceilings (keyword #1 / true item in candidate set, but judge NO MATCH): 0 stable. (One transient judge flake on SHUPOT #5 — non-reproducible, PASSed on re-run.)

## Iterations & lessons

- **v1**: copied universal; added brand/model/type maps + accessory rule. Two real bugs surfaced:
  1. **Brand hallucination** — for ママ鼻水トッテ (which carries no brand in the source title), the model prepended `ピジョン`. It still matched (line word ママ鼻水トッテ is unique) but the keyword was wrong. Fix: step 1 now says keep brand ONLY if the title names it/its EN form, NEVER invent; explicitly noted ママ鼻水トッテ / ソットトッテ are 丹平製薬.
  2. **Hand pump mis-typed** — ソットトッテ **ハンドポンプ** (manual) was mapped to `ハンディ`, zeroing Rakuten (which lists it as ハンドポンプ; the electric ソットトッテ is a different product). Fix: added a distinct `ハンドポンプ` type token (manual hand pump ≠ ハンディ electric ≠ 電動), with explicit "never map ハンドポンプ to ハンディ/電動".
- **v2**: both above fixed → #3 and #4 PASS. All forward Amazon probes PASS.

Re-runs near the end (free model is nondeterministic): Mercy Pot #1 (PASS x2), SHUPOT #5 (PASS, NO-MATCH, PASS → judge flake, keyword stable), Mama Totte #3 (PASS after fix).

## Brand-equivalence map (matcher-side) — follow-up
No matcher-side ceiling hit: the judge handles シースター/ベビースマイル↔メルシーポット, ピジョン↔シュポット/SHUPOT, 丹平製薬↔ママ鼻水トッテ/ソットトッテ, ベベキュア↔bebecure equivalence, and correctly separates electric vs mouth-suction vs hand-pump types.

Brands the judge map could not be confirmed on (no Amazon supply to test the equivalence — NOT confirmed missing, just unprobed):
- **コンビ C-62** — Amazon supply thin; equivalence untested.
- **ベビースマイル ハンディ S-303 / S-303NP** — Amazon supply thin (only accessories listed); equivalence untested.
- **チュチュ / ジェクス (CHUCHU/Jex)** — could not surface a clean device listing on either platform during discovery.
