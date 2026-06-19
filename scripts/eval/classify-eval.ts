process.env.USE_UNPOOLED = '1'
/**
 * Eval classifyLocal precision/recall against harvested products (label = stored category).
 * Free, no crawl. Run: node --env-file=.env.local node_modules/.bin/tsx scripts/eval/classify-eval.ts
 */
import { query, pool } from '../../src/lib/db'
import { classifyLocal } from '../../src/lib/jan/classify-local'

async function main() {
  const rows = await query<{ title: string; category: string }>(
    `SELECT title, category FROM products WHERE category IS NOT NULL AND category <> 'unknown'`)
  const cats = [...new Set(rows.map((r) => r.category))].sort()
  const stat: Record<string, { tp: number; fp: number; fn: number }> = {}
  for (const c of cats) stat[c] = { tp: 0, fp: 0, fn: 0 }
  let correct = 0
  for (const r of rows) {
    const pred = classifyLocal(r.title)
    if (pred === r.category) { correct++; stat[r.category].tp++ }
    else {
      stat[r.category].fn++
      if (stat[pred]) stat[pred].fp++
    }
  }
  console.log(`overall accuracy: ${correct}/${rows.length} = ${(100 * correct / rows.length).toFixed(1)}%`)
  console.log('category\tprecision\trecall\tn')
  for (const c of cats) {
    const { tp, fp, fn } = stat[c]
    const prec = tp + fp ? tp / (tp + fp) : 0
    const rec = tp + fn ? tp / (tp + fn) : 0
    console.log(`${c}\t${(100 * prec).toFixed(1)}%\t${(100 * rec).toFixed(1)}%\t${tp + fn}`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
