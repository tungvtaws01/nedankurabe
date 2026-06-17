/**
 * Re-download the images for a given set of product ids at HIGH resolution (600px) directly
 * from the public image CDNs (no scrape.do), and write fresh shards pointing at them so the
 * vision judge can re-verify. Used to re-check the 175 REMOVEs after the 300px first pass
 * misread fine print (flavor/character banners).
 *
 * Run: node node_modules/.bin/tsx scripts/harvest/verify/refetch-hires.ts [--verdict=REMOVE] [--size=5]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const OUT = 'docs/harvest/verify'
const IMG = `${OUT}/img-hi`
const SIZE = Number(process.argv.find((a) => a.startsWith('--size='))?.split('=')[1] ?? 5)
const WANT = process.argv.find((a) => a.startsWith('--verdict='))?.split('=')[1] ?? 'REMOVE'
const SHARDS = `${OUT}/shards-hi-${WANT.toLowerCase()}`
const AH = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36' }

/** Bump an Amazon media URL to ~600px, keeping any bundle-composite params. */
function amzHi(u: string): string {
  if (!u) return u
  if (/_S[XY]\d+_/.test(u)) return u.replace(/_S[XY]\d+_/g, '_SX600_')
  return u.replace(/(\/I\/[^.]+)\.(jpg|png)/i, '$1._SX600_.$2')
}
const rakHi = (u: string) => u ? (/_ex=\d+x\d+/.test(u) ? u.replace(/_ex=\d+x\d+/, '_ex=600x600') : u + (u.includes('?') ? '&' : '?') + '_ex=600x600') : u

async function dl(url: string, path: string): Promise<boolean> {
  if (!url) return false
  try {
    const r = await fetch(url, { headers: AH, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return false
    const b = Buffer.from(await r.arrayBuffer())
    if (b.length < 500) return false
    writeFileSync(path, b)
    return true
  } catch { return false }
}

async function main() {
  mkdirSync(IMG, { recursive: true })
  mkdirSync(SHARDS, { recursive: true })
  const verds = JSON.parse(readFileSync(`${OUT}/verdicts/raw-verdicts.json`, 'utf8')) as any[]
  const wantIds = new Set(verds.filter((v) => v.verdict === WANT).map((v) => v.id))
  const pairs = new Map<number, any>()
  for (const l of readFileSync(`${OUT}/pairs.jsonl`, 'utf8').trim().split('\n')) { const r = JSON.parse(l); if (wantIds.has(r.id)) pairs.set(r.id, r) }

  const recs: any[] = []
  let aOk = 0, rOk = 0
  const ids = [...pairs.keys()].sort((a, b) => a - b)
  for (let i = 0; i < ids.length; i += 8) {
    await Promise.all(ids.slice(i, i + 8).map(async (id) => {
      const p = pairs.get(id)
      const aPath = `${IMG}/${id}-a.jpg`, rPath = `${IMG}/${id}-r.jpg`
      const a = await dl(amzHi(p.aimg_url || ''), aPath)
      const r = await dl(rakHi(p.rimg_url || ''), rPath)
      if (a) aOk++; if (r) rOk++
      recs.push({
        id, category: p.category,
        atitle: p.atitle_live || p.atitle_db || '', rtitle: p.rtitle_live || p.rtitle_db || '',
        adesc: (p.adesc || '').slice(0, 240), rdesc: (p.rdesc || '').slice(0, 240),
        aimg: a ? aPath : '', rimg: r ? rPath : '',
      })
    }))
  }
  recs.sort((a, b) => a.id - b.id)
  let n = 0
  for (let i = 0; i < recs.length; i += SIZE) {
    writeFileSync(`${SHARDS}/shard-${String(n).padStart(3, '0')}.jsonl`,
      recs.slice(i, i + SIZE).map((s) => JSON.stringify(s)).join('\n') + '\n')
    n++
  }
  console.log(`[refetch-hires] ${ids.length} ${WANT} ids: aImg=${aOk} rImg=${rOk} -> ${n} shards in ${SHARDS}`)
}
main()
