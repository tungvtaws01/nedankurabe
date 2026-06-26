import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProductFast, crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findMatchByAsin } from '@/lib/harvest/repo'

function parseUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string; fullUrl: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1], fullUrl: normalized }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized, fullUrl: normalized }
    }
  } catch { /* invalid */ }
  return null
}

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? []).filter(w => w.length >= 2)
    return jpWords.slice(0, 4).join(' ').trim() || null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url?: string }
  if (!url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const resolved = await resolveAmazonShortLink(url.trim())
  const parsed = parseUrl(resolved)
  if (!parsed) return NextResponse.json({ error: 'invalid url' }, { status: 400 })

  if (parsed.platform === 'rakuten') {
    const product =
      await crawlRakutenProductFast(parsed.id).catch(() => null) ??
      await crawlRakutenProduct(parsed.id).catch(() => null)
    if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({
      platform: 'rakuten', title: product.title, salePrice: product.salePrice,
      imageUrl: product.imageUrl, shopName: product.shopName,
    })
  }

  // Amazon — DB only, no scraping, no price. Title/image from the matched product
  // (Rakuten-sourced) or a best-effort title from the URL slug.
  const match = await findMatchByAsin(parsed.id).catch(() => null)
  return NextResponse.json({
    platform: 'amazon',
    title: match?.productTitle ?? extractTitleFromAmazonUrl(resolved) ?? '',
    salePrice: null,
    imageUrl: match?.productImageUrl ?? '',
    shopName: 'Amazon.co.jp',
    priceUnavailable: true,
  })
}
