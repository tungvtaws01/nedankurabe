process.env.USE_UNPOOLED = '1'
import { pool } from '../../src/lib/db'
import { lookupRakutenGenreId } from '../../src/lib/platforms/rakuten'
import { resolveCategory } from '../../src/lib/jan/resolve-category'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Backfill the Rakuten genreId for products still classified 'unknown' (rows
// enumerated before the genre_id column existed). For each, fetch genreId by
// itemCode, store it on the listing, and recompute resolveCategory — tier-2 rescues
// items whose title has no keyword the regex recognises (e.g. a diaper sold by
// description only, genreId 205197 → diapers).
//
// Resumable & idempotent: only touches genre_id IS NULL rows, and writes '0'
// (Rakuten's no-genre sentinel) when an item is delisted so it is not retried.
// Rate-limited to 1 req/s (Rakuten API limit). Targets 'unknown' only because
// regex-classified rows are already accurate — genreId would not change them.
async function main() {
  const work = await pool.query<{ item_code: string; product_id: number; title: string }>(`
    SELECT DISTINCT ON (p.id) l.platform_id AS item_code, p.id AS product_id, p.title
    FROM listings l JOIN products p ON p.id = l.product_id
    WHERE l.platform = 'rakuten' AND l.genre_id IS NULL AND p.category = 'unknown'
    ORDER BY p.id`)
  console.log(`[requery] ${work.rows.length} unknown products to re-query`)

  let done = 0, rescued = 0, notFound = 0
  const rescues: Record<string, number> = {}
  for (const row of work.rows) {
    let gid: string | null = null
    try { gid = await lookupRakutenGenreId(row.item_code) } catch { gid = null }
    await sleep(1100)
    const stored = gid ?? '0'
    await pool.query(
      `UPDATE listings SET genre_id=$1 WHERE platform='rakuten' AND platform_id=$2`,
      [stored, row.item_code])
    if (!gid) notFound++
    else {
      const cat = resolveCategory(row.title, gid)
      if (cat !== 'unknown') {
        await pool.query(`UPDATE products SET category=$1, updated_at=now() WHERE id=$2`, [cat, row.product_id])
        rescued++
        rescues[cat] = (rescues[cat] ?? 0) + 1
      }
    }
    if (++done % 100 === 0) console.log(`[requery] ${done}/${work.rows.length} rescued=${rescued} notFound=${notFound} ${JSON.stringify(rescues)}`)
  }
  console.log(`[requery] DONE done=${done} rescued=${rescued} notFound=${notFound} ${JSON.stringify(rescues)}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
