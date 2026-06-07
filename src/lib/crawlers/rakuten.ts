import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'
import { searchRakuten } from '@/lib/platforms/rakuten'
import { proxyFetch, hasProxy } from './proxy-fetch'
import { cleanRakutenTitle } from '@/lib/platforms/rakuten'

const HEADERS = {
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function parsePoints(el: ReturnType<typeof parse> | null): number {
  if (!el) return 0
  const text = el.querySelector('strong')?.text ?? el.text
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function parsePrice(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function isFreeShipping(card: ReturnType<typeof parse>): boolean {
  return !!card.querySelector('.free-delivery, .shipping_free, [class*="freeShip"]')
}

function guessAffiliateUrl(itemUrl: string): string {
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID
  if (!affiliateId) return itemUrl
  return `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
}

function inferTaxRate(title: string): 1.08 | 1.1 {
  const foodKeywords = /粉ミルク|液体ミルク|ミルク.*缶|離乳食|ベビーフード|ハイハイン|おかゆ/
  return foodKeywords.test(title) ? 1.08 : 1.1
}

function buildResult(
  title: string,
  salePrice: number,
  pointsEarned: number,
  shippingCost: number,
  couponDiscount: number,
  imageUrl: string,
  itemUrl: string,
  shopName: string,
): ProductResult {
  const taxRate = inferTaxRate(title)
  // When pointsEarned=0 (JS-rendered, not available from static HTML),
  // estimate base points from the standard 1% rate so effectivePrice is not overstated.
  const basePoints = pointsEarned > 0
    ? pointsEarned
    : Math.floor(Math.floor(salePrice / taxRate) / 100)
  return {
    platform: 'rakuten',
    title,
    imageUrl,
    shopName,
    salePrice,
    shippingCost,
    couponDiscount,
    pointRate: 1,
    pointsEarned: basePoints,
    effectivePrice: salePrice + shippingCost - couponDiscount - basePoints,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    taxRate,
    affiliateUrl: guessAffiliateUrl(itemUrl),
  }
}

export async function crawlRakutenSearch(keyword: string): Promise<ProductResult[]> {
  // Without ScraperAPI, Vercel's IPs are blocked — skip the 5s crawl timeout
  // and go straight to the Rakuten Search API which always works.
  if (!hasProxy()) return searchRakuten(keyword).catch(() => [])

  const encoded = encodeURIComponent(keyword)
  try {
    const res = await proxyFetch(
      `https://search.rakuten.co.jp/search/mall/${encoded}/`,
      { headers: HEADERS },
    )
    if (!res.ok) return searchRakuten(keyword).catch(() => [])
    const html = await res.text()
    const root = parse(html)
    const results: ProductResult[] = []

    // Rakuten embeds stable JSON-LD ItemList on search pages (used by Google SEO)
    // This is more reliable than CSS class selectors which use hashed module names.
    // Points are JavaScript-rendered and not in initial HTML — set to 0 for pick-list.
    // Accurate points are fetched from the item page when user taps a card.
    for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.text) as Record<string, unknown>
        if (data['@type'] !== 'ItemList') continue
        const ldItems = (data['itemListElement'] as Array<Record<string, unknown>>) ?? []
        for (const listItem of ldItems.slice(0, 10)) {
          const product = listItem['item'] as Record<string, unknown>
          if (!product) continue
          const title = cleanRakutenTitle(product['name'] as string ?? '')
          const rawUrl = (product['url'] as string ?? '').split('?')[0]
          const offers = product['offers'] as Record<string, unknown> ?? {}
          const salePrice = offers['price'] ? parseInt(String(offers['price']), 10) : 0
          const imageArr = product['image']
          const imageUrl = Array.isArray(imageArr) ? String(imageArr[0] ?? '') : String(imageArr ?? '')
          if (!title || !rawUrl || !salePrice) continue
          const shopMatch = rawUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
          const shopName = shopMatch?.[1] ?? ''
          // points = 0 on pick-list (JS-rendered, not in initial HTML)
          const shippingCost = salePrice >= 3980 ? 0 : 490
          results.push(buildResult(title, salePrice, 0, shippingCost, 0, imageUrl, rawUrl, shopName))
        }
        break // only one ItemList block expected
      } catch { continue }
    }
    // Fall back to Rakuten Search API if crawl returned nothing
    // (e.g. server IP blocked, JSON-LD absent, or Rakuten changed page structure)
    if (results.length === 0) return searchRakuten(keyword).catch(() => [])
    return results
  } catch {
    return searchRakuten(keyword).catch(() => [])
  }
}

