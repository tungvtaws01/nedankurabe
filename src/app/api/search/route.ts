import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { refineKeyword } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

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
  const cacheKey = makeCacheKey(`kw2:${query}`)

  const cached = await getCached<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }>(cacheKey).catch(() => null)
  if (cached && cached.rakutenResults.length > 0) {
    return NextResponse.json({
      mode: 'keyword-list', ...cached, results: [], query, cached: true,
    } satisfies SearchResponse)
  }

  // Crawl both platforms in parallel
  const [rakutenResults, amazonKeyword] = await Promise.all([
    crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
    refineKeyword(query, 'amazon').catch(() => query),
  ])
  const amazonResults = await crawlAmazonSearch(amazonKeyword).catch(() => [] as ProductResult[])

  if (rakutenResults.length > 0) {
    await setCached(cacheKey, { rakutenResults, amazonResults }).catch(() => {})
  }

  return NextResponse.json({
    mode: 'keyword-list',
    rakutenResults,
    amazonResults,
    results: [],
    query,
    cached: false,
  } satisfies SearchResponse)
}
