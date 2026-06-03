import { calcAmazonEffectivePrice, calcRakutenEffectivePrice, recalcWithToggles } from './normalize'
import { DEFAULT_TOGGLES, ProductResult } from '@/lib/types'

describe('calcAmazonEffectivePrice', () => {
  it('deducts 1% points from sale price (rounded)', () => {
    // round(1791 × 0.01) = 18; 1791 - 0 - 0 - 18 = 1773
    expect(calcAmazonEffectivePrice(1791, 0, false, false)).toBe(1773)
  })

  it('deducts coupon discount', () => {
    // 1791 - 100 - 0 - 18 = 1673
    expect(calcAmazonEffectivePrice(1791, 100, false, false)).toBe(1673)
  })

  it('Subscribe & Save deducts 5% of sale price', () => {
    // subscribeDiscount = round(6780 × 0.05) = 339
    // points = round(6780 × 0.01) = 68
    // 6780 - 0 - 339 - 68 = 6373
    expect(calcAmazonEffectivePrice(6780, 0, true, false)).toBe(6373)
  })

  it('Prime bulk raises point rate to 3%', () => {
    // points = round(6780 × 0.03) = 203
    // 6780 - 0 - 0 - 203 = 6577
    expect(calcAmazonEffectivePrice(6780, 0, false, true)).toBe(6577)
  })

  it('Subscribe & Save and Prime bulk both apply', () => {
    // subscribeDiscount = 339, points = round(6780 × 0.03) = 203
    // 6780 - 0 - 339 - 203 = 6238
    expect(calcAmazonEffectivePrice(6780, 0, true, true)).toBe(6238)
  })
})

describe('calcRakutenEffectivePrice', () => {
  it('base 1% on tax-excluded price, free shipping', () => {
    // taxExcluded = floor(3980 / 1.1) = 3618
    // points = floor(3618 × 1 / 100) = 36
    // 3980 - 0 - 0 - 0 - 36 = 3944
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 1, false, 'off', null)).toBe(3944)
  })

  it('SuperDEAL 30%: floor(taxExcluded × 30 / 100)', () => {
    // taxExcluded = floor(3980 / 1.1) = 3618
    // points = floor(3618 × 30 / 100) = 1085
    // 3980 - 0 - 0 - 0 - 1085 = 2895
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'off', null)).toBe(2895)
  })

  it('shipping cost is added to effective price', () => {
    // 3980 + 490 - 36 = 4434
    expect(calcRakutenEffectivePrice(3980, 490, 0, 1, 1, false, 'off', null)).toBe(4434)
  })

  it('Rakuten Card adds +2 to point rate', () => {
    // effectivePointRate = 1 + (1-1) + 2 = 3
    // points = floor(3618 × 3 / 100) = 108
    // 3980 - 108 = 3872
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 1, true, 'off', null)).toBe(3872)
  })

  it('SPU 5x adds +4 to point rate', () => {
    // effectivePointRate = 1 + (5-1) + 0 = 5
    // points = floor(3618 × 5 / 100) = 180
    // 3980 - 180 = 3800
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 5, false, 'off', null)).toBe(3800)
  })

  it('teiki first: 10% off, points suppressed to 0', () => {
    // subscriptionDiscount = round(3980 × 0.10) = 398
    // points = 0 (teiki suppresses points)
    // 3980 - 398 = 3582
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'first', { first: 0.10, recurring: 0.05 })).toBe(3582)
  })

  it('teiki first with Rakuten Card: card bonus suppressed', () => {
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, true, 'first', { first: 0.10, recurring: 0.05 })).toBe(3582)
  })

  it('teiki recurring: 5% off, points suppressed', () => {
    // subscriptionDiscount = round(3980 × 0.05) = 199; 3980 - 199 = 3781
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'recurring', { first: 0.10, recurring: 0.05 })).toBe(3781)
  })
})

describe('recalcWithToggles', () => {
  const base = {
    title: 'Test', imageUrl: '', shopName: 'Shop',
    shippingCost: 0, couponDiscount: 0,
    subscribeAvailable: true, rakutenCardEligible: true,
    teikiRates: { first: 0.10, recurring: 0.05 },
    affiliateUrl: '',
  }

  const amazon: ProductResult = { ...base, platform: 'amazon', salePrice: 6780, pointRate: 1, pointsEarned: 68, effectivePrice: 6712 }
  const rakuten: ProductResult = { ...base, platform: 'rakuten', salePrice: 3980, pointRate: 30, pointsEarned: 1085, effectivePrice: 2895 }

  it('sorts by recalculated effectivePrice ascending', () => {
    const ranked = recalcWithToggles([amazon, rakuten], DEFAULT_TOGGLES)
    expect(ranked[0].platform).toBe('rakuten')
    expect(ranked[1].platform).toBe('amazon')
  })

  it('Subscribe & Save reduces Amazon effective price', () => {
    const ranked = recalcWithToggles([amazon, rakuten], { ...DEFAULT_TOGGLES, amazonSubscribeSave: true })
    expect(ranked[0].platform).toBe('rakuten')
    expect(ranked[1].effectivePrice).toBe(6373)
  })
})
