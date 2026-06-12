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
    `INSERT INTO listings (product_id, platform, platform_id, title, pack_count, match_source, confidence, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (platform, platform_id) DO UPDATE SET
       product_id=EXCLUDED.product_id, title=EXCLUDED.title, pack_count=EXCLUDED.pack_count,
       match_source=EXCLUDED.match_source, confidence=EXCLUDED.confidence,
       is_active=true, verified_at=now()`,
    [l.productId, l.platform, l.platformId, l.title, l.packCount, l.matchSource, l.confidence],
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
