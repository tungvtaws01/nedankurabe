import { NextRequest, NextResponse } from 'next/server'
import { searchRakuten } from '@/lib/platforms/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { query?: string }
    if (!body.query?.trim()) {
      return NextResponse.json({ error: 'query required' }, { status: 400 })
    }
    return NextResponse.json({
      results: MOCK_RESULTS,
      query: body.query.trim(),
      cached: false,
      mode: 'keyword-list',
    } satisfies SearchResponse)
  }

  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw:${query}`)

  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query, cached: true, mode: 'keyword-list' } satisfies SearchResponse)
  }

  const results = await searchRakuten(query).catch(() => [] as ProductResult[])

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query, cached: false, mode: 'keyword-list' } satisfies SearchResponse)
}
