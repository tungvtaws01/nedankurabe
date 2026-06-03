import { NextRequest, NextResponse } from 'next/server'
import { lookupAmazon, searchAmazon } from '@/lib/platforms/amazon'
import { lookupRakuten, searchRakuten } from '@/lib/platforms/rakuten'
import { findBestMatch } from '@/lib/matching/llm-match'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/)
      if (m) return { platform: 'rakuten', id: `${m[1]}:${m[2]}` }
    }
  } catch { /* invalid URL */ }
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) {
    return NextResponse.json({ error: 'url required' }, { status: 400 })
  }
  const url = body.url.trim()
  const parsed = parseProductUrl(url)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(url)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query: url, cached: true } satisfies SearchResponse)
  }

  let source: ProductResult | null = null
  let crossItems: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    source = await lookupAmazon(parsed.id).catch(() => null)
    if (source) crossItems = await searchRakuten(source.title).catch(() => [])
  } else {
    source = await lookupRakuten(parsed.id).catch(() => null)
    if (source) crossItems = await searchAmazon(source.title).catch(() => [])
  }

  if (!source) {
    return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
  }

  const crossMatch = crossItems.length
    ? await findBestMatch(source, crossItems).catch(() => crossItems[0] ?? null)
    : null

  const results = [source, ...(crossMatch ? [crossMatch] : [])]
    .sort((a, b) => a.effectivePrice - b.effectivePrice)

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query: url, cached: false } satisfies SearchResponse)
}
