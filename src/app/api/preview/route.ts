import { NextRequest, NextResponse } from 'next/server'
import { crawlRakutenProductFast } from '@/lib/crawlers/rakuten'
import { crawlAmazonProduct, resolveAmazonShortLink } from '@/lib/crawlers/amazon'

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

export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url?: string }
  if (!url?.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })

  // Amazon mobile-share links (amzn.asia/…) carry no ASIN; resolve to the
  // canonical /dp/<ASIN> URL before parsing.
  const resolved = await resolveAmazonShortLink(url.trim())
  const parsed = parseUrl(resolved)
  if (!parsed) return NextResponse.json({ error: 'invalid url' }, { status: 400 })

  if (parsed.platform === 'rakuten') {
    const product = await crawlRakutenProductFast(parsed.id).catch(() => null)
    if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json({
      platform: 'rakuten',
      title: product.title,
      salePrice: product.salePrice,
      imageUrl: product.imageUrl,
      shopName: product.shopName,
    })
  }

  // Amazon — use ScraperAPI for accurate JP price
  const product = await crawlAmazonProduct(parsed.id, parsed.fullUrl).catch(() => null)
  if (!product) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({
    platform: 'amazon',
    title: product.title,
    salePrice: product.salePrice,
    imageUrl: product.imageUrl,
    shopName: 'Amazon.co.jp',
  })
}
