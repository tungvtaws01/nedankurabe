import { parse } from 'node-html-parser'
import { ProductResult } from '@/lib/types'
import { calcAmazonEffectivePrice } from '@/lib/price/normalize'
import { proxyFetch } from './proxy-fetch'

const HEADERS = {
  'Accept-Language': 'ja-JP,ja;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

// Amazon's mobile "share" button produces shortened links (amzn.asia/d/XXXX,
// amzn.to/XXXX, a.co/d/XXXX) that contain NO ASIN — they 301-redirect to the
// canonical /dp/<ASIN> URL. The app's URL parser only recognizes amazon.co.jp,
// so these must be resolved to the canonical URL before parsing.
const AMAZON_SHORT_HOSTS = ['amzn.asia', 'amzn.to', 'amzn.eu', 'amzn.com', 'a.co']

export function isAmazonShortLink(url: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
    return AMAZON_SHORT_HOSTS.includes(u.hostname.replace(/^www\./, ''))
  } catch {
    return false
  }
}

/**
 * Resolves an Amazon mobile-share short link to its canonical /dp/<ASIN> URL.
 * Non-short URLs (and unparseable input) are returned unchanged. On any network
 * failure the original URL is returned, so the caller degrades to its normal
 * "invalid URL" handling rather than breaking.
 */
export async function resolveAmazonShortLink(url: string): Promise<string> {
  if (!isAmazonShortLink(url)) return url
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
  try {
    // The short-link host issues a 301 to the canonical URL. redirect:'manual'
    // lets us read the Location header without loading the heavy, bot-protected
    // product page.
    const res = await fetch(target, {
      redirect: 'manual',
      headers: HEADERS,
      signal: AbortSignal.timeout(8000),
    })
    const location = res.headers.get('location')
    if (location) return location
    // Some environments transparently follow the redirect; fall back to the
    // final resolved URL.
    const followed = await fetch(target, {
      redirect: 'follow',
      headers: HEADERS,
      signal: AbortSignal.timeout(10000),
    })
    return followed.url || url
  } catch {
    return url
  }
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
  if (!tag) {
    console.warn('[amazon] AMAZON_PARTNER_TAG is not set — affiliate links will be untagged')
  }
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

export function parseAmazonSearchHtml(html: string): ProductResult[] {
  const root = parse(html)
  const cards = root.querySelectorAll('[data-asin][data-component-type="s-search-result"]')
  const results: ProductResult[] = []

  for (const card of cards.slice(0, 10)) {
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

    // Extract short feature/subtitle text visible on the search card
    const descText = card.querySelectorAll('.a-size-base-plus, .a-size-base.a-color-secondary')
      .map(el => el.text.trim()).filter(t => t.length > 3 && t.length < 120).join(' ')
    const description = descText.slice(0, 200) || undefined

    results.push({ ...buildResult(title, salePrice, pointsEarned, asin, imageUrl), description })
  }
  return results
}

export async function crawlAmazonSearch(keyword: string): Promise<ProductResult[]> {
  const encoded = encodeURIComponent(keyword)
  try {
    const res = await proxyFetch(
      `https://www.amazon.co.jp/s?k=${encoded}&i=baby`,
      { headers: HEADERS },
    )
    if (!res.ok) return []
    const html = await res.text()
    return parseAmazonSearchHtml(html)
  } catch {
    return []
  }
}

// Extract the yen price-to-pay from an Amazon product page. The naive
// `.a-price-whole` first-match is wrong on some layout variants: Amazon renders a
// per-unit price ("¥35.84/枚") with the SAME .a-price component, and on alternate
// (e.g. mobile-ish) layouts that lack the desktop core-price div it can appear first
// — yielding a bogus ¥35 instead of the real ¥6,980. Discriminate by structure:
// JP yen prices are whole numbers (empty .a-price-fraction); per-unit prices carry a
// fraction. Also skip the strikethrough list price (.a-text-price / data-a-strike).
// Prefer the buy-box core-price container, then fall back to a whole-document scan.
function parseAmazonYenPrice(root: ReturnType<typeof parse>): number {
  const scopes = ['#corePriceDisplay_desktop_feature_div', '#corePrice_feature_div', '#apex_desktop']
    .map((s) => root.querySelector(s))
    .filter((el): el is NonNullable<typeof el> => el !== null)
  scopes.push(root) // whole-document fallback for layouts without the core-price div
  for (const scope of scopes) {
    for (const el of scope.querySelectorAll('.a-price')) {
      if (el.querySelector('.a-price-fraction')?.text?.trim()) continue // per-unit decimal price
      const cls = el.getAttribute('class') ?? ''
      if (el.getAttribute('data-a-strike') === 'true' || cls.includes('a-text-price')) continue // list/was price
      const n = parsePrice(el.querySelector('.a-price-whole')?.text ?? '')
      if (n) return n
    }
  }
  return parsePrice(root.querySelector('#priceblock_ourprice')?.text ?? '')
}

function parseAmazonProductHtml(html: string, asin: string): ProductResult | null {
  const root = parse(html)
  const title = root.querySelector('#productTitle, #title')?.text.trim() ?? ''
  if (!title) return null
  const salePrice = parseAmazonYenPrice(root)
  if (!salePrice) return null
  const pointText = root.querySelectorAll('.a-size-base.a-color-price').map(el => el.text).join(' ')
  const pointsEarned = parsePoints(pointText)
  const imageUrl = root.querySelector('#landingImage, #imgBlkFront')?.getAttribute('src') ?? ''
  const bullets = root.querySelectorAll('#feature-bullets li span.a-list-item')
    .slice(0, 3).map(el => el.text.trim()).filter(t => t.length > 5)
  const description = bullets.join(' ').slice(0, 200) || undefined
  return { ...buildResult(title, salePrice, pointsEarned, asin, imageUrl), description }
}

export async function crawlAmazonProduct(asin: string, productUrl?: string): Promise<ProductResult | null> {
  // Preserve variant params (?th=1 etc.) from the original URL so we crawl the correct variant.
  const url = productUrl ?? `https://www.amazon.co.jp/dp/${asin}`
  const attempt = async (res: Response): Promise<ProductResult> => {
    if (!res.ok) throw new Error('bad status')
    const html = await res.text()
    const result = parseAmazonProductHtml(html, asin)
    if (!result) throw new Error('parse failed')
    return result
  }
  // ScraperAPI with country_code=jp is the authoritative source for Japanese prices.
  // Direct fetch from non-JP servers returns locale-based prices that may differ.
  // Use ScraperAPI as primary; direct fetch as fallback only if proxy is unavailable.
  try {
    const res = await proxyFetch(url, { headers: HEADERS }, { timeoutMs: 25000 })
    return await attempt(res)
  } catch {
    // Fallback: direct fetch (less accurate locale but better than nothing)
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000) })
      return await attempt(res)
    } catch {
      return null
    }
  }
}

