import { ProductResult } from '@/lib/types'

// The ONLY place that emits an Amazon affiliate URL. Returns null when no partner
// tag is configured so callers can render no CTA — we must never emit an untagged
// link (that was one of the two Associate-rejection causes).
export function buildAmazonAffiliateUrl(asin: string): string | null {
  const tag = process.env.AMAZON_PARTNER_TAG
  if (!tag) {
    console.warn('[amazon] AMAZON_PARTNER_TAG is not set — Amazon CTA will be suppressed')
    return null
  }
  return `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`
}

// Build a link-only Amazon ProductResult from a matched DB record. The image is the
// product's Rakuten-sourced image (licensed for affiliate display); no Amazon image
// or price is used. Renders as a "view on Amazon" card with no price/breakdown.
export function buildAmazonLinkResult(input: { asin: string; title: string; imageUrl: string }): ProductResult {
  return {
    platform: 'amazon',
    title: input.title,
    imageUrl: input.imageUrl,
    shopName: 'Amazon.co.jp',
    salePrice: 0,
    shippingCost: 0,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned: 0,
    effectivePrice: 0,
    subscribeAvailable: false,
    rakutenCardEligible: false,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: buildAmazonAffiliateUrl(input.asin) ?? '',
    priceUnavailable: true,
  }
}
