process.env.USE_UNPOOLED = '1'
import { AmazonBrowser, sleep, jitter } from './lib/amazon-browser'
import { parseAmazonSearchHtml } from '../../src/lib/crawlers/amazon'
import { rankBySimilarity, similarity } from '../../src/lib/matching/rank'
import { semanticMatch, refineKeyword } from '../../src/lib/llm/openrouter'
import { parsePackCount } from '../../src/lib/jan/pack-count'
import { isTrialOrSamplePack } from '../../src/lib/platforms/rakuten'
import { upsertListing, setHarvestState, productsAtStage } from '../../src/lib/harvest/repo'
import { classifyLocal } from '../../src/lib/jan/classify-local'
import { query, pool } from '../../src/lib/db'
import type { ProductResult } from '../../src/lib/types'
import type { Category } from '../../src/lib/llm/category-prompts'

// Build a minimal ProductResult from a Rakuten listing row to feed semanticMatch as the "source".
async function rakutenSourceFor(productId: number): Promise<ProductResult | null> {
  // salePrice is intentionally 0: the harvest does not persist prices (they're
  // volatile and fetched live at serve time), and matching is done on
  // brand/line/type/size — never price — so no price-sanity check happens here.
  const rows = await query<{ title: string; salePrice: number }>(
    `SELECT title, 0 AS "salePrice" FROM listings WHERE product_id=$1 AND platform='rakuten' AND is_active=true LIMIT 1`,
    [productId])
  if (!rows[0]) return null
  return { platform: 'rakuten', title: rows[0].title, imageUrl: '', shopName: '', salePrice: rows[0].salePrice,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 0,
    subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1, affiliateUrl: '' }
}

// Minimum title similarity to accept a lone Amazon search result without LLM
// verification. Tuned against the Stage 3 sample CSV.
const SIM_THRESHOLD = 0.6
// Floor for LLM-chosen matches: rejects degenerate brand-only hits (e.g. a source with a
// detailed title matched to a terse "okamoto(オカモト)" Amazon result, which score ~0).
// Genuine same-product pairs share type/size tokens and score well above this.
const SIM_FLOOR = 0.12

