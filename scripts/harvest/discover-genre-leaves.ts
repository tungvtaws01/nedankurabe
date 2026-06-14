process.env.USE_UNPOOLED = '1'
import { searchRakutenGenrePage } from '../../src/lib/platforms/rakuten'
import { BABY_GENRE_IDS } from './genres'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Discover which LEAF genreIds appear under each enumerated parent genre. Rakuten
// item search returns each item's leaf genreId (a child of the parent we walk), and
// those leaves — not the 18 parents — are what gets stored on listings. Walking a
// few pages per parent reveals the leaf set so rakuten-genre.ts can map leaf→category.
// Output is a parent → {leafId: count} report we read off to build the map.
const PAGES = 6
async function main() {
  for (const parent of BABY_GENRE_IDS) {
    const leaves: Record<string, number> = {}
    for (let page = 1; page <= PAGES; page++) {
      const items = await searchRakutenGenrePage(parent, page)
      await sleep(1100)
      if (!items.length) break
      for (const it of items) {
        const g = it.genreId ? String(it.genreId) : '∅'
        leaves[g] = (leaves[g] ?? 0) + 1
      }
    }
    const sorted = Object.entries(leaves).sort((a, b) => b[1] - a[1])
    console.log(`parent ${parent}: ${sorted.map(([g, c]) => `${g}(${c})`).join(' ')}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
