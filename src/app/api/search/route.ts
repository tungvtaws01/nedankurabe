import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
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
      amazonResults: [],
      results: [],
      query: body.query.trim(),
      cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 })
  const query = body.query.trim()
  // kw4: prefix — busts kw3 entries that contained scraped Amazon results.
  const cacheKey = makeCacheKey(`kw4:${query}`)

  const cached = await getCached<{ rakutenResults: ProductResult[] }>(cacheKey).catch(() => null)
  if (cached && cached.rakutenResults.length > 0) {
    return NextResponse.json({
      mode: 'keyword-list', rakutenResults: cached.rakutenResults, amazonResults: [],
      results: [], query, cached: true,
    } satisfies SearchResponse)
  }

  // Rakuten only. Amazon is not searched/scraped; it appears only as the matched
  // link-only sibling once the user opens a comparison.
  const rakutenResults = await crawlRakutenSearch(query).catch(() => [] as ProductResult[])
  if (rakutenResults.length > 0) {
    await setCached(cacheKey, { rakutenResults }).catch(() => {})
  }

  return NextResponse.json({
    mode: 'keyword-list', rakutenResults, amazonResults: [], results: [], query, cached: false,
  } satisfies SearchResponse)
}
