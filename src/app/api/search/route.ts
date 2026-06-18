import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { searchAmazonFromDb } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

// Amazon pick-list results come from the matching DB (link-only: Rakuten image +
// tagged ASIN link, no price, no scraping).
async function amazonFromDb(query: string): Promise<ProductResult[]> {
  const sibs = await searchAmazonFromDb(query).catch(() => [])
  return sibs.map((s) => buildAmazonLinkResult({ asin: s.asin, title: s.productTitle, imageUrl: s.productImageUrl }))
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { query?: string }
    if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
    return NextResponse.json({
      mode: 'keyword-list',
      rakutenResults: MOCK_RESULTS.filter(r => r.platform === 'rakuten'),
      amazonResults: MOCK_RESULTS.filter(r => r.platform === 'amazon'),
      results: [],
      query: body.query.trim(),
      cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
  const query = body.query.trim()
  // kw6: prefix — busts kw5 entries created with the all-genres Rakuten fallback.
  const cacheKey = makeCacheKey(`kw6:${query}`)

  const cached = await getCached<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }>(cacheKey).catch(() => null)
  if (cached && cached.rakutenResults.length > 0) {
    return NextResponse.json({
      mode: 'keyword-list', rakutenResults: cached.rakutenResults, amazonResults: cached.amazonResults ?? [],
      results: [], query, cached: true,
    } satisfies SearchResponse)
  }

  // Rakuten (live API) + Amazon (DB, link-only) in parallel. Amazon is never scraped.
  const [rakutenResults, amazonResults] = await Promise.all([
    crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
    amazonFromDb(query),
  ])
  if (rakutenResults.length > 0) {
    await setCached(cacheKey, { rakutenResults, amazonResults }).catch(() => {})
  }

  return NextResponse.json({
    mode: 'keyword-list', rakutenResults, amazonResults, results: [], query, cached: false,
  } satisfies SearchResponse)
}
