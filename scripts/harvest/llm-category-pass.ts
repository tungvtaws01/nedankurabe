process.env.USE_UNPOOLED = '1'
import { pool } from '../../src/lib/db'
import { classifyCategory } from '../../src/lib/llm/openrouter'
import { isTrialOrSamplePack } from '../../src/lib/platforms/rakuten'

// Final hybrid tier: for products still 'unknown' after the regex + Rakuten-genreId
// passes, ask the FAST LLM to classify by title. Only fills unknowns (never
// overrides a regex/genreId decision); the LLM returns 'unknown' for genuinely
// out-of-scope items (toys, chairs, bibs), which we leave as-is. Pollution is
// pre-filtered so we don't spend calls on it. Low concurrency to coexist with a
// running harvest on the same free OpenRouter model.
const CONCURRENCY = 3
async function main() {
  const rows = (await pool.query<{ id: number; title: string }>(
    `SELECT id, title FROM products WHERE category = 'unknown' ORDER BY id`)).rows
    .filter((r) => !isTrialOrSamplePack(r.title))
  console.log(`[llm] ${rows.length} unknown products to classify (pollution pre-filtered)`)

  let done = 0, rescued = 0
  const rescues: Record<string, number> = {}
  let cursor = 0
  async function worker() {
    while (cursor < rows.length) {
      const r = rows[cursor++]
      let cat: string = 'unknown'
      try { cat = await classifyCategory(r.title) } catch { cat = 'unknown' }
      if (cat !== 'unknown') {
        await pool.query(`UPDATE products SET category=$1, updated_at=now() WHERE id=$2`, [cat, r.id])
        rescued++; rescues[cat] = (rescues[cat] ?? 0) + 1
      }
      if (++done % 100 === 0) console.log(`[llm] ${done}/${rows.length} rescued=${rescued} ${JSON.stringify(rescues)}`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`[llm] DONE done=${done} rescued=${rescued} ${JSON.stringify(rescues)}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