export async function crawlRakutenProduct(itemUrl: string): Promise<ProductResult | null> {
  try {
    const res = await proxyFetch(itemUrl, { headers: HEADERS })
    if (!res.ok) return null

    const buffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') ?? ''
    const charsetMatch = contentType.match(/charset=([^\s;]+)/i)
    const charset = charsetMatch?.[1] ?? 'utf-8'
    let html: string
    try {
      html = new TextDecoder(charset).decode(buffer)
    } catch {
      html = new TextDecoder('utf-8').decode(buffer)
    }
    const root = parse(html)

    const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    const title = cleanRakutenTitle(ogTitle.split('：')[0].split(':')[0].trim())
    if (!title) return null

    const priceAttr = root.querySelector('[itemprop="price"]')?.getAttribute('content')
    const salePrice = priceAttr ? parseInt(priceAttr, 10) : 0
    if (!salePrice) return null

    // Points are JavaScript-rendered — not in static HTML, set to 0.
    const shippingCost = salePrice >= 3980 ? 0 : 490
    const imageUrl = root.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''

    const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
    const shopName = shopMatch?.[1] ?? ''

    return buildResult(title, salePrice, 0, shippingCost, 0, imageUrl, itemUrl, shopName)
  } catch {
    return null
  }
}

/**
 * Re-crawls a Rakuten item page with JS rendering to extract live SuperDEAL
 * percentage and coupon discounts (unavailable in static HTML).
 * Uses render=true which costs ~10-15s — call after streaming basic results.
 */
export async function crawlRakutenProductLive(
  itemUrl: string,
  salePrice: number,
  taxRate: 1.08 | 1.1,
): Promise<{ pointRate: number; pointsEarned: number; couponDiscount: number } | null> {
  if (!hasProxy()) return null
  try {
    const res = await proxyFetch(itemUrl, {}, { render: true, timeoutMs: 40000 })
    if (!res.ok) return null
    const html = await res.text()

    // SuperDEAL: look for percentage near スーパーDEAL or ポイントバック keywords
    let superDealRate = 0
    const sdPatterns = [
      /スーパーDEAL[^<>]{0,80}?(\d+)%ポイントバック/,
      /(\d+)%ポイントバック[^<>]{0,80}?スーパーDEAL/,
      /sdeal[^>]*>[^<]*?(\d+)%/i,
      /super.?deal[^<>]{0,80}?(\d+)%/i,
      /ポイントバック[^<>]{0,20}?(\d+)%/,
    ]
    for (const re of sdPatterns) {
      const m = html.match(re)
      if (!m) continue
      const rate = parseInt(m[1], 10)
      if (rate >= 1 && rate <= 50) { superDealRate = rate; break }
    }

    // Coupon: look for yen amount near coupon/OFF text
    let couponDiscount = 0
    const cpPatterns = [
      /(\d[\d,]+)円OFF/,
      /(\d[\d,]+)円引き/,
      /クーポン[^<>]{0,30}(\d[\d,]+)円/,
    ]
    for (const re of cpPatterns) {
      const m = html.match(re)
      if (!m) continue
      const val = parseInt(m[1].replace(/,/g, ''), 10)
      if (val >= 100 && val <= 50000) { couponDiscount = val; break }
    }

    if (superDealRate === 0 && couponDiscount === 0) return null

    const effectiveRate = superDealRate || 1
    const pointsEarned = Math.floor(Math.floor(salePrice / taxRate) * effectiveRate / 100)
    return { pointRate: effectiveRate, pointsEarned, couponDiscount }
  } catch {
    return null
  }
}
