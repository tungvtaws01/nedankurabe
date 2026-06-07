import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenSearch, crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { crawlAmazonSearch, crawlAmazonProduct } from '@/lib/crawlers/amazon'
import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

export const preferredRegion = 'nrt1'

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
    // Normalize: add https:// if user pasted without protocol (e.g. amazon.co.jp/dp/...)
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
  const parsed = parseProductUrl(url)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(`lookup4:${url}`)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached && cached.length > 0) {
    return NextResponse.json({
      mode: 'comparison', rakutenResults: [], amazonResults: [],
      results: cached, query: url, cached: true,
    } satisfies SearchResponse)
  }

  let results: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    // Try crawling the Amazon product page first.
    // Falls back to slug-based title extraction when crawl is blocked (e.g. Vercel IPs).
    const amazonProduct = await crawlAmazonProduct(parsed.id).catch(() => null)
    const titleForSearch = amazonProduct?.title ?? extractTitleFromAmazonUrl(url)
    if (!titleForSearch) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const rakutenKeyword = amazonProduct
      ? await refineKeyword(amazonProduct.title, 'rakuten').catch(() => amazonProduct.title)
      : titleForSearch
    const rakutenCandidates = await crawlRakutenSearch(rakutenKeyword).catch(() => [] as ProductResult[])
    if (!amazonProduct && !rakutenCandidates.length) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const matchIdx = amazonProduct
      ? await semanticMatch(amazonProduct, rakutenCandidates).catch(() => null)
      : null
    const rakutenMatch = matchIdx !== null ? rakutenCandidates[matchIdx] ?? null : null
    results = [...(amazonProduct ? [amazonProduct] : []), ...(rakutenMatch ? [rakutenMatch] : [])].sort((a, b) => a.effectivePrice - b.effectivePrice)

  } else {
    const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
    if (!rakutenProduct) {
      return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
    }
    const amazonKeyword = await refineKeyword(rakutenProduct.title, 'amazon').catch(() => rakutenProduct.title)
    const amazonCandidates = await crawlAmazonSearch(amazonKeyword).catch(() => [] as ProductResult[])
    const matchIdx = await semanticMatch(rakutenProduct, amazonCandidates).catch(() => null)
    const amazonMatch = matchIdx !== null ? amazonCandidates[matchIdx] ?? null : null
    results = [rakutenProduct, ...(amazonMatch ? [amazonMatch] : [])].sort((a, b) => a.effectivePrice - b.effectivePrice)
  }

  if (results.length > 0) await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({
    mode: 'comparison', rakutenResults: [], amazonResults: [],
    results, query: url, cached: false,
  } satisfies SearchResponse)
}
