import { query } from '../db'

export interface ProductInput {
  jan: string | null
  title: string
  brand: string | null
  category: string
  imageUrl: string
}

export interface ListingInput {
  productId: number
  platform: 'amazon' | 'rakuten' | 'yahoo'
  platformId: string
  title: string
  packCount: number
  matchSource: 'jan-exact' | 'title-sim' | 'llm'
  confidence: number | null
  genreId?: string | null
}

export interface ListingRow {
  id: number
  product_id: number
  platform: string
  platform_id: string
  pack_count: number
  match_source: string
  confidence: number | null
  is_active: boolean
}

// Insert or update a product. When jan is provided, dedupe on it; otherwise always insert.
export async function upsertProduct(p: ProductInput): Promise<number> {
  if (p.jan) {
    const rows = await query<{ id: number }>(
      `INSERT INTO products (jan, title, brand, category, image_url)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (jan) DO UPDATE SET title=EXCLUDED.title, brand=EXCLUDED.brand,
         image_url=EXCLUDED.image_url, updated_at=now()
       RETURNING id`,
      [p.jan, p.title, p.brand, p.category, p.imageUrl],
    )
    return rows[0].id
  }
  const rows = await query<{ id: number }>(
    `INSERT INTO products (jan, title, brand, category, image_url)
     VALUES (NULL,$1,$2,$3,$4) RETURNING id`,
    [p.title, p.brand, p.category, p.imageUrl],
  )
  return rows[0].id
}

export async function upsertListing(l: ListingInput): Promise<void> {
  await query(
    `INSERT INTO listings (product_id, platform, platform_id, title, pack_count, match_source, confidence, genre_id, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
     ON CONFLICT (platform, platform_id) DO UPDATE SET
       product_id=EXCLUDED.product_id, title=EXCLUDED.title, pack_count=EXCLUDED.pack_count,
       match_source=EXCLUDED.match_source, confidence=EXCLUDED.confidence,
       genre_id=COALESCE(EXCLUDED.genre_id, listings.genre_id),
       is_active=true, verified_at=now()`,
    [l.productId, l.platform, l.platformId, l.title, l.packCount, l.matchSource, l.confidence, l.genreId ?? null],
  )
}

export async function setHarvestState(productId: number, stage: string, lastError?: string): Promise<void> {
  await query(
    `INSERT INTO harvest_state (product_id, stage, last_error)
     VALUES ($1,$2,$3)
     ON CONFLICT (product_id) DO UPDATE SET stage=EXCLUDED.stage, last_error=EXCLUDED.last_error, updated_at=now()`,
    [productId, stage, lastError ?? null],
  )
}

export async function findListingByPlatformId(platformId: string): Promise<ListingRow | null> {
  const rows = await query<ListingRow>(
    `SELECT * FROM listings WHERE platform_id=$1 AND is_active=true LIMIT 1`, [platformId])
  return rows[0] ?? null
}

// Active sibling listings on the other platform for a product.
export async function findSiblingListings(productId: number, platform: 'amazon' | 'rakuten'): Promise<ListingRow[]> {
  return query<ListingRow>(
    `SELECT * FROM listings WHERE product_id=$1 AND platform=$2 AND is_active=true`, [productId, platform])
}

// Products at a given harvest stage (for stage-to-stage progression).
export async function productsAtStage(stage: string, limit: number): Promise<{ id: number; jan: string | null; title: string }[]> {
  return query(
    `SELECT p.id, p.jan, p.title FROM products p
     JOIN harvest_state h ON h.product_id=p.id WHERE h.stage=$1 LIMIT $2`, [stage, limit])
}

export interface AmazonSibling { asin: string; productTitle: string; productImageUrl: string }

// Given a Rakuten listing's platform_id ("shop:itemId"), return the matched Amazon
// ASIN plus the AMAZON listing's own title (the card links to that ASIN, so its title +
// parsed size must describe the destination) and the Rakuten-sourced image. DB-only; no scraping.
export async function findAmazonSiblingByRakuten(rakutenItemCode: string): Promise<AmazonSibling | null> {
  const rows = await query<{ asin: string; title: string; image_url: string }>(
    `SELECT la.platform_id AS asin, la.title, p.image_url
       FROM listings lr
       JOIN products p ON p.id = lr.product_id
       JOIN listings la ON la.product_id = p.id AND la.platform='amazon' AND la.is_active
      WHERE lr.platform='rakuten' AND lr.platform_id=$1 AND lr.is_active
      LIMIT 1`,
    [rakutenItemCode],
  )
  return rows[0]
    ? { asin: rows[0].asin, productTitle: rows[0].title, productImageUrl: rows[0].image_url }
    : null
}

export interface AmazonMatch { productTitle: string; productImageUrl: string; rakutenItemCode: string | null }

// Given an Amazon ASIN, return the product's title + Rakuten-sourced image and the
// matched Rakuten listing's platform_id (null if no Rakuten sibling). DB-only.
export async function findMatchByAsin(asin: string): Promise<AmazonMatch | null> {
  const rows = await query<{ title: string; image_url: string; rakuten_code: string | null }>(
    `SELECT p.title, p.image_url,
            (SELECT lr.platform_id FROM listings lr
              WHERE lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active
              LIMIT 1) AS rakuten_code
       FROM listings la
       JOIN products p ON p.id = la.product_id
      WHERE la.platform='amazon' AND la.platform_id=$1 AND la.is_active
      LIMIT 1`,
    [asin],
  )
  return rows[0]
    ? { productTitle: rows[0].title, productImageUrl: rows[0].image_url, rakutenItemCode: rows[0].rakuten_code }
    : null
}

