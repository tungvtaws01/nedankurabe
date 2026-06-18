import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { findMatchByAsin } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
import { byEffectivePrice } from '@/lib/price/normalize'
import { MOCK_RESULTS } from '@/lib/mock-data'

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const sizesWithWord = decoded.match(/[A-Z0-9]{1,3}サイズ/g) ?? []
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? [])
      .filter(w => w.length >= 2 && w !== 'サイズ')
    const parts = [...sizesWithWord, ...jpWords].slice(0, 4)
    return parts.join(' ').trim() || null
  } catch { return null }
}

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized }
    }
  } catch { /* invalid URL */ }
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { url?: string }
    if (!body.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [],
      results: MOCK_RESULTS, query: body.url.trim(), cached: false,
    } satisfies SearchResponse)
  }

  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const url = body.url.trim()
  const resolvedUrl = await resolveAmazonShortLink(url)
  const parsed = parseProductUrl(resolvedUrl)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(`lookup6:${url}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached && cached.length > 0) {
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [], results: cached, query: url, cached: true,
    } satisfies SearchResponse)
  }

  let results: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    // DB-only: build a link-only Amazon card; if matched, add the priced Rakuten sibling.
    const match = await findMatchByAsin(parsed.id).catch(() => null)
    const title = match?.productTitle ?? extractTitleFromAmazonUrl(resolvedUrl) ?? ''
    if (!title && !match) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonCard = buildAmazonLinkResult({ asin: parsed.id, title, imageUrl: match?.productImageUrl ?? '' })
    const rakuten = match?.rakutenItemCode ? await lookupRakuten(match.rakutenItemCode).catch(() => null) : null
    results = [amazonCard, ...(rakuten ? [rakuten] : [])].sort(byEffectivePrice)
  } else {
    const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
    if (!rakutenProduct) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonMatch = await findEquivalent(rakutenProduct, 'amazon').catch(() => null)
    results = [rakutenProduct, ...(amazonMatch ? [amazonMatch] : [])].sort(byEffectivePrice)
  }

  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})

  // Price-difference explanation only when BOTH sides have a real price (never for a
  // link-only Amazon card). During the gap this is effectively cross-platform-off.
  let explanation: string | undefined
  if (results.length === 2 && isComparablePair(results[0], results[1])) {
    const { winner, loser } = pickWinnerLoser(results[0], results[1])
    explanation = (await explainPriceDifference(winner, loser).catch(() => null)) ?? undefined
  }
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [], results, query: url, cached: false, explanation,
  } satisfies SearchResponse)
}
