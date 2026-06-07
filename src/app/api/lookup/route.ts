import { NextRequest, NextResponse } from 'next/server'
import { lookupAmazon, searchAmazon } from '@/lib/platforms/amazon'
import { lookupRakuten, searchRakuten } from '@/lib/platforms/rakuten'
import { findBestMatch } from '@/lib/matching/llm-match'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'
import { MOCK_RESULTS } from '@/lib/mock-data'

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

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    // Extract size indicators: Sサイズ, Mサイズ, LLサイズ, 乳首M (size letter attached to noun)
    const sizesWithWord = decoded.match(/[A-Z0-9]{1,3}サイズ/g) ?? []
    const sizesAttached = (decoded.match(/[ぁ-ゖァ-ー一-鿿]+[A-Z]{1,2}(?=-|$|\s)/g) ?? [])
      .map(m => m.replace(/[A-Z]+$/, s => s + 'サイズ')) // normalize: 乳首M → 乳首 Mサイズ
    const sizes = sizesWithWord.length ? sizesWithWord : sizesAttached.map(m => m.match(/[A-Z]+サイズ/)?.[0]).filter(Boolean) as string[]
    // Extract Japanese content words — hiragana/katakana/kanji, 2+ chars, skip bare サイズ
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? [])
      .filter(w => w.length >= 2 && w !== 'サイズ')
    // Combine: size first (most critical for correct matching), then product name
    const parts = [...sizes, ...jpWords].slice(0, 4)
    return parts.join(' ').trim() || null
  } catch { return null }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (process.env.STAGE === 'local') {
    const body = await req.json() as { url?: string }
    if (!body.url?.trim()) {
      return NextResponse.json({ error: 'url required' }, { status: 400 })
    }
    return NextResponse.json({
      results: MOCK_RESULTS,
      query: body.url.trim(),
      cached: false,
      mode: 'comparison',
    } satisfies SearchResponse)
  }

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
    return NextResponse.json({ results: cached, query: url, cached: true, mode: 'comparison' } satisfies SearchResponse)
  }

  let source: ProductResult | null = null
  let crossItems: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    source = await lookupAmazon(parsed.id).catch(() => null)
    if (source) {
      crossItems = await searchRakuten(source.title).catch(() => [])
    } else {
      // No Amazon API keys — extract title from URL slug and search Rakuten directly
      const title = extractTitleFromAmazonUrl(url)
      if (title) crossItems = await searchRakuten(title).catch(() => [])
    }
  } else {
    source = await lookupRakuten(parsed.id).catch(() => null)
    if (source) crossItems = await searchAmazon(source.title).catch(() => [])
  }

  if (!source && !crossItems.length) {
    return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
  }

  let results: ProductResult[]
  if (!source) {
    // Amazon lookup failed — return best Rakuten result from title search
    results = crossItems.slice(0, 1)
  } else {
    const crossMatch = crossItems.length
      ? await findBestMatch(source, crossItems).catch(() => crossItems[0] ?? null)
      : null
    results = [source, ...(crossMatch ? [crossMatch] : [])]
      .sort((a, b) => a.effectivePrice - b.effectivePrice)
  }

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query: url, cached: false, mode: 'comparison' } satisfies SearchResponse)
}
