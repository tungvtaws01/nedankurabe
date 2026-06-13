process.env.USE_UNPOOLED = '1'
import { query, pool } from '../../src/lib/db'
import { classifyLocal } from '../../src/lib/jan/classify-local'

// Reset one genre's products back to 'enumerated' (deleting their Amazon listings)
// so they can be re-matched after a prompt tune. Usage: --category=<id> [--apply].
// By default only no_match rows reset; pass --include-matched to also re-run matches.
async function main() {
  const catArg = process.argv.find((a) => a.startsWith('--category='))
  const category = catArg ? catArg.split('=')[1] : null
  const apply = process.argv.includes('--apply')
  const includeMatched = process.argv.includes('--include-matched')
  if (!category) { console.error('need --category='); process.exit(1) }
  const stages = includeMatched ? ['no_match', 'amazon_done'] : ['no_match']

  const rows = await query<{ pid: number; rk: string; stage: string }>(`
    SELECT p.id AS pid, lr.title AS rk, hs.stage FROM harvest_state hs
    JOIN products p ON p.id = hs.product_id
    JOIN listings lr ON lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active=true
    WHERE hs.stage = ANY($1)`, [stages])
  const ids = rows.filter((r) => classifyLocal(r.rk) === category).map((r) => r.pid)
  console.log(`${category}: ${ids.length} products to reset (stages=${stages.join(',')})`)
  if (!apply) { console.log('DRY RUN — pass --apply'); await pool.end(); return }
  if (ids.length) {
    await query(`DELETE FROM listings WHERE product_id = ANY($1) AND platform='amazon'`, [ids])
    await query(`UPDATE harvest_state SET stage='enumerated', last_error=NULL WHERE product_id = ANY($1)`, [ids])
    console.log(`Reset ${ids.length} products to enumerated.`)
  }
  await pool.end()
}
main()
