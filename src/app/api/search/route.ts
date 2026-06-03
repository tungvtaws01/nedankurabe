import { NextRequest, NextResponse } from 'next/server'
import { searchAmazon } from '@/lib/platforms/amazon'
import { searchRakuten } from '@/lib/platforms/rakuten'
import { findBestMatch } from '@/lib/matching/llm-match'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { SearchResponse } from '@/lib/types'
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
    } satisfies SearchResponse)
  }
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(query)

  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query, cached: true } satisfies SearchResponse)
  }

  const [amazonItems, rakutenItems] = await Promise.all([
    searchAmazon(query).catch(() => [] as ProductResult[]),
    searchRakuten(query).catch(() => [] as ProductResult[]),
  ])

  const amazonBest = amazonItems[0] ?? null
  const rakutenBest = rakutenItems[0] ?? null
  let results: ProductResult[] = []

  if (amazonBest && rakutenItems.length) {
    const matched = await findBestMatch(amazonBest, rakutenItems).catch(() => rakutenBest)
    results = [amazonBest, matched ?? rakutenBest].sort((a, b) => a.effectivePrice - b.effectivePrice)
  } else if (amazonBest) {
    results = [amazonBest]
  } else if (rakutenBest) {
    results = [rakutenBest]
  }

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query, cached: false } satisfies SearchResponse)
}
