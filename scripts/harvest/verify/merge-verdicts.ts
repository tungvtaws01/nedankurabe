/**
 * Phase C: merge vision verdicts (+ auto-flags) with the crawled pair data into one
 * normalized table, and print the summary. Never mutates the DB.
 *
 *   docs/harvest/verify/verdicts-all.tsv    — full labeled table (the gold set)
 *   docs/harvest/verify/proposed-removals.csv — REMOVE rows only (for review/approval)
 *
 * Run: node node_modules/.bin/tsx scripts/harvest/verify/merge-verdicts.ts --verdicts=docs/harvest/verify/verdicts/raw-verdicts.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'

const OUT = 'docs/harvest/verify'
const vPath = process.argv.find((a) => a.startsWith('--verdicts='))?.split('=')[1]
  ?? `${OUT}/verdicts/raw-verdicts.json`

type Pair = { id: number; category: string; asin: string; rcode: string; rurl?: string
  atitle_db?: string; rtitle_db?: string; atitle_live?: string; rtitle_live?: string }
type Verdict = { id: number; verdict: string; confidence: string; mismatch?: string; qtyDiffers?: boolean; reason: string; category?: string }

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

function main() {
  const pairs = loadJsonl<Pair>(`${OUT}/pairs.jsonl`)
  const byId = new Map<number, Pair>()
  for (const p of pairs) byId.set(p.id, p) // last write wins (resume dup) — fine for titles

  const verdicts: Verdict[] = JSON.parse(readFileSync(vPath, 'utf8'))
  const autoFlags = loadJsonl<Verdict>(`${OUT}/verdicts/auto-flags.jsonl`)
  const all: Verdict[] = [...verdicts, ...autoFlags]
  // de-dupe by id (vision wins over auto if somehow both)
  const vById = new Map<number, Verdict>()
  for (const v of autoFlags) vById.set(v.id, v)
  for (const v of verdicts) vById.set(v.id, v)
  const merged = [...vById.values()].sort((a, b) => a.id - b.id)

  const esc = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const tsv = ['id\tcategory\tverdict\tconfidence\tmismatch\tqtyDiffers\treason\tasin\trakuten_url\tamazon_title\trakuten_title']
  const removals = ['product_id,category,mismatch,confidence,reason,asin,amazon_url,rakuten_url,amazon_title,rakuten_title']
  for (const v of merged) {
    const p = byId.get(v.id)
    const at = p?.atitle_live || p?.atitle_db || ''
    const rt = p?.rtitle_live || p?.rtitle_db || ''
    const cat = p?.category || v.category || ''
    tsv.push([v.id, cat, v.verdict, v.confidence, v.mismatch ?? '', v.qtyDiffers ? 'Y' : '', (v.reason ?? '').replace(/\t/g, ' '), p?.asin ?? '', p?.rurl ?? '', at.replace(/\t/g, ' '), rt.replace(/\t/g, ' ')].join('\t'))
    if (v.verdict === 'REMOVE') {
      const aurl = p?.asin ? `https://www.amazon.co.jp/dp/${p.asin}` : ''
      removals.push([v.id, cat, v.mismatch ?? '', v.confidence, esc(v.reason), p?.asin ?? '', aurl, esc(p?.rurl ?? ''), esc(at), esc(rt)].join(','))
    }
  }
  writeFileSync(`${OUT}/verdicts-all.tsv`, tsv.join('\n') + '\n')
  writeFileSync(`${OUT}/proposed-removals.csv`, removals.join('\n') + '\n')

  // ---- summary ----
  const count = (pred: (v: Verdict) => boolean) => merged.filter(pred).length
  const verds = ['KEEP', 'REMOVE', 'UNSURE', 'NEEDS_REFRESH', 'NO_DATA']
  console.log(`\n==== VERDICT TABLE: ${merged.length} pairs -> ${OUT}/verdicts-all.tsv ====`)
  for (const k of verds) console.log(`${k}\t${count((v) => v.verdict === k)}`)
  const removeN = count((v) => v.verdict === 'REMOVE')
  const judged = count((v) => ['KEEP', 'REMOVE', 'UNSURE'].includes(v.verdict))
  console.log(`\nfalse-positive (REMOVE) rate among vision-judged: ${removeN}/${judged} = ${(100 * removeN / Math.max(1, judged)).toFixed(1)}%`)
  console.log(`qtyDiffers among KEEP (price-normalization follow-up): ${count((v) => v.verdict === 'KEEP' && v.qtyDiffers)}`)

  console.log('\n-- REMOVE by mismatch type --')
  const byMis: Record<string, number> = {}
  for (const v of merged) if (v.verdict === 'REMOVE') byMis[v.mismatch ?? 'OTHER'] = (byMis[v.mismatch ?? 'OTHER'] ?? 0) + 1
  for (const k of Object.keys(byMis).sort((a, b) => byMis[b] - byMis[a])) console.log(`${k}\t${byMis[k]}`)

  console.log('\n-- by category (REMOVE / judged) --')
  const cats: Record<string, { rem: number; jud: number }> = {}
  for (const v of merged) {
    const cat = byId.get(v.id)?.category || v.category || '?'
    if (!['KEEP', 'REMOVE', 'UNSURE'].includes(v.verdict)) continue
    cats[cat] = cats[cat] || { rem: 0, jud: 0 }
    cats[cat].jud++
    if (v.verdict === 'REMOVE') cats[cat].rem++
  }
  for (const c of Object.keys(cats).sort((a, b) => (cats[b].rem / cats[b].jud) - (cats[a].rem / cats[a].jud)))
    console.log(`${c}\t${cats[c].rem}/${cats[c].jud}\t${(100 * cats[c].rem / cats[c].jud).toFixed(1)}%`)
  console.log(`\nproposed removals -> ${OUT}/proposed-removals.csv (${removeN} rows)`)
}
main()
