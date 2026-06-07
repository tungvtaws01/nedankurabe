import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'
import { calcAmazonEffectivePrice } from '@/lib/price/normalize'

const HEADERS = {
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

function parsePrice(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10)
  return isNaN(n) ? 0 : n
}

function parsePoints(text: string): number {
  const m = text.match(/(\d[\d,]*)\s*pt/i)
  if (!m) return 0
  return parseInt(m[1].replace(/,/g, ''), 10)
}

function buildAmazonUrl(asin: string): string {
  const tag = process.env.AMAZON_PARTNER_TAG
  return tag
    ? `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`
    : `https://www.amazon.co.jp/dp/${asin}`
}

function buildResult(
  title: string,
  salePrice: number,
  pointsEarned: number,
  asin: string,
  imageUrl: string,
): ProductResult {
  return {
    platform: 'amazon',
    title,
    imageUrl,
    shopName: 'Amazon.co.jp',
    salePrice,
    shippingCost: 0,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned,
    effectivePrice: calcAmazonEffectivePrice(salePrice, 0, false, false),
    subscribeAvailable: false,
    rakutenCardEligible: false,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: buildAmazonUrl(asin),
  }
}

export async function crawlAmazonSearch(keyword: string): Promise<ProductResult[]> {
  const encoded = encodeURIComponent(keyword)
  try {
    const res = await fetch(
      `https://www.amazon.co.jp/s?k=${encoded}&i=baby`,
      { headers: HEADERS },
    )
    if (!res.ok) return []
    const html = await res.text()
    const root = parse(html)
    const cards = root.querySelectorAll('[data-asin][data-component-type="s-search-result"]')
    const results: ProductResult[] = []

    for (const card of cards.slice(0, 5)) {
      const asin = card.getAttribute('data-asin') ?? ''
      if (!asin) continue

      const title = card.querySelector('h2 a span, h2 span')?.text.trim() ?? ''
      if (!title) continue

      const priceText = card.querySelector('.a-price-whole')?.text ?? '0'
      const salePrice = parsePrice(priceText)
      if (!salePrice) continue

      const pointText = card.querySelectorAll('.a-size-base.a-color-price')
        .map(el => el.text).join(' ')
      const pointsEarned = parsePoints(pointText)
      const imageUrl = card.querySelector('img.s-image')?.getAttribute('src') ?? ''

      results.push(buildResult(title, salePrice, pointsEarned, asin, imageUrl))
    }
    return results
  } catch {
    return []
  }
}

export async function crawlAmazonProduct(asin: string): Promise<ProductResult | null> {
  try {
    const res = await fetch(
      `https://www.amazon.co.jp/dp/${asin}`,
      { headers: HEADERS },
    )
    if (!res.ok) return null
    const html = await res.text()
    const root = parse(html)

    const title = root.querySelector('#productTitle, #title')?.text.trim() ?? ''
    if (!title) return null

    const priceText = root.querySelector('.a-price-whole, #priceblock_ourprice')?.text ?? '0'
    const salePrice = parsePrice(priceText)
    if (!salePrice) return null

    const pointText = root.querySelectorAll('.a-size-base.a-color-price')
      .map(el => el.text).join(' ')
    const pointsEarned = parsePoints(pointText)
    const imageUrl = root.querySelector('#landingImage, #imgBlkFront')?.getAttribute('src') ?? ''

    return buildResult(title, salePrice, pointsEarned, asin, imageUrl)
  } catch {
    return null
  }
}
