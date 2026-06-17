# How Price-Comparison Websites Work in Japan (research, 2026-06-10)

Synthesized from three parallel web-research passes (landscape / technical mechanics / business & legal).
Sources are inline. Compiled to inform this product's Amazon↔Rakuten matching and affiliate strategy.

## 1. The two architectures

Japanese price comparison runs on two fundamentally different technical models:

### A. Merchant-push onto a curated product master (Kakaku.com)
- Kakaku.com is **not a crawler**. Merchants self-register and push their own price/stock
  in near-real-time via a dedicated admin console, bulk CSV, or cart-ASP integrations
  (Makeshop 価格.comプラン, Kaago sync, Next Engine).
- Product matching is solved **upstream**: Kakaku curates a product DB keyed by maker + 型番,
  and merchants attach prices to canonical entries. No fuzzy matching needed.
- Guidelines obligate shops to mirror their own site's price and fix promptly; Kakaku
  disclaims accuracy ("shop site governs"). Cheapest shops often exclude credit-card
  payment, so headline 最安値 ≠ card-payable price.
- Monetization: CPC click-out fees **¥10/20/25/30 per click by category** (4-tier since 2012),
  small base fee (~¥10k/mo), some categories revenue-share. No listing fee.
- The crawler-based generalist competitor (**Best Gate**) died March 2025 after 24 years.
  比較.com pivoted to B2B hotel SaaS (renamed 手間いらず). Merchant-fed survived; crawling didn't.

### B. API-pull + JAN/embedding 名寄せ (cross-mall aggregators — our model)
- **Rakuten Ichiba Item Search API**: itemPrice, postageFlag, pointRate, taxFlag, availability.
  ~1 req/sec per app ID. ToS: data only to introduce Rakuten products + link back; no archives.
- **Rakuten Product Search API (商品価格ナビ製品検索)**: keyed by JAN/製品コード, returns
  pre-merged min/max price across shops — Rakuten exposes its own price comparison via API.
- **Yahoo! Shopping itemSearch v3**: `jan_code` query param, `janCode` field, PayPay point
  fields (`bonusTimes`, `lyLimitedBonusAmount`), condition new/used. 30 req/min per app ID.
- **Amazon PA-API 5.0**: gated on an Associates sale in last 30 days; 1 rps base scaling to
  10 rps with revenue. ⚠ **PA-API v5 retires May 15, 2026** (Offers V1 ends Jan 31, 2026;
  endpoint deprecates Apr 30) → replaced by OAuth2 **Creators API** with Offers V2 payloads.
- Scraping in Japan: legal-ish for public price facts (著作権法 30条の4 / 47条の5 cover
  information-analysis and search-style snippet display); risks are server-burden
  (業務妨害 — Librahack precedent, ~1 req/sec folk throttle), ToS breach (civil only).
  不正アクセス禁止法 only applies when bypassing auth.
- **Keepa's gray-zone model**: no PA-API — own crawlers + crowdsourced extraction via ~2M-user
  browser extension (persistent WebSocket, background page loads using user sessions/bandwidth).
  ~15-min refresh on popular ASINs; resold via token-metered paid API.

## 2. Product identity & matching (the part that mirrors our codebase)

- **JAN (Japanese EAN-13)** is the load-bearing merge key everywhere. GS1 rules require a
  distinct JAN per color/size/capacity/scent/sales-unit, so JAN-level merging is naturally
  variant-granular. Rakuten's カタログID (= JAN) is now effectively mandatory in RMS;
  catalog pages rank shops by **price + shipping ascending**.
- **But JAN is dirty/incomplete in practice.** Yahoo! JAPAN published its production fix:
  BERT fine-tuned on shopping titles with CurricularFace loss → 768-d embeddings → NGT ANN
  search. Recall@10 89.6% vs 84.4% for text search; ~42% less manual 名寄せ work.
  (Directly analogous to our semanticMatch pipeline.)
- Canonical failure classes (same ones we see): keyword-stuffed Rakuten free-text titles
  (「送料無料 ポイント10倍 あす楽…」), **case packs / セット販売** (same JAN ×2/×3, carton
  GTIN-14 vs unit JAN), **並行輸入品** carrying foreign EAN/UPC instead of domestic JAN,
  used (中古) listings (Kakaku keeps these in a fully separate category, never merged into
  the new-price ranking).
- Electronics matching key is maker 型番; Rakuten's 2023 SKU Project mapped variants
  (one 商品管理番号 → multiple SKUs each with own カタログID) cleanly onto 商品価格ナビ.

## 3. 実質価格 (effective price after points) — the Japan-specific frontier

