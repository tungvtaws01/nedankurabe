import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { ProductResult } from '@/lib/types'
// Called when user taps a Rakuten card from the keyword pick-list.
// 1. Crawls the Rakuten item page to get real live points (JS-rendered via ScraperAPI)
// 2. Runs a fresh targeted Amazon search for this specific product, then LLM match
// Both run in parallel — the match uses the source title (unchanged by enrichment),
// so we don't stack the two slow operations.
// Returns { source: enrichedRakuten, result: amazonMatch | null }
export async function POST(req: NextRequest): Promise<NextResponse<{
  source: ProductResult
  result: ProductResult | null
}>> {
  const body = await req.json() as {
    source?: ProductResult
    candidates?: ProductResult[]
  }
  if (!body.source) {
    return NextResponse.json({ source: null as unknown as ProductResult, result: null }, { status: 400 })
  }

  const { source, candidates } = body

  // Enrich Rakuten item with live points from the item page
  const itemUrl = source.affiliateUrl.includes('hb.afl.rakuten')
    ? decodeURIComponent(source.affiliateUrl.split('pc=')[1]?.split('&')[0] ?? '') || source.affiliateUrl
    : source.affiliateUrl

  const [enriched, result] = await Promise.all([
    crawlRakutenProduct(itemUrl).catch(() => null),
    findEquivalent(source, 'amazon', candidates ?? []).catch(() => null),
  ])

  return NextResponse.json({ source: enriched ?? source, result })
}
