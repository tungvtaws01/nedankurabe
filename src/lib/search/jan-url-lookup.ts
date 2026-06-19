import { findByJan } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { byEffectivePrice } from '@/lib/price/normalize'
import { ProductResult } from '@/lib/types'

// A Rakuten product URL whose slug is a bare JAN (EAN-13), e.g.
// https://item.rakuten.co.jp/<shop>/4987244195937/ — the slug is NOT the Rakuten itemCode,
// so crawlRakutenProduct cannot resolve it. Resolve it authoritatively from our products DB
// (we only harvest baby products). Returns priced results, or null to signal "fall through
// to the live crawl" (slug not a JAN, JAN unharvested, or no usable listing).
export async function resolveJanRakutenUrl(rakutenUrl: string): Promise<ProductResult[] | null> {
  const m = rakutenUrl.match(/rakuten\.co\.jp\/[^/]+\/(\d{13})\b/)
  if (!m) return null
  const hit = await findByJan(m[1]).catch(() => null)
  if (!hit?.rakutenItemCode) return null
  const rk = await lookupRakuten(hit.rakutenItemCode).catch(() => null)
  const amazonCard = hit.asin
    ? buildAmazonLinkResult({ asin: hit.asin, title: hit.productTitle, imageUrl: hit.productImageUrl })
    : null
  const merged = [...(rk ? [rk] : []), ...(amazonCard ? [amazonCard] : [])].sort(byEffectivePrice)
  return merged.length ? merged : null
}
