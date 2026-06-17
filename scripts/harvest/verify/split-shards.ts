/**
 * Phase B prep: split the crawled pairs.jsonl into small shard files the vision
 * judges consume (one shard per agent). Pairs that can't be vision-judged (Rakuten
 * delisted, or no image on either side) are written straight to an auto-verdict file
 * so they still appear in the final table without burning an agent on them.
 *
 * Run: node node_modules/.bin/tsx scripts/harvest/verify/split-shards.ts [--size=5]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const OUT = 'docs/harvest/verify'
const SHARD_DIR = `${OUT}/shards`
const SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.split('=')[1] ?? 5)

type Rec = {
  id: number; category: string; asin: string; rcode: string
  atitle_db?: string; rtitle_db?: string; atitle_live?: string; rtitle_live?: string
  adesc?: string; rdesc?: string; aimg?: string; rimg?: string
  rakuten_status?: string; amazon_status?: string
}

function main() {
  mkdirSync(SHARD_DIR, { recursive: true })
  mkdirSync(`${OUT}/verdicts`, { recursive: true })
  if (!existsSync(`${OUT}/pairs.jsonl`)) { console.error('no pairs.jsonl'); process.exit(1) }
  const recs: Rec[] = readFileSync(`${OUT}/pairs.jsonl`, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l))
  // De-dupe by id (resume may append the same id twice across runs) — keep the richest.
  const byId = new Map<number, Rec>()
  for (const r of recs) {
    const prev = byId.get(r.id)
    const score = (x: Rec) => (x.aimg ? 2 : 0) + (x.rimg ? 2 : 0) + (x.atitle_live ? 1 : 0) + (x.rtitle_live ? 1 : 0)
    if (!prev || score(r) >= score(prev)) byId.set(r.id, r)
  }
  const all = [...byId.values()].sort((a, b) => a.id - b.id)

  const auto: any[] = []
  const judgeable: Rec[] = []
  for (const r of all) {
    if (!r.rtitle_live && r.rakuten_status) {
      auto.push({ id: r.id, category: r.category, verdict: 'NEEDS_REFRESH', confidence: 'high',
        reason: `Rakuten item no longer returned by API (${r.rakuten_status}); listing is stale.` })
    } else if (!r.aimg && !r.rimg) {
      auto.push({ id: r.id, category: r.category, verdict: 'NO_DATA', confidence: 'low',
        reason: 'No image retrievable on either side; cannot vision-verify.' })
    } else {
      judgeable.push(r)
    }
  }

  let shardN = 0
  for (let i = 0; i < judgeable.length; i += SIZE) {
    const slice = judgeable.slice(i, i + SIZE).map((r) => ({
      id: r.id, category: r.category,
      atitle: r.atitle_live || r.atitle_db || '', rtitle: r.rtitle_live || r.rtitle_db || '',
      adesc: (r.adesc || '').slice(0, 240), rdesc: (r.rdesc || '').slice(0, 240),
      aimg: r.aimg || '', rimg: r.rimg || '',
    }))
    writeFileSync(`${SHARD_DIR}/shard-${String(shardN).padStart(3, '0')}.jsonl`,
      slice.map((s) => JSON.stringify(s)).join('\n') + '\n')
    shardN++
  }
  writeFileSync(`${OUT}/verdicts/auto-flags.jsonl`, auto.map((a) => JSON.stringify(a)).join('\n') + '\n')
  console.log(`[split] ${all.length} pairs: ${judgeable.length} judgeable -> ${shardN} shards (size ${SIZE}); ${auto.length} auto-flagged (NEEDS_REFRESH/NO_DATA)`)
}
main()
