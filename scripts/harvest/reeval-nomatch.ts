process.env.USE_UNPOOLED = '1'
import { AmazonBrowser, sleep, jitter } from './lib/amazon-browser'
import { parseAmazonSearchHtml } from '../../src/lib/crawlers/amazon'
import { rankBySimilarity, similarity } from '../../src/lib/matching/rank'
import { semanticMatch, refineKeyword } from '../../src/lib/llm/openrouter'
import { parsePackCount } from '../../src/lib/jan/pack-count'
import { classifyLocal } from '../../src/lib/jan/classify-local'
import { upsertListing, setHarvestState } from '../../src/lib/harvest/repo'
import { query, pool } from '../../src/lib/db'
import type { ProductResult } from '../../src/lib/types'

const SIM_FLOOR = 0.12

// Accessories the genre regex wrongly buckets as the product (stands/racks/holders/
// cases/lids/cushions/parts). Skipped so the re-probe targets real comparable products.
const ACCESSORY = /スタンド|ラック|水切り|乾燥ラック|乾燥機|ドライラック|哺乳瓶ホルダー|哺乳びんホルダー|おしゃぶりホルダー|授乳クッション|授乳枕|サポートクッション|セルフミルク|ミルククッション|おしりふきケース|ウェットシートケース|哺乳瓶ケース|保管ケース|収納ケース|のフタ|に貼るフタ|ウェットシートのふた|シート用フタ|拭きのフタ|ビタット|Bitatto|母乳実感パーツ|交換パーツ|哺乳瓶ポーチ|哺乳瓶入れ|哺乳瓶カバー|哺乳瓶ボックス|マザーズバッグ|保冷バッグ|保温バッグ|洗浄器具|消毒ケース|ボトルスタンド|哺乳瓶収納|乾燥スタンド/

function rakutenSource(title: string): ProductResult {
  return { platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 0,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 0,
    subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1, affiliateUrl: '' }
}

async function main() {
  const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
  const limit = arg('limit') ? parseInt(arg('limit')!, 10) : 20
  const category = arg('category') ?? null
  const apply = process.argv.includes('--apply') // write recovered matches to DB

  // Pull genuine (non-accessory) no_match products; JAN-bearing first (likeliest recoverable).
  let rows = await query<{ id: number; jan: string | null; title: string }>(
    `SELECT p.id, p.jan, p.title FROM harvest_state hs
     JOIN products p ON p.id = hs.product_id
     WHERE hs.stage='no_match' ORDER BY (p.jan IS NULL), p.id DESC`)
  if (category) rows = rows.filter((r) => classifyLocal(r.title) === category)
  rows = rows.filter((r) => !ACCESSORY.test(r.title)).slice(0, limit)

  const browser = new AmazonBrowser()
  await browser.start()
  let recoverable = 0, stillNo = 0, noCandidates = 0
  for (const p of rows) {
    const usedJan = p.jan != null
    const keyword = p.jan ?? await refineKeyword(p.title, 'amazon').catch(() => p.title)
    console.log(`\n=== pid=${p.id}${p.jan ? ' jan=' + p.jan : ''} ===`)
    console.log(`  SRC: ${p.title.slice(0, 85)}`)
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
          const html2 = await browser.searchHtml(kw2)
          await sleep(jitter(8000, 14000))
          if (html2) { const cand2 = parseAmazonSearchHtml(html2); if (cand2.length) candidates = cand2 }
        }
      }
      if (!candidates.length) { console.log('  → 0 candidates'); noCandidates++; continue }
      const source = rakutenSource(p.title)
      const ranked = rankBySimilarity(source, candidates)
      const idx = await semanticMatch(source, ranked).catch(() => null)
      if (idx !== null && ranked[idx] && similarity(source.title, ranked[idx].title) >= SIM_FLOOR) {
        const c = ranked[idx]
        console.log(`  → ✅ RECOVERABLE: "${c.title.slice(0, 70)}"`)
        recoverable++
        if (apply) {
          const asin = c.affiliateUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? c.affiliateUrl.match(/([A-Z0-9]{10})/)?.[1]
          if (asin) {
            await upsertListing({ productId: p.id, platform: 'amazon', platformId: asin, title: c.title,
              packCount: parsePackCount(c.title), matchSource: 'llm', confidence: 0.85 })
            await setHarvestState(p.id, 'amazon_done')
            console.log(`     WROTE amazon_done (asin=${asin})`)
          }
        }
      } else {
        console.log(`  → ❌ still NO_MATCH`)
        stillNo++
      }
    } catch (e) {
      console.log(`  ERROR: ${(e as Error).message}`)
    }
  }
  await browser.stop()
  console.log(`\n=== REEVAL${apply ? ' (APPLIED)' : ''}: recoverable=${recoverable} stillNo=${stillNo} noCandidates=${noCandidates} of ${rows.length} ===`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