async function main() {
  const refresh = process.argv.includes('--refresh')
  const retryErrors = process.argv.includes('--retry-errors')
  // --limit=N caps how many products this run processes (default: all). Useful for
  // a bounded trial run before committing to the full ~30h harvest.
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 100000
  // --category=<id> processes only enumerated products in that genre, so each genre
  // can be harvested + evaluated + tuned on its own. Reads the persisted, accurate
  // products.category (3-tier resolveCategory: pollution → title regex → Rakuten
  // genreId) — NOT a runtime title regex — so it covers products whose genre was
  // recovered from the Rakuten genreId (keyword-less titles the regex alone missed).
  const catArg = process.argv.find((a) => a.startsWith('--category='))
  const category = catArg ? catArg.split('=')[1] : null
  let batch: { id: number; jan: string | null; title: string }[]
  if (refresh) {
    // Re-verify Amazon listings not checked in the last 7 days (dead ASINs,
    // price drift, new items). EXISTS keeps one row per product (no JOIN
    // fan-out for products with multiple amazon listings) and lets us ORDER BY
    // p.id cleanly. Cap at 2000 per run to bound a maintenance pass.
    batch = await query<{ id: number; jan: string | null; title: string }>(
      `SELECT p.id, p.jan, p.title FROM products p
       WHERE EXISTS (
         SELECT 1 FROM listings l
         WHERE l.product_id = p.id AND l.platform = 'amazon'
           AND l.verified_at < now() - interval '7 days')
       ORDER BY p.id LIMIT 2000`)
  } else if (category) {
    // Indexed lookup on the persisted category + enumerated stage. The
    // isTrialOrSamplePack filter is belt-and-suspenders (tier-0 already excludes
    // pollution from real categories) so no accessory slips into no_match.
    const rows = await query<{ id: number; jan: string | null; title: string }>(
      `SELECT p.id, p.jan, p.title FROM products p
       JOIN harvest_state hs ON hs.product_id = p.id
       WHERE hs.stage = 'enumerated' AND p.category = $1
       ORDER BY p.id LIMIT $2`, [category, limit])
    batch = rows.filter((p) => !isTrialOrSamplePack(p.title))
    console.log(`[amazon] category=${category}: ${batch.length} enumerated products`)
  } else {
    batch = await productsAtStage('enumerated', limit)
    if (retryErrors) {
      const errs = await productsAtStage('error', limit)
      batch.push(...errs)
    }
  }
  const browser = new AmazonBrowser()
  await browser.start()
  let matched = 0, noMatch = 0, captchaPauses = 0
  for (const p of batch) {
    // Fix A: JAN-bearing products search by JAN (precise); for the rest, refine the noisy
    // Rakuten title into a tight brand+line+type+size keyword (same as production
    // find-equivalent) instead of searching the raw title — raw titles carry
    // 【10個セット】/大容量パック/marketing noise that returns 0–1 poor Amazon results.
    const usedJan = p.jan != null
    // Route to per-genre matching rules: use the known --category if set, else
    // classify per-product; map 'unknown' → undefined so it falls back to GENERAL_RULES.
    const cat = category ?? classifyLocal(p.title)
    const catOpt = cat === 'unknown' ? undefined : (cat as Category)
    const keyword = p.jan ?? await refineKeyword(p.title, 'amazon', catOpt).catch(() => p.title)
    try {
      let html = await browser.searchHtml(keyword)
      if (html === null) {
        captchaPauses++
        console.warn(`[amazon] CAPTCHA — pausing 45min (pause #${captchaPauses})`)
        await sleep(45 * 60 * 1000)
        html = await browser.searchHtml(keyword)
        if (html === null) { await setHarvestState(p.id, 'error', 'captcha'); continue }
      }
      let candidates = parseAmazonSearchHtml(html)
      await sleep(jitter(8000, 15000))
      // JAN-search fallback: Amazon's search does not index JAN/EAN reliably — a JAN
      // query frequently returns 0 results or unrelated products (e.g. formula/detergent
      // for a diaper JAN). When the JAN search yields nothing usable (no candidate is even
      // loosely similar to the source title), retry once with a refined brand+line+type+size
      // keyword, the same path non-JAN products take. Only triggers on the JAN path.
      if (usedJan) {
        const bestSim = candidates.length
          ? Math.max(...candidates.slice(0, 5).map((c) => similarity(p.title, c.title)))
          : 0
        if (bestSim < 0.15) {
          const kw2 = await refineKeyword(p.title, 'amazon', catOpt).catch(() => p.title)
          const html2 = await browser.searchHtml(kw2)
          await sleep(jitter(8000, 15000))
          if (html2) {
            const cand2 = parseAmazonSearchHtml(html2)
            if (cand2.length) candidates = cand2
          }
        }
      }
      if (!candidates.length) { await setHarvestState(p.id, 'no_match'); noMatch++; continue }

      const source = await rakutenSourceFor(p.id)
      let chosen: ProductResult[] = []
      let viaLLM = false
      if (source && candidates.length === 1 && similarity(source.title, candidates[0].title) >= SIM_THRESHOLD) {
        // High-confidence lone result — accept without an LLM call.
        chosen = candidates
      } else if (source && candidates.length) {
        // Fix B: multiple candidates, OR a lone result below the fast-accept bar (e.g. a
        // case-pack whose differing count drags similarity under SIM_THRESHOLD) — let the
        // LLM judge (it applies the case-pack/variant policy). SIM_FLOOR still guards
        // against degenerate brand-only matches on genre-polluted / terse candidates.
        const ranked = rankBySimilarity(source, candidates)
        const idx = await semanticMatch(source, ranked, { category: catOpt }).catch(() => null)
        if (idx !== null && ranked[idx] && similarity(source.title, ranked[idx].title) >= SIM_FLOOR) {
          chosen = [ranked[idx]]
          viaLLM = true
        }
      }
      if (!chosen.length) { await setHarvestState(p.id, 'no_match'); noMatch++; continue }

      for (const c of chosen) {
        const asin = c.affiliateUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? c.affiliateUrl.match(/([A-Z0-9]{10})/)?.[1]
        if (!asin) continue
        await upsertListing({
          productId: p.id, platform: 'amazon', platformId: asin, title: c.title,
          packCount: parsePackCount(c.title),
          matchSource: viaLLM ? 'llm' : 'title-sim',
          confidence: viaLLM ? 0.85 : 0.7,
        })
      }
      await setHarvestState(p.id, 'amazon_done'); matched++
      console.log(`[amazon] ${matched} matched / ${noMatch} no_match (id=${p.id})`)
    } catch (e) {
      await setHarvestState(p.id, 'error', (e as Error).message)
    }
  }
  await browser.stop()
  console.log(`[amazon] DONE matched=${matched} no_match=${noMatch} captchaPauses=${captchaPauses}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
