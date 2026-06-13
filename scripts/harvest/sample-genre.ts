process.env.USE_UNPOOLED = '1'
import { query, pool } from '../../src/lib/db'
import { classifyLocal } from '../../src/lib/jan/classify-local'

// Print matched Amazon↔Rakuten pairs for one genre so precision can be eyeballed,
// plus the genre's matched/no_match counts. Usage: --category=<id> [--limit=N]
async function main() {
  const catArg = process.argv.find((a) => a.startsWith('--category='))
  const category = catArg ? catArg.split('=')[1] : null
  const limArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limArg ? parseInt(limArg.split('=')[1], 10) : 20
  if (!category) { console.error('need --category='); process.exit(1) }

  const rows = await query<{ pid: number; rk: string; az: string; stage: string }>(`
    SELECT p.id AS pid, lr.title AS rk, la.title AS az, hs.stage
    FROM harvest_state hs
    JOIN products p ON p.id = hs.product_id
    JOIN listings lr ON lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active=true
    LEFT JOIN listings la ON la.product_id = p.id AND la.platform='amazon' AND la.is_active=true
    WHERE hs.stage IN ('amazon_done','no_match')
    ORDER BY p.id DESC`)
  const inGenre = rows.filter((r) => classifyLocal(r.rk) === category)
  const matched = inGenre.filter((r) => r.stage === 'amazon_done' && r.az)
  const noMatch = inGenre.filter((r) => r.stage === 'no_match')
  console.log(`GENRE ${category}: matched=${matched.length} no_match=${noMatch.length} rate=${matched.length + noMatch.length ? Math.round(100 * matched.length / (matched.length + noMatch.length)) : 0}%`)
  console.log(`--- ${Math.min(limit, matched.length)} matched pairs (newest first) ---`)
  for (const r of matched.slice(0, limit)) {
    console.log(`\n[pid=${r.pid}]`)
    console.log(`  RK: ${r.rk.slice(0, 80)}`)
    console.log(`  AZ: ${r.az.slice(0, 80)}`)
  }
  await pool.end()
}
main()
