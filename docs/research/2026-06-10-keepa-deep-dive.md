# Keepa Deep Dive: How It Works and How It Makes Money (research, 2026-06-10)

Synthesized from two parallel web-research passes (technical architecture / monetization & business).
Sources inline. Companion to `2026-06-10-jp-price-comparison-landscape.md`.

## One-line model

A bootstrapped German GmbH (two managing directors, €25.5k share capital, no VC, Kemnath, Bavaria)
that crowdsources Amazon scraping through ~4M free browser-extension users, paywalls the
seller-grade signals at €29/mo, and resells the same data wholesale through a €49–€4,499+/mo
token-metered API that much of the Amazon-seller-tool industry is built on.

## 1. Data collection — how Keepa gets Amazon data without PA-API

Two legs, neither of which is Amazon's official API:

1. **Server-side crawler fleet** polling Amazon product pages directly (ToS-violating, tolerated).
2. **Crowdsourced scraping via the browser extension** (~4M Chrome users, 4.7★). Documented in
   detail by Wladimir Palant ("Data exfiltration in Keepa Price Tracker", palant.info, Aug 2021):
   - Persistent WebSocket to `dyn.keepa.com`; deflate-compressed JSON.
   - **Passive**: every Amazon product page visit sends ASIN/rating/domain; search-result pages
     leak the user's queries.
   - **Active**: the server pushes commands telling the extension to background-load arbitrary
     Amazon pages (XHR/hidden frames) and scrape them with server-supplied CSS selectors/regexes
     — using the user's IP, session, and bandwidth. ~4 background scrapes/hour per user
     (2025 follow-up). A 2025 chromium-extensions report found it spoofing an Android UA.
   - Persistent unique user ID surviving data clears; remote `chrome.tabs.executeScript`
     capability (effectively RCE in Amazon tabs). Palant judged it likely non-GDPR-compliant.
   - Despite a 2021 disclosure and a 2025 Chrome Web Store policy complaint (Google acknowledged,
     no enforcement), the extension remains listed.

**Scale & cadence**: 6B+ products claimed across 11–13 marketplaces incl. amazon.co.jp.
Popularity-weighted refresh: hot ASINs ~15min–hourly, cold ASINs several hours to ~1 day;
Best Sellers lists ~6h. Extension hits opportunistically backfill whatever users browse —
which is why sparse ASINs show gappy histories.

**Derived signals**:
- **Sales estimates = "sales rank drops"** in 30/90/180/365d windows (1 drop ≈ 1 sale for slow
  movers; noisy for fast movers). Now supplemented by inventory-snapshot "Units Sold" and
  Amazon's own "Bought in Past Month".
- **Buy Box tracking** is snapshot-sampled, not exhaustive; can't reliably show Amazon's price
  when Amazon doesn't hold the Buy Box.
- **Competitor stock levels via the 999-cart trick** (add 999 units, read "only X available");
  defeated by max-order-quantity limits.
- Blind spots: lightning deals (partial), coupon/clip prices, personalized pricing, occasional
  BSR breakage when Amazon changes page structure (~10% of ASINs at one point).

## 2. Product surface

- **Free**: price-history graphs overlaid on Amazon pages (Amazon/3P new/used/FBA/Buy Box/list/
  lightning/eBay + rank/offer/review overlays), price-drop & back-in-stock alerts (email, push,
  Telegram, RSS), wishlist import, Deals browser, mobile apps.
- **Paid "Data Access"**: sales-rank history, Buy Box ownership history, offer counts, seller
  stock levels, review history, **Product Finder** (~120 filters over the whole tracked catalog,
  21 price types × current/30/90/180/365d stats, "% Amazon" Buy Box stats), Product Viewer
  (bulk ASIN, up to 24k/day), Best Sellers / Top Seller lists, seller lookup, CSV export.
  Free accounts get a 0% data quota — the seller-critical signals are entirely paywalled.

## 3. Monetization

| Stream | Pricing | Notes |
|---|---|---|
| Data Access sub | **€29/mo / €290/yr** (hiked from €19/€189 on Feb–Mar 2026; was €15 until late 2022; rank data was free pre-Feb 2019) | ≈¥5,300/mo at current FX; the paying segment is sellers, not shoppers |
| API (token-metered) | €49/mo = 20 tokens/min → €4,499/mo = 4,000/min (custom tiers reported to €53.5k/mo) | 1 token ≈ 1 product lookup; sold separately from the consumer sub |
| Referral program | 50% of first-year sub revenue | |
| eBay Partner Network | confirmed on eBay comparison links | Amazon Associates plausible but unverified; no ads model |

- **The API came first** — Keepa's registry purpose is literally "trading of data… product and
  price data of worldwide internet commerce". Consumers supply scraping capacity; sellers pay.
- **API customers** make Keepa infrastructure: SellerAmp SAS, Tactical Arbitrage, AZInsight,
  repricers, OA lead-list vendors — and **ERESA, the main Japanese "Keepa alternative", is
  itself built on Keepa's API**. Helium 10/Jungle Scout run their own pipelines (complementary,
  not customers).
- **Japan**: Keepa is the de-facto standard せどり tool since モノレート shut down (June 2020,
  under Amazon pressure); a paid-course/blog economy sits on top of it. The 2026 hike (+52%)
  triggered visible backlash but demonstrates pricing power.
- Moat: 13–15 years of accumulated history that cannot be re-scraped retroactively.

## 4. Why the Feb 2026 price hike — and the risk stack

- Amazon monetized SP-API (Nov 2025 announcement): **$1,400/yr developer fee from Jan 31, 2026**
  + metered usage from Apr 2026; and the Mar 4, 2026 BSA "Agent Policy" explicitly bans data
  scraping/AI training and adds kill-switch rights. JP analyses estimate the direct API cost is
  only ~5–12% of Keepa's increase — the rest is margin/infra/FX.
- Risk stack: (1) entire input pipeline exists at Amazon's tolerance — no lawsuit so far, but
  pressure arrives indirectly (data obfuscation, BSR breakage, agent policy); (2) Google/Chrome
  Web Store policy exposure + Manifest V3 limits on background work; (3) GDPR exposure of the
  extension telemetry; (4) 100% single-platform dependence; (5) EUR-only billing → FX churn in
  Japan, its most fanatical market. Terminal risk: Amazon shipping native price/rank history.

## Implications for this product

- Keepa proves the durable money in JP price data is **seller-side subscriptions and data
  licensing**, not consumer comparison — consistent with the landscape report's finding
  (aucfan, Keepa premium are what people pay for).
- Its crowdsourced-extension collection model is effective but legally gray (GDPR + store
  policy + Amazon ToS); not a model to copy, but it explains why Keepa's freshness beats
  API-bound competitors.
- Amazon's 2026 squeeze (PA-API→Creators API migration, SP-API fees, BSA Agent Policy banning
  scraping) is tightening all third-party access to Amazon price data simultaneously — our
  compliant-API path gets relatively more valuable, but also more rule-bound.
- The ERESA pattern (white-labeling Keepa data for the JP market) shows a viable wedge:
  localized UX on top of licensed data can win 35k+ users even against the data source itself.