// Resolve a JAN (EAN-13) to its product + active listings. Used by the lookup route when a
// Rakuten URL slug is a bare JAN (e.g. /netbaby/4987244195937/) rather than an itemCode.
export async function findByJan(jan: string): Promise<
  { productTitle: string; productImageUrl: string; rakutenItemCode: string | null; asin: string | null } | null
> {
  const rows = await query<{ title: string; image_url: string; rakuten_id: string | null; asin: string | null }>(`
    SELECT p.title,
           p.image_url,
           (SELECT l.platform_id FROM listings l WHERE l.product_id=p.id AND l.platform='rakuten' AND l.is_active=true LIMIT 1) AS rakuten_id,
           (SELECT l.platform_id FROM listings l WHERE l.product_id=p.id AND l.platform='amazon'  AND l.is_active=true LIMIT 1) AS asin
    FROM products p WHERE p.jan=$1 LIMIT 1`, [jan])
  const r = rows[0]
  if (!r) return null
  return { productTitle: r.title, productImageUrl: r.image_url, rakutenItemCode: r.rakuten_id, asin: r.asin }
}

// Search active Amazon listings by keyword for the search pick-list. Tokenizes the
// query on whitespace and requires every token to appear in the product title
// (ILIKE AND). DB-only: returns the matched ASIN + product title + Rakuten-sourced
// image so the caller can build a link-only Amazon card (no scraping, no Amazon image).
export async function searchAmazonFromDb(keyword: string, limit = 10): Promise<AmazonSibling[]> {
  const tokens = keyword.trim().split(/[\s　]+/).filter(Boolean).slice(0, 6)
  if (!tokens.length) return []
  const conds = tokens.map((_, i) => `p.title ILIKE $${i + 1}`).join(' AND ')
  const params = [...tokens.map((t) => `%${t}%`), limit]
  const rows = await query<{ asin: string; title: string; image_url: string }>(
    `SELECT la.platform_id AS asin, p.title, p.image_url
       FROM products p
       JOIN listings la ON la.product_id = p.id AND la.platform='amazon' AND la.is_active
      WHERE ${conds} AND p.image_url <> ''
      LIMIT $${tokens.length + 1}`,
    params,
  )
  return rows.map((r) => ({ asin: r.asin, productTitle: r.title, productImageUrl: r.image_url }))
}

export interface ProductCandidate {
  productId: number
  title: string // the TARGET listing's own title (what the card links to), not the Rakuten product title
  imageUrl: string
  targetListingId: string // ASIN or "shop:itemId" on the target platform
}

// Candidates for cross-platform DB matching: products that already have an active
// listing on `targetPlatform` and whose title (whitespace-collapsed) contains every
// textual token (ILIKE-AND). Size/numeric tokens are dropped from the AND so all
// pack sizes surface; ranking handles size selection.
export async function findProductCandidatesByTokens(
  keyword: string,
  targetPlatform: 'amazon' | 'rakuten',
  limit = 20,
): Promise<ProductCandidate[]> {
  // Textual tokens only: drop pure-number / size tokens (12, 27g, 780g, 240ml, 58枚,
  // 2袋…) — pack size is handled by ranking, not retrieval. Keep brand/product words.
  const SIZE_TOKEN = /^(?:[×x×]\d+|\d+(?:\.\d+)?(?:g|kg|ml|l|枚|袋|缶|個|本|箱|セット|パック|ケース|組)?)$/i
  const tokens = keyword.trim().split(/[\s　]+/).filter((t) => t && !SIZE_TOKEN.test(t)).slice(0, 6)
  if (!tokens.length) return []
  // Space-insensitive: compare the title with whitespace removed against space-stripped tokens,
  // so "明治 ほほえみ" matches "明治ほほえみ". Non-indexed scan; table is ~10k rows.
  const conds = tokens
    .map((_, i) => `regexp_replace(p.title, '[\\s　]', '', 'g') ILIKE $${i + 1}`)
    .join(' AND ')
  const params = [...tokens.map((t) => `%${t.replace(/[\s　]/g, '')}%`), targetPlatform, limit]
  // Retrieve by the Rakuten products.title tokens (tuned for recall), but return the
  // TARGET listing's own title (lt.title) — that's the listing the card links to, so its
  // title + parsed pack size must describe the destination, not the Rakuten product row.
  // Image stays Rakuten-sourced (p.image_url) for Amazon compliance.
  const rows = await query<{ product_id: number; target_title: string; image_url: string; target_id: string }>(
    `SELECT p.id AS product_id, lt.title AS target_title, p.image_url, lt.platform_id AS target_id
       FROM products p
       JOIN listings lt ON lt.product_id = p.id AND lt.platform = $${tokens.length + 1} AND lt.is_active
      WHERE ${conds} AND p.image_url <> ''
      LIMIT $${tokens.length + 2}`,
    params,
  )
  return rows.map((r) => ({
    productId: r.product_id, title: r.target_title, imageUrl: r.image_url, targetListingId: r.target_id,
  }))
}

// Write-back: link a pasted slug/ASIN to an already-known product so the next paste
// of the same URL hits the instant exact-id path. matchSource='llm' keeps these
// rows separable from vision-verified matches. Idempotent via upsertListing's
// ON CONFLICT (platform, platform_id).
export async function linkSlugToProduct(
  productId: number,
  platform: 'amazon' | 'rakuten',
  platformId: string,
  title: string,
  confidence: number,
): Promise<void> {
  await upsertListing({
    productId, platform, platformId, title, packCount: 1, matchSource: 'llm', confidence,
  })
}
