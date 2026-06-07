import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'

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
  return {
    platform: 'rakuten',
    title,
    imageUrl,
    shopName,
    salePrice,
    shippingCost,
    couponDiscount,
    pointRate: 1,
    pointsEarned,
    effectivePrice: salePrice + shippingCost - couponDiscount - pointsEarned,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    taxRate,
    affiliateUrl: guessAffiliateUrl(itemUrl),
  }
}

export async function crawlRakutenSearch(keyword: string): Promise<ProductResult[]> {
  const encoded = encodeURIComponent(keyword)
  try {
    const res = await fetch(
      `https://search.rakuten.co.jp/search/mall/${encoded}/`,
      { headers: HEADERS },
    )
    if (!res.ok) return []
    const html = await res.text()
    const root = parse(html)
    const cards = root.querySelectorAll('.searchresultitem')
    const results: ProductResult[] = []

    for (const card of cards.slice(0, 10)) {
      const anchor = card.querySelector('h2.title a, .item-name a, h2 a')
      const title = anchor?.text.trim() ?? ''
      const itemUrl = anchor?.getAttribute('href') ?? ''
      if (!title || !itemUrl) continue

      const priceText = card.querySelector('.important, [class*="price"]')?.text ?? '0'
      const salePrice = parsePrice(priceText)
      if (!salePrice) continue

      const pointsEarned = parsePoints(card.querySelector('.point, [class*="point"]'))
      const shippingCost = isFreeShipping(card) ? 0 : 490
      const imageUrl = card.querySelector('img')?.getAttribute('src') ?? ''

      const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
      const shopName = shopMatch?.[1] ?? ''

      results.push(buildResult(title, salePrice, pointsEarned, shippingCost, 0, imageUrl, itemUrl, shopName))
    }
    return results
  } catch {
    return []
  }
}

export async function crawlRakutenProduct(itemUrl: string): Promise<ProductResult | null> {
  try {
    const res = await fetch(itemUrl, { headers: HEADERS })
    if (!res.ok) return null
    const html = await res.text()
    const root = parse(html)

    const title = root.querySelector('h1[itemprop="name"], #item-title, .item_name')?.text.trim() ?? ''
    if (!title) return null

    const priceAttr = root.querySelector('[itemprop="price"]')?.getAttribute('content')
    const priceText = root.querySelector('[itemprop="price"], .price2, .important')?.text ?? '0'
    const salePrice = priceAttr ? parseInt(priceAttr, 10) : parsePrice(priceText)
    if (!salePrice) return null

    const pointsEarned = parsePoints(root.querySelector('#point, .item_point, [class*="point"]'))
    const shippingCost = root.querySelector('#free-deliver, .free-delivery, [class*="freeShip"]') ? 0 : 490
    const imageUrl = root.querySelector('#rakutenLogo ~ img, #imageMain img, #item_image img')?.getAttribute('src') ?? ''

    const shopMatch = itemUrl.match(/item\.rakuten\.co\.jp\/([^/]+)\//)
    const shopName = shopMatch?.[1] ?? ''

    return buildResult(title, salePrice, pointsEarned, shippingCost, 0, imageUrl, itemUrl, shopName)
  } catch {
    return null
  }
}
