import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { semanticMatch } from '@/lib/llm/openrouter'
import { ProductResult } from '@/lib/types'

export const preferredRegion = 'nrt1'

// Called when user taps a Rakuten card from the keyword pick-list.
// 1. Crawls the Rakuten item page to get real live points (JS-rendered via ScraperAPI)
// 2. Runs LLM semantic match against the Amazon candidate pool
// Returns { source: enrichedRakuten, result: amazonMatch | null }
export async function POST(req: NextRequest): Promise<NextResponse<{
  source: ProductResult
  result: ProductResult | null
}>> {
  const body = await req.json() as {
    source?: ProductResult
    candidates?: ProductResult[]
  }
  if (!body.source || !body.candidates) {
    return NextResponse.json({ source: body.source as ProductResult, result: null }, { status: 400 })
  }

  const { source, candidates } = body

  // Enrich Rakuten item with live points from the item page
  const itemUrl = source.affiliateUrl.includes('hb.afl.rakuten')
    ? decodeURIComponent(source.affiliateUrl.split('pc=')[1]?.split('&')[0] ?? '') || source.affiliateUrl
    : source.affiliateUrl

  const enriched = await crawlRakutenProduct(itemUrl).catch(() => null)
  const enrichedSource = enriched ?? source

  // LLM semantic match against Amazon candidates
  const idx = candidates.length
    ? await semanticMatch(enrichedSource, candidates).catch(() => null)
    : null
  const result = idx !== null ? candidates[idx] ?? null : null

  return NextResponse.json({ source: enrichedSource, result })
}
