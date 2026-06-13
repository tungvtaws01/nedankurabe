process.env.USE_UNPOOLED = '1'
import { isTrialOrSamplePack } from '../../src/lib/platforms/rakuten'
import { query, pool } from '../../src/lib/db'

// One-off maintenance: remove no_match products whose Rakuten title now matches an
// EXCLUDE_KEYWORD (genre pollution — changing mats, diaper-cake gifts, generic cloth,
// bedwetting wear, adult care, etc.). The enumerate filter blocks these going forward;
// this cleans rows enumerated before the filter was tightened. --apply to delete.
async function main() {
  const apply = process.argv.includes('--apply')
  const rows = await query<{ id: number; title: string }>(`
    SELECT p.id, lr.title FROM harvest_state hs
    JOIN products p ON p.id = hs.product_id
    JOIN listings lr ON lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active=true
    WHERE hs.stage='no_match'`)
  const polluted = rows.filter((r) => isTrialOrSamplePack(r.title))
  console.log(`no_match total=${rows.length}, polluted (matches EXCLUDE_KEYWORDS)=${polluted.length}`)
  polluted.forEach((r) => console.log(`  pid=${r.id}: ${r.title.slice(0, 80)}`))
  if (!apply) { console.log('\nDRY RUN — pass --apply to delete.'); await pool.end(); return }
  const ids = polluted.map((r) => r.id)
  if (ids.length) {
    await query(`DELETE FROM harvest_state WHERE product_id = ANY($1)`, [ids])
    await query(`DELETE FROM listings WHERE product_id = ANY($1)`, [ids])
    await query(`DELETE FROM products WHERE id = ANY($1)`, [ids])
    console.log(`\nDeleted ${ids.length} polluted products (+ their listings & state).`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
