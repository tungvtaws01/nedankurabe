# JAN Matching Table & Harvest Pipeline — Design

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Scope:** Baby category, full harvest (Approach 1), Rakuten-spine (Plan B — no Yahoo API yet)

## 1. Context & Goal

The app matches products across Amazon JP ↔ Rakuten using LLM semantic matching on every
lookup (slow: LLM calls sit on the critical path; expensive: repeated for the same products).
Industry leaders (kakaku.com, saiyasune.com) avoid fuzzy matching entirely by keying products
on JAN codes. This project builds a persistent matching table — `JAN ↔ ASIN ↔ Rakuten
itemCode` — harvested in batch, then used as a fast path (~20–50ms) before the LLM fallback.

Decisions made during brainstorming:
- **Full harvest** of the baby category upfront (user has time; ScraperAPI crawl is the bottleneck).
- **Storage: Neon Postgres** via Vercel Marketplace (installed; Singapore region, free tier,
  Auth off). This is the app's first durable store and will later host the price-comparison
  cache (see latency-reduction plan).
- **Plan B / Rakuten-spine**: Yahoo! Shopping API was the preferred JAN source but the user
  cannot currently register a Yahoo JAPAN ID. Stage 1 therefore enumerates via the existing
  Rakuten API and extracts JAN from item text. A Yahoo backfill upgrades coverage later
  without schema changes.

## 2. Schema (3 tables)

