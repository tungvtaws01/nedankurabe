import { ProductResult } from '@/lib/types'
import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { rankBySimilarity } from './rank'

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
  const targeted = await searchTargeted(source, targetPlatform)
  // Targeted (relevance-ranked) results first, prior pool as supplement.
  const pool = dedupe([...targeted, ...priorPool])
  if (!pool.length) return null
  // Pre-rank so the most promising candidates survive semanticMatch's window.
  const ranked = rankBySimilarity(source, pool)
  const idx = await semanticMatch(source, ranked).catch(() => null)
  return idx !== null ? ranked[idx] ?? null : null
}

// Refine the source title into a search keyword for the target platform, then
// run that platform's search. Cached by refined keyword so repeated taps within
// a product family don't re-crawl (Amazon crawls are proxied and expensive).
async function searchTargeted(
  source: ProductResult,
  targetPlatform: 'amazon' | 'rakuten',
): Promise<ProductResult[]> {
  const keyword = await refineKeyword(source.title, targetPlatform).catch(() => source.title)
  const cacheKey = makeCacheKey(`findeq:${targetPlatform}:${keyword}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) return cached
  const results = targetPlatform === 'amazon'
    ? await crawlAmazonSearch(keyword).catch(() => [] as ProductResult[])
    : await crawlRakutenSearch(keyword).catch(() => [] as ProductResult[])
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
