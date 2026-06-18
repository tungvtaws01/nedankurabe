import { ProductResult, UserToggles } from '@/lib/types'

export function calcAmazonEffectivePrice(
  salePrice: number,
  couponDiscount: number,
  subscribeSave: boolean,
  primeBulk: boolean,
): number {
  const subscribeDiscount = subscribeSave ? Math.round(salePrice * 0.05) : 0
  const primePointRate = primeBulk ? 3 : 1
  const points = Math.round(salePrice * primePointRate / 100)
  return salePrice - couponDiscount - subscribeDiscount - points
}

export function calcRakutenEffectivePrice(
  itemPrice: number,
  shippingCost: number,
  couponDiscount: number,
  pointRate: number,
  spuMultiplier: 1 | 3 | 5 | 10,
  rakutenCard: boolean,
  teiki: 'off' | 'first' | 'recurring',
  teikiRates: { first: number; recurring: number } | null,
  taxRate: 1.08 | 1.1 = 1.1,
): number {
  const teikiRate =
    teiki === 'first' ? (teikiRates?.first ?? 0.10) :
    teiki === 'recurring' ? (teikiRates?.recurring ?? 0.05) : 0
  const subscriptionDiscount = teiki !== 'off' ? Math.round(itemPrice * teikiRate) : 0
  const taxExcludedPrice = Math.floor((itemPrice - subscriptionDiscount) / taxRate)
  const cardBonus = rakutenCard ? 2 : 0
  const effectivePointRate = teiki !== 'off' ? 0 : pointRate + (spuMultiplier - 1) + cardBonus
  const pointsEarned = Math.floor(taxExcludedPrice * effectivePointRate / 100)
  return itemPrice + shippingCost - subscriptionDiscount - couponDiscount - pointsEarned
}

// Sort comparator: cheapest effectivePrice first; link-only items (no displayable
// price) always sort last so a real priced result is never out-ranked by a ¥0 placeholder.
export function byEffectivePrice(a: ProductResult, b: ProductResult): number {
  if (a.priceUnavailable && !b.priceUnavailable) return 1
  if (b.priceUnavailable && !a.priceUnavailable) return -1
  return a.effectivePrice - b.effectivePrice
}

export function recalcWithToggles(results: ProductResult[], toggles: UserToggles): ProductResult[] {
  return results
    .map(r => {
      if (r.priceUnavailable) return r // no compliant price to recompute
      const effectivePrice =
        r.platform === 'amazon'
          ? calcAmazonEffectivePrice(
              r.salePrice,
              r.couponDiscount,
              toggles.amazonSubscribeSave && r.subscribeAvailable,
              toggles.amazonPrimeBulk,
            )
          : calcRakutenEffectivePrice(
              r.salePrice,
              r.shippingCost,
              r.couponDiscount,
              r.pointRate,
              toggles.rakutenSPU,
              toggles.rakutenCard && r.rakutenCardEligible,
              r.subscribeAvailable ? toggles.rakutenTeiki : 'off',
              r.teikiRates,
              r.taxRate,
            )
      return { ...r, effectivePrice }
    })
    .sort(byEffectivePrice)
}
