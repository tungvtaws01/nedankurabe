import { ProductResult } from '@/lib/types'
import { refineKeyword, semanticMatch, classifyCategory } from '@/lib/llm/openrouter'
import { type Category } from '@/lib/llm/category-prompts'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { rankBySimilarity } from './rank'
import { findListingByPlatformId, findSiblingListings, upsertProduct, upsertListing, findAmazonSiblingByRakuten } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'

// Find the cross-platform equivalent of `source` on `targetPlatform`.
//
// Unlike the previous behavior — which only matched against whatever the broad
// keyword search happened to surface — this runs a FRESH targeted search for
// the specific source product, so a tapped variant (e.g. a particular pack
// size) is searched for directly instead of relying on luck. The pool the user
// was already browsing is merged in as a free supplement (`priorPool`) so the
// result can never be worse than the old broad-pool-only behavior.
export async function findEquivalent(
  source: ProductResult,
  targetPlatform: 'amazon' | 'rakuten',
  priorPool: ProductResult[] = [],
): Promise<ProductResult | null> {
  // Amazon target is link-only and DB-sourced: no LLM, no scraping. We find the
  // matched ASIN for this Rakuten source and return a link-only result (Rakuten
  // image + tagged Amazon link). No DB match → no Amazon card.
  if (targetPlatform === 'amazon') {
    if (source.platform !== 'rakuten') return null
    const rktCode = sourcePlatformId(source)
    if (!rktCode) return null
    const sib = await findAmazonSiblingByRakuten(rktCode).catch(() => null)
    if (!sib) return null
    return buildAmazonLinkResult({ asin: sib.asin, title: sib.productTitle, imageUrl: sib.productImageUrl })
  }

  // --- Fast path: matching-table lookup by source platform_id ---
  // If we've already confirmed a match for this source product, return the
  // sibling listing directly without an LLM call. DB failures fall through.
  const srcId = sourcePlatformId(source)
  if (srcId) {
    const row = await findListingByPlatformId(srcId).catch(() => null)
    if (row) {
      const siblings = await findSiblingListings(row.product_id, targetPlatform).catch(() => [])
      for (const sib of siblings) {
        const hydrated = await hydrateListing(sib.platform_id, targetPlatform).catch(() => null)
        if (hydrated) return hydrated
      }
    }
  }

  // --- LLM flow (existing behavior) ---
  // Classify once and thread into both refineKeyword and semanticMatch so per-genre
  // routing is consistent without adding an extra LLM call.
  const category = await classifyCategory(source.title).catch(() => 'unknown' as const)
  const catOpt = category === 'unknown' ? undefined : category
  const targeted = await searchTargeted(source, targetPlatform, category)
  // Targeted (relevance-ranked) results first, prior pool as supplement.
  const pool = dedupe([...targeted, ...priorPool])
  if (!pool.length) return null
  // Pre-rank so the most promising candidates survive semanticMatch's window.
  const ranked = rankBySimilarity(source, pool)
  const idx = await semanticMatch(source, ranked, { category: catOpt }).catch(() => null)
  const matchResult = idx !== null ? ranked[idx] ?? null : null

  // --- Write back a confirmed LLM match into the table ---
  // Best-effort: a DB write failure must never break the user-facing lookup.
  if (matchResult && srcId) {
    await writeBack(source, srcId, matchResult).catch(() => {})
  }
  return matchResult
}

// Refine the source title into a search keyword for the target platform, then
// run that platform's search. Cached by refined keyword so repeated taps within
// a product family don't re-crawl (Amazon crawls are proxied and expensive).
async function searchTargeted(
  source: ProductResult,
  targetPlatform: 'amazon' | 'rakuten',
  category?: Category | 'unknown',
): Promise<ProductResult[]> {
  const keyword = await refineKeyword(source.title, targetPlatform, category).catch(() => source.title)
  const cacheKey = makeCacheKey(`findeq:${targetPlatform}:${keyword}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) return cached
  const results = await crawlRakutenSearch(keyword).catch(() => [] as ProductResult[])
  if (results.length) await setCached(cacheKey, results).catch(() => {})
  return results
}

// Drop duplicates that appear in both the targeted results and the prior pool.
// Keyed by affiliate URL, falling back to title when a URL is missing.
function dedupe(items: ProductResult[]): ProductResult[] {
  const seen = new Set<string>()
  const out: ProductResult[] = []
  for (const it of items) {
    const key = it.affiliateUrl || it.title
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

// Extract the platform-native id used as the listings table key. Amazon uses
// the 10-char ASIN from the /dp/ path; Rakuten uses "shop:itemId" parsed from
// the (URL-encoded) item URL wrapped inside the affiliate link.
function sourcePlatformId(p: ProductResult): string | null {
  if (p.platform === 'amazon') return p.affiliateUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null
  // Rakuten affiliate URLs wrap the item URL; itemCode is "shop:itemId"
  const m = decodeURIComponent(p.affiliateUrl).match(/item\.rakuten\.co\.jp\/([^/]+)\/([^/?]+)/)
  return m ? `${m[1]}:${m[2]}` : null
}

// Re-fetch a Rakuten listing's full ProductResult by its platform id. (Amazon
// equivalents are built link-only from the DB above; this is Rakuten-only now.)
async function hydrateListing(platformId: string, platform: 'amazon' | 'rakuten'): Promise<ProductResult | null> {
  if (platform !== 'rakuten') return null
  return lookupRakuten(platformId)
}

// Persist a confirmed LLM match so subsequent lookups hit the fast path.
function writeBack(source: ProductResult, srcId: string, match: ProductResult): Promise<void> {
  return (async () => {
    const productId = await upsertProduct({
      jan: null, title: source.title, brand: null, category: 'baby', imageUrl: source.imageUrl,
    })
    const matchId = sourcePlatformId(match)
    await upsertListing({ productId, platform: source.platform, platformId: srcId, title: source.title,
      packCount: 1, matchSource: 'llm', confidence: 0.8 })
    if (matchId) {
      await upsertListing({ productId, platform: match.platform, platformId: matchId, title: match.title,
        packCount: 1, matchSource: 'llm', confidence: 0.8 })
    }
  })()
}