```sql
-- One row per physical product. Surrogate PK because Plan B products may lack a JAN.
CREATE TABLE products (
  id         BIGSERIAL PRIMARY KEY,
  jan        TEXT UNIQUE,                  -- nullable; validated JAN-13 (check digit)
  title      TEXT NOT NULL,
  brand      TEXT,
  category   TEXT NOT NULL,                -- 'baby' for now
  image_url  TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One row per platform listing (n listings : 1 product).
CREATE TABLE listings (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id),
  platform     TEXT NOT NULL CHECK (platform IN ('amazon','rakuten','yahoo')),
  platform_id  TEXT NOT NULL,              -- ASIN / "shop:itemCode" / Yahoo code
  title        TEXT,
  pack_count   INT DEFAULT 1,              -- case-pack multiplier parsed from title
  match_source TEXT NOT NULL,              -- 'jan-exact' | 'title-sim' | 'llm'
  confidence   REAL,                       -- 1.0 for jan-exact; LLM score otherwise
  is_active    BOOLEAN DEFAULT true,       -- false when ASIN/itemCode goes dead
  verified_at  TIMESTAMPTZ,
  UNIQUE (platform, platform_id)
);
CREATE INDEX ON listings (product_id, platform);

-- Harvest checkpoint so multi-day runs survive interruption.
CREATE TABLE harvest_state (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  stage      TEXT NOT NULL,                -- 'enumerated'|'rakuten_done'|'amazon_done'|'error'|'no_match'
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

Schema decisions:
- `pack_count` from day one — multiple ASINs per JAN are almost always case-pack variants;
  this targets the known case-pack/セット販売 matching weakness. **Semantics (strict):**
  `pack_count` = number of *identical retail units* in the listing (the ×N multiplier),
  never per-unit content (66枚, 800g — those are product identity, already disambiguated
  by JAN: a 400g and an 800g can have different JANs and are different `products` rows).
  Single-unit categories (carriers, strollers) trivially use the DEFAULT 1.
  Heterogeneous bundles (assorted-flavor sets, bottle+nipple combos) get `pack_count NULL`
  and are treated as distinct products — they match only equivalent sets, never single
  units. Primary use: unit-price normalization (`effectivePrice / pack_count`) so an
  Amazon ケース品 ×4 compares fairly against a Rakuten single pack.
- `match_source` + `confidence` separate hard identifier matches from soft LLM matches,
  enabling `WHERE match_source='llm' AND confidence < x` audits.
- `harvest_state` is separate from domain tables; all writes are idempotent upserts
  (`ON CONFLICT ... DO UPDATE`) so any script can be re-run safely.

## 3. Pipeline (scripts/harvest/, run locally via ts-node)

### Stage 1 — `01-enumerate-rakuten.ts`
- Walk baby genre tree via existing `searchRakuten`/Ichiba API (genre IDs from GENRE_MAP).
- Extract JAN from `itemName`/`itemCaption`: regex 13-digit starting 45/49, **validate
  JAN-13 check digit** to reject noise. Items without extractable JAN still get a
  `products` row (jan NULL).
- Dedup: same JAN seen in multiple shops → one product, multiple `listings(rakuten)` rows
  (keep ~5 cheapest shops). Write `harvest_state='enumerated'`.
- Throttle: 1 req/s (Rakuten limit). Full baby category ≈ hours.

### Stage 2 — `02-match-amazon.ts` (bottleneck, 1–2 days)
For each product in `enumerated`:
1. Search Amazon via existing `crawlAmazonSearch(jan)` (ScraperAPI). If no JAN, search by
   refined title (reuse `refineKeyword` category prompts).
2. Decision ladder:
   - Single result + title similarity ≥ 0.6 (normalized token overlap; tune against the
     sample CSV) + price sanity (×0.3–×3 of Rakuten price) → accept as `title-sim`.
   - Multiple results (typically case-pack sizes) → LLM judge via existing
     `find-equivalent`; store each accepted ASIN with `confidence` and `pack_count`
     parsed from title (multiplier regex as in price/explain.ts).
   - Zero results after both JAN and refined-title searches → `no_match`.
3. Concurrency 3–5; checkpoint per product; watch ScraperAPI credits.

### Stage 3 — `03-report.ts`
- SQL coverage stats: % products with Amazon match / Rakuten only / no_match;
  `match_source` distribution; `no_match` grouped by brand (reveals brands needing
  prompt work).
- Export random sample (~50 matched pairs) to CSV for manual eye-check **before**
  production reads the table.

### Error handling (all stages)
- Per-product try/catch → `harvest_state='error'` + `last_error`; batch never aborts.
- `--retry-errors` flag re-runs only failed rows.

## 4. Production integration

In `find-equivalent` (read path):
1. Look up source `platform_id` in `listings`; on hit, return the other platform's
   listing(s) directly (~20–50ms) — skip refineKeyword/search/semanticMatch entirely.
2. On miss, run the existing LLM flow, then **write back** the confirmed match as
   `match_source='llm'` rows (products row created with jan NULL if unknown).

App uses pooled `DATABASE_URL`; harvest scripts use `DATABASE_URL_UNPOOLED` (long-lived
direct connection). Batched multi-row upserts (~100 rows/statement) — Mac→Singapore RTT
~70ms makes row-at-a-time writes a bottleneck.

## 5. Maintenance & future work

- **Refresh**: `--refresh` mode re-checks oldest `verified_at` rows and scans genres for
  new items; run weekly (local cron or GitHub Actions).
- **Yahoo backfill** (when a Yahoo JAPAN ID becomes available): register app ID, then a
  backfill script fills `products.jan IS NULL` rows and adds `listings(yahoo)`; existing
  rows upgrade to `jan-exact`. No schema change required. Yahoo attribution badge required
  if Yahoo data is ever shown to end users.
- **More categories**: `products.category` column + per-category genre lists make expansion
  additive.
- **Adjacent (out of scope here)**: LLM latency fixes in openrouter.ts (paid fast model
  tiers, max_tokens cuts, caching classify/refine/match) and the broader latency-reduction
  plan (cache-first serving) — see memory notes.

## 6. Testing & acceptance

- Unit (jest, existing setup): JAN-13 check-digit validator; JAN extraction regex;
  pack_count parser.
- Integration: read-path fast-path + write-back against a test database/branch.
- Acceptance before enabling fast path in production:
  1. Stage 3 report shows ≥60% of JAN-bearing products matched to Amazon.
  2. Manual review of the 50-pair CSV sample finds ≥95% correct matches.
  3. Read path returns in <100ms p95 from the Vercel app.

## 7. Risks

- **JAN extraction coverage unknown** for Rakuten captions in baby category — measure in
  Stage 1 report before judging the approach; Yahoo backfill is the mitigation.
- **ScraperAPI credits/blocking** during the 1–2 day Amazon stage — concurrency kept low,
  checkpointed resume, credits monitored.
- **LLM mis-matches written to the table** would persist — mitigated by `confidence`
  recording, the 50-pair audit, and `is_active` soft-delete for corrections.
