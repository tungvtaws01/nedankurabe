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

// Extracts actual shipping cost from Rakuten page HTML or live-rendered HTML.
// Tries explicit 送料NNN円 patterns first; falls back to ¥700 estimate.
function parseShippingFromHtml(html: string, salePrice: number): number {
  if (/送料無料/.test(html)) return 0
  if (salePrice >= 3980) return 0
  const m = html.match(/送料[:：\s]*(\d[\d,]+)円/)
  if (m) {
    const val = parseInt(m[1].replace(/,/g, ''), 10)
    if (val >= 100 && val <= 3000) return val
  }
  return 700 // conservative estimate; corrected by live crawl when available
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

// Always use Rakuten Search API directly — fast (~1-2s), no ScraperAPI overhead.
// The previous ScraperAPI search-page crawl was slow (~10-15s) and unreliable.
export async function crawlRakutenSearch(keyword: string): Promise<ProductResult[]> {
  return searchRakuten(keyword).catch(() => [])
}

/**
 * Fast Rakuten product lookup via API (~1-2s) for URL paste placeholder.
 * Extracts item code from the URL and searches Rakuten API with it.
 * The item code is often a JAN barcode which uniquely identifies the product.
 * Falls back to ScraperAPI page crawl if API returns nothing.
 */
export async function crawlRakutenProductFast(itemUrl: string): Promise<ProductResult | null> {
  const m = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\/([^/?]+)/)
  if (!m) return null
  const [, shopName, itemCode] = m

  try {
    const results = await searchRakuten(itemCode)
    if (!results.length) return null
    // Prefer result from the same shop; fall back to first result
    return results.find(r => r.affiliateUrl.includes(shopName)) ?? results[0]
  } catch {
    return null
  }
}

function parseRakutenItemHtml(html: string, itemUrl: string): ProductResult | null {
  const root = parse(html)
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
  const title = cleanRakutenTitle(ogTitle.split('：')[0].split(':')[0].trim())
  if (!title) return null
  const priceAttr = root.querySelector('[itemprop="price"]')?.getAttribute('content')
  const salePrice = priceAttr ? parseInt(priceAttr, 10) : 0
  if (!salePrice) return null
  const shippingCost = parseShippingFromHtml(html, salePrice)
  const imageUrl = root.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? ''
  const rawDesc = root.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? ''
  const description = rawDesc.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined
  const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
  const shopName = shopMatch?.[1] ?? ''
  return { ...buildResult(title, salePrice, 0, shippingCost, 0, imageUrl, itemUrl, shopName), description }
}

async function fetchAndDecode(res: Response): Promise<string> {
  const buffer = await res.arrayBuffer()
  const charset = res.headers.get('content-type')?.match(/charset=([^\s;]+)/i)?.[1] ?? 'utf-8'
  try { return new TextDecoder(charset).decode(buffer) }
  catch { return new TextDecoder('utf-8').decode(buffer) }
}

export async function crawlRakutenProduct(itemUrl: string): Promise<ProductResult | null> {
  // Race direct fetch (fast when unblocked) against ScraperAPI (reliable fallback).
  // Promise.any returns whichever resolves first; only fails if both reject.
  const attempt = async (res: Response): Promise<ProductResult> => {
    if (!res.ok) throw new Error('bad status')
    const html = await fetchAndDecode(res)
    const result = parseRakutenItemHtml(html, itemUrl)
    if (!result) throw new Error('parse failed')
    return result
  }
  try {
    return await Promise.any([
      // Direct: fast if Rakuten doesn't block this IP (~2-5s on Vercel JP edge)
      fetch(itemUrl, { headers: HEADERS, signal: AbortSignal.timeout(12000) }).then(attempt),
      // ScraperAPI: reliable but slower (~8-14s)
      proxyFetch(itemUrl, { headers: HEADERS }).then(attempt),
    ])
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
): Promise<{ pointRate: number; pointsEarned: number; couponDiscount: number; shippingCost: number | null } | null> {
  if (!hasProxy()) return null
  try {
    // scrape.do with super=true (residential proxies) occasionally gets ROTATION_FAILED on Rakuten.
    // Retry up to 3 times — scrape.do does not charge for failed requests.
    let html = ''
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await proxyFetch(itemUrl, {}, { render: true, timeoutMs: 40000 })
      if (!res.ok) break
      const text = await res.text()
      // scrape.do returns a JSON error body ({"ErrorCode":90,...}) with HTTP 200 on rotation failure.
      // A real HTML page never starts with '{'.
      if (!text.trimStart().startsWith('{')) { html = text; break }
    }
    if (!html) return null

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

    // Extract actual shipping cost from the rendered page
    const shippingCost = parseShippingFromHtml(html, salePrice)

    if (superDealRate === 0 && couponDiscount === 0 && shippingCost === 700) return null

    const effectiveRate = superDealRate || 1
    const pointsEarned = Math.floor(Math.floor(salePrice / taxRate) * effectiveRate / 100)
    return { pointRate: effectiveRate, pointsEarned, couponDiscount, shippingCost }
  } catch {
    return null
  }
}