- Rakuten SPU (up to ~17x), お買い物マラソン stacking (~32% effective return possible),
  PayPay 5のつく日, Yodobashi 10–13% — sticker price systematically misranks offers.
  Community formula: 実質価格 = 支払総額 − ポイント還元 + 送料.
- **Kakaku.com does NOT fold points into ranking** (nominal price only) — its biggest gap.
- The niche attacking it: 最安値.com (user declares SPU/cards → point simulator re-ranks),
  最安値くん, ほぼやすねっと, Chrome extensions (カカクロ etc.). The hard part is that
  effective price is **user-specific and volatile** (constant 改悪 to SPU/PayPay campaigns),
  which is why these tools require a user profile. This is the clearest differentiation
  opportunity for a new comparison product — and also a 有利誤認 risk if computed wrong.

## 4. Business models — what actually makes money

- Kakaku.com Inc. (TSE 2371; DG ~20.7% + KDDI ~17.4%): FY2025/3 revenue ¥78.4B, but
  **Tabelog ≈ 43% of revenue; the shopping (price-comparison) business is declining**.
  Growth = high-ARPU vertical referrals (finance/telecom/utilities/HR 求人ボックス).
- Affiliate economics for small comparison sites are thin on electronics:
  Amazon Associates JP **2% on electronics** (¥1,000/unit cap abolished Aug 2024),
  Rakuten Affiliate 2–4% **with ¥1,000/item cap still in force**, Yahoo via ValueCommerce ~1%.
  Viable affiliate niches skew to consumables (diapers/formula/cosmetics — higher rates,
  repeat purchase) — which matches our category focus.
- What people actually *pay* for in JP price data is **seller-side tooling**: Keepa premium
  (~¥3–5k/mo, sedori resellers), aucfan subscriptions (¥1.1k–11k/mo). Consumer-side is
  ads/affiliate only. Travel metasearch (Travelko/Open Door) runs ~90% send-customer commissions.

## 5. Legal/compliance checklist for an affiliate comparison product in JP

1. **ステマ規制 (Oct 2023, 景品表示法)**: per-content PR・広告 labeling where the promotional
   content appears — a site-header banner alone is insufficient (CAA Q&A Q13). Liability sits
   with the advertiser, but ASPs contractually force publisher disclosure. Enforcement is live
   (大正製薬 Nov 2024, ロート製薬 Mar 2025; ~¥333M in 課徴金 Aug 2024–Jul 2025).
2. **Amazon Associates mandatory wording (exact)**:
   「Amazonのアソシエイトとして、［名称］は適格販売により収入を得ています。」
3. **Amazon price display**: only via PA-API/Creators API; cache ≤24h; timestamp required if
   refresh < hourly (e.g. 「Amazon.co.jp 価格：¥3,277（2026年6月10日 14:11時点）」) plus the
   mandatory variability disclaimer 「価格および在庫状況は表示された日付/時刻の時点のものであり、
   変更される場合があります…」. When comparing against other retailers, must show **both
   Amazon's new and used minimum prices**. Scraping/hand-copying prices is non-compliant.
4. **特商法**: pure referral media need no 特商法表記 (we're not the 通信販売事業者).
5. **Accuracy**: any 最安値/実質価格 claim is 有利誤認 exposure (課徴金 = 3% of attributable
   sales); stale third-party prices inherit 二重価格表示 risk.

## 6. Trends 2023–2026

- Second-tier comparison sites are dying (Best Gate ✝ 2025); value migrated to vertical
  referrals, seller data subscriptions, and transaction take-rates.
- AI shopping assistants arrived: ChatGPT Shopping Research launched in Japan Nov 24, 2025;
  Rakuten shipped おもてなしAI fall 2025; Kakaku.com is doing an AI-driven rewrite of its
  ~30-year-old C#/Classic ASP codebase.
- Comparison is migrating from destination sites into browser extensions and barcode-scan
  apps (Keepa, カカクロ, 最安値.com apps).
- Temu/AliExpress pressure the low end outside the classic comparison funnel.

## Implications for this product

- Our architecture (API-pull + JAN + semantic matching) is the same one Yahoo runs internally;
  their published BERT+ANN numbers are a benchmark (Recall@10 ~90%).
- Case packs / セット販売 and 並行輸入品 are industry-wide canonical failure classes, not just
  our bug — worth dedicated handling (we already know case-pack matching is weak).
- Point-aware 実質価格 ranking is the biggest unserved consumer gap (Kakaku doesn't do it);
  Rakuten `pointRate` and Yahoo `bonusTimes` fields make a baseline version feasible.
- **Action item: PA-API v5 → Creators API migration before Apr/May 2026 deadlines.**
- The in-flight affiliate-disclosure work (docs/superpowers/plans/2026-06-08) should implement
  the exact Associates sentence + per-section PR labeling + price timestamp/disclaimer rules above.
