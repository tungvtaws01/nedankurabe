process.env.USE_UNPOOLED = '1'
import { AmazonBrowser, sleep, jitter } from './lib/amazon-browser'
import { parseAmazonSearchHtml } from '../../src/lib/crawlers/amazon'
import { rankBySimilarity, similarity } from '../../src/lib/matching/rank'
import { semanticMatch, refineKeyword } from '../../src/lib/llm/openrouter'
import { query, pool } from '../../src/lib/db'
import type { ProductResult } from '../../src/lib/types'

const SIM_THRESHOLD = 0.6
const SIM_FLOOR = 0.12

function rakutenSource(title: string): ProductResult {
  return { platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 0,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 0,
    subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1, affiliateUrl: '' }
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 20
  const rows = await query<{ id: number; jan: string | null; title: string }>(
    `SELECT p.id, p.jan, p.title FROM harvest_state hs
     JOIN products p ON p.id = hs.product_id
     WHERE hs.stage='no_match' ORDER BY hs.product_id DESC LIMIT $1`, [limit])

  const browser = new AmazonBrowser()
  await browser.start()
  let recoverable = 0, stillNo = 0, noCandidates = 0
  for (const p of rows) {
    const usedJan = p.jan != null
    const keyword = p.jan ?? await refineKeyword(p.title, 'amazon').catch(() => p.title)
    console.log(`\n=== pid=${p.id}${p.jan ? ' jan=' + p.jan : ''} ===`)
    console.log(`  SRC: ${p.title.slice(0, 85)}`)
    console.log(`  KEYWORD: ${keyword}`)
    try {
      let html = await browser.searchHtml(keyword)
      if (html === null) { console.log('  CAPTCHA'); await sleep(60000); continue }
      let candidates = parseAmazonSearchHtml(html)
      await sleep(jitter(8000, 14000))
      if (usedJan) {
        const bestSim = candidates.length
          ? Math.max(...candidates.slice(0, 5).map((c) => similarity(p.title, c.title)))
          : 0
        if (bestSim < 0.15) {
          const kw2 = await refineKeyword(p.title, 'amazon').catch(() => p.title)
          console.log(`  JAN-FALLBACK → KEYWORD2: ${kw2}`)
          const html2 = await browser.searchHtml(kw2)
          await sleep(jitter(8000, 14000))
          if (html2) { const cand2 = parseAmazonSearchHtml(html2); if (cand2.length) candidates = cand2 }
        }
      }
      if (!candidates.length) { console.log('  → 0 candidates (NO_MATCH correct: keyword returns nothing)'); noCandidates++; continue }
      const source = rakutenSource(p.title)
      const ranked = rankBySimilarity(source, candidates)
      ranked.slice(0, 3).forEach((c, i) =>
        console.log(`  cand[${i}] sim=${similarity(source.title, c.title).toFixed(2)}: ${c.title.slice(0, 80)}`))
      const idx = await semanticMatch(source, ranked).catch(() => null)
      if (idx !== null && ranked[idx] && similarity(source.title, ranked[idx].title) >= SIM_FLOOR) {
        console.log(`  → ✅ RECOVERABLE: matches cand[${ranked.indexOf(ranked[idx])}] "${ranked[idx].title.slice(0, 70)}"`)
        recoverable++
      } else {
        console.log(`  → ❌ still NO_MATCH (idx=${idx})`)
        stillNo++
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`)
    }
  }
  await browser.stop()
  console.log(`\n=== REEVAL DONE: recoverable=${recoverable} stillNo=${stillNo} noCandidates=${noCandidates} ===`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
