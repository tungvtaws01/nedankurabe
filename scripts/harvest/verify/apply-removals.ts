process.env.USE_UNPOOLED = '1'
/**
 * Apply the verified verdict outcomes to the DB (REVERSIBLE):
 *   Task 1 — 158 confirmed false-positives (REMOVE): deactivate the Amazon listing +
 *            set harvest_state.stage='no_match' (same mechanism as the prior 42).
 *   Task 2 — 22 delisted Rakuten items (NEEDS_REFRESH): deactivate the dead Rakuten listing.
 * Records a restore snapshot BEFORE mutating. Dry-run by default; pass --apply to write.
 *
 * Run: node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/verify/apply-removals.ts [--apply]
 */
import { query, pool } from '../../../src/lib/db'
import { readFileSync, writeFileSync } from 'fs'

const OUT = 'docs/harvest/verify'
const APPLY = process.argv.includes('--apply')

function loadJsonl(path: string): any[] {
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function main() {
  const recon = JSON.parse(readFileSync(`${OUT}/verdicts/raw-verdicts-reconciled.json`, 'utf8')) as any[]
  const removeIds = recon.filter((v) => v.verdict === 'REMOVE').map((v) => v.id)
  const refreshIds = loadJsonl(`${OUT}/verdicts/auto-flags.jsonl`).filter((v) => v.verdict === 'NEEDS_REFRESH').map((v) => v.id)
  console.log(`REMOVE (false-positive): ${removeIds.length} | NEEDS_REFRESH (delisted): ${refreshIds.length}`)

  // Snapshot what we're about to deactivate, for restore.
  const snap = await query<any>(`
    SELECT l.product_id, l.platform, l.platform_id, l.title, l.is_active, hs.stage
    FROM listings l JOIN harvest_state hs ON hs.product_id=l.product_id
    WHERE (l.product_id = ANY($1) AND l.platform='amazon')
       OR (l.product_id = ANY($2) AND l.platform='rakuten')`, [removeIds, refreshIds])
  const esc = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  writeFileSync(`${OUT}/restore-snapshot.csv`,
    ['product_id,platform,platform_id,was_active,stage,title',
      ...snap.map((r) => [r.product_id, r.platform, r.platform_id, r.is_active, r.stage, esc(r.title)].join(','))].join('\n') + '\n')
  console.log(`restore snapshot -> ${OUT}/restore-snapshot.csv (${snap.length} rows)`)

  const before = await query<any>(`SELECT COUNT(*) n FROM listings WHERE platform='amazon' AND is_active=true`)
  console.log(`active amazon listings BEFORE: ${before[0].n}`)

  if (!APPLY) {
    console.log('\nDRY RUN — would run:')
    console.log(`  UPDATE listings SET is_active=false WHERE product_id=ANY({${removeIds.length} ids}) AND platform='amazon'`)
    console.log(`  UPDATE harvest_state SET stage='no_match' WHERE product_id=ANY({${removeIds.length} ids})`)
    console.log(`  UPDATE listings SET is_active=false WHERE product_id=ANY({${refreshIds.length} ids}) AND platform='rakuten'`)
    console.log('\nRe-run with --apply to execute.')
    await pool.end(); return
  }

  const r1 = await query(`UPDATE listings SET is_active=false WHERE product_id=ANY($1) AND platform='amazon' AND is_active=true`, [removeIds])
  const r2 = await query(`UPDATE harvest_state SET stage='no_match' WHERE product_id=ANY($1)`, [removeIds])
  const r3 = await query(`UPDATE listings SET is_active=false WHERE product_id=ANY($1) AND platform='rakuten' AND is_active=true`, [refreshIds])
  console.log(`\nAPPLIED:`)
  console.log(`  task1 amazon listings deactivated: ${(r1 as any).rowCount}`)
  console.log(`  task1 harvest_state -> no_match:    ${(r2 as any).rowCount}`)
  console.log(`  task2 rakuten listings deactivated: ${(r3 as any).rowCount}`)
  const after = await query<any>(`SELECT COUNT(*) n FROM listings WHERE platform='amazon' AND is_active=true`)
  console.log(`active amazon listings AFTER: ${after[0].n}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
