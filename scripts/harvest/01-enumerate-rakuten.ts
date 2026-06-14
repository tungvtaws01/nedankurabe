process.env.USE_UNPOOLED = '1'
import { searchRakutenGenrePage, isTrialOrSamplePack, cleanRakutenTitle } from '../../src/lib/platforms/rakuten'
import { extractJans } from '../../src/lib/jan/jan'
import { parsePackCount } from '../../src/lib/jan/pack-count'
import { resolveCategory } from '../../src/lib/jan/resolve-category'
import { upsertProduct, upsertListing, setHarvestState } from '../../src/lib/harvest/repo'
import { pool } from '../../src/lib/db'
import { BABY_GENRE_IDS } from './genres'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_PAGE = 20 // 30 hits × 20 = up to 600 items/genre; raise later if needed

async function main() {
  // --genres=<id,id,...> enumerates only those genre IDs (e.g. to crawl newly-added
  // genres without re-walking the whole baby tree). Defaults to all BABY_GENRE_IDS.
  const genresArg = process.argv.find((a) => a.startsWith('--genres='))
  const genreIds = genresArg ? genresArg.split('=')[1].split(',') : BABY_GENRE_IDS
  let total = 0, withJan = 0
  for (const genreId of genreIds) {
    for (let page = 1; page <= MAX_PAGE; page++) {
      const items = await searchRakutenGenrePage(genreId, page)
      await sleep(1100) // respect 1 req/s
      if (!items.length) break
      for (const it of items) {
        // Skip items with no usable name (null/blank) and adult-care/non-baby pollution.
        if (!it.itemName || !it.itemName.trim()) continue
        if (isTrialOrSamplePack(it.itemName)) continue
        const jans = extractJans(`${it.itemName} ${it.itemCaption ?? ''}`)
        const jan = jans[0] ?? null
        const cleanTitle = cleanRakutenTitle(it.itemName ?? '')
        // Prefer the item's own genreId; fall back to the genre page we are walking
        // (always one of the mapped baby genres) so tier-2 always has a usable signal.
        const itemGenreId = it.genreId ?? genreId
        try {
          const productId = await upsertProduct({
            jan, title: cleanTitle,
            brand: null, category: resolveCategory(cleanTitle, itemGenreId),
            imageUrl: it.smallImageUrls?.[0]?.imageUrl ?? '',
          })
          await upsertListing({
            productId, platform: 'rakuten', platformId: it.itemCode,
            title: it.itemName ?? '', packCount: parsePackCount(it.itemName ?? ''),
            matchSource: jan ? 'jan-exact' : 'title-sim', confidence: jan ? 1.0 : null,
            genreId: itemGenreId,
          })
          await setHarvestState(productId, 'enumerated')
          total++; if (jan) withJan++
        } catch (e) {
          console.error('[enumerate] error', it.itemCode, (e as Error).message)
        }
      }
      console.log(`[enumerate] genre ${genreId} page ${page}: total=${total} withJan=${withJan}`)
    }
  }
  console.log(`[enumerate] DONE total=${total} withJan=${withJan} (${total ? Math.round(100*withJan/total) : 0}% have JAN)`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
