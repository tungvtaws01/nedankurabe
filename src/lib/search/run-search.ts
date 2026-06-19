import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { searchAmazonFromDb } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { ProductResult } from '@/lib/types'

// Amazon pick-list results come from the matching DB (link-only: Rakuten image + tagged ASIN
// link, no price, no scraping).
export async function amazonFromDb(query: string): Promise<ProductResult[]> {
  const sibs = await searchAmazonFromDb(query).catch(() => [])
  return sibs.map((s) => buildAmazonLinkResult({ asin: s.asin, title: s.productTitle, imageUrl: s.productImageUrl }))
}

// Baby-only scope is enforced by the Rakuten genre filter inside searchRakutenKeyword (results
// not in BABY_GENRE_IDS are dropped), so we no longer pre-judge the raw keyword: we always
// search and let the genre filter decide. Off-topic queries come back empty → UI shows the
// baby-only empty state. Rakuten (live API) + Amazon (DB, link-only) run in parallel.
export async function runBabySearch(query: string): Promise<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }> {
  const [rakutenResults, amazonResults] = await Promise.all([
    crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
    amazonFromDb(query),
  ])
  return { rakutenResults, amazonResults }
}
