process.env.USE_UNPOOLED = '1'
import { pool } from '../../src/lib/db'
import { resolveCategory } from '../../src/lib/jan/resolve-category'

// One-off backfill: recompute products.category for every row using resolveCategory
// (tier-0 pollution → tier-1 title regex → tier-2 Rakuten genreId). Existing rows
// were all stamped the umbrella 'baby'; this replaces that with the fine genre.
// genre_id is mostly NULL until requery-genre.ts runs, so this pass is regex-driven;
// re-running it after the re-query upgrades the genreId-dependent rows. Idempotent.
async function main() {
  const before = await pool.query(`SELECT category, count(*) c FROM products GROUP BY category ORDER BY c DESC`)
  console.log('=== before ===')
  for (const r of before.rows as any[]) console.log(`${r.category}: ${r.c}`)

  const rows = await pool.query<{ id: number; title: string; genre_id: string | null }>(`
    SELECT p.id, p.title,
      (SELECT l.genre_id FROM listings l
        WHERE l.product_id = p.id AND l.platform = 'rakuten' AND l.genre_id IS NOT NULL
        LIMIT 1) AS genre_id
    FROM products p`)

  // Group product ids by resolved category, then one UPDATE per category.
  const byCategory = new Map<string, number[]>()
  for (const r of rows.rows) {
    const cat = resolveCategory(r.title, r.genre_id)
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(r.id)
  }

  let updated = 0
  for (const [cat, ids] of byCategory) {
    // chunk to keep the parameter array reasonable
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000)
      const res = await pool.query(
        `UPDATE products SET category=$1, updated_at=now() WHERE id = ANY($2) AND category IS DISTINCT FROM $1`,
        [cat, chunk])
      updated += res.rowCount ?? 0
    }
  }
  console.log(`\nrows changed: ${updated}`)

  const after = await pool.query(`SELECT category, count(*) c FROM products GROUP BY category ORDER BY c DESC`)
  console.log('=== after ===')
  for (const r of after.rows as any[]) console.log(`${r.category}: ${r.c}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
