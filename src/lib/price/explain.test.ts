import { pickWinnerLoser, computePriceFacts, isComparablePair } from './explain'
import { ProductResult } from '@/lib/types'

const mk = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'rakuten', title: '', description: undefined, imageUrl: '', shopName: '',
  salePrice: 1000, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '', ...over,
})

describe('pickWinnerLoser', () => {
  it('orders the pair by effectivePrice (cheaper is winner)', () => {
    const a = mk({ title: 'A', effectivePrice: 2000 })
    const b = mk({ title: 'B', effectivePrice: 1500 })
    expect(pickWinnerLoser(a, b).winner.title).toBe('B')
    expect(pickWinnerLoser(a, b).loser.title).toBe('A')
    expect(pickWinnerLoser(b, a).winner.title).toBe('B')
  })
})

describe('computePriceFacts', () => {
  it('reports diff, diffPct and a list-price reason when the winner has a lower sale price', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 1800, effectivePrice: 1800 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, effectivePrice: 2000 })
    const f = computePriceFacts(winner, loser)
    expect(f.diff).toBe(200)
    expect(f.diffPct).toBe(10)
    expect(f.listPriceDiff).toBe(200)
    expect(f.reasons.some(r => r.includes('定価が¥200安い'))).toBe(true)
  })

  it('reports a free-shipping reason', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, shippingCost: 0, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, shippingCost: 500, effectivePrice: 2500 })
    const f = computePriceFacts(winner, loser)
    expect(f.winnerFreeShipping).toBe(true)
    expect(f.reasons.some(r => r.includes('送料無料'))).toBe(true)
  })

  it('reports a points reason when the winner earns >¥50 more points', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, pointsEarned: 200, effectivePrice: 1800 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, pointsEarned: 20, effectivePrice: 1980 })
    const f = computePriceFacts(winner, loser)
    expect(f.pointsDelta).toBe(180)
    expect(f.reasons.some(r => r.includes('ポイント還元が¥180多い'))).toBe(true)
  })

  it('reports a quantity-multiplier mismatch note', () => {
    const winner = mk({ platform: 'rakuten', title: 'おむつ ×2パック', salePrice: 2000, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', title: 'おむつ 4個セット', salePrice: 2200, effectivePrice: 2200 })
    const f = computePriceFacts(winner, loser)
    expect(f.winnerMultiplier).toBe(2)
    expect(f.loserMultiplier).toBe(4)
    expect(f.reasons.some(r => r.startsWith('※ 内容量が異なります'))).toBe(true)
  })

  it('returns no reasons when prices are identical', () => {
    const winner = mk({ platform: 'rakuten', salePrice: 2000, effectivePrice: 2000 })
    const loser = mk({ platform: 'amazon', salePrice: 2000, effectivePrice: 2000 })
    const f = computePriceFacts(winner, loser)
    expect(f.reasons).toEqual([])
  })
})

const mkC = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'rakuten', title: 't', imageUrl: '', shopName: '', salePrice: 100, shippingCost: 0,
  couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 100, subscribeAvailable: false,
  rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: 'u', ...over,
})

describe('isComparablePair', () => {
  it('is true when both have prices', () => {
    expect(isComparablePair(mkC({}), mkC({ platform: 'amazon' }))).toBe(true)
  })
  it('is false when either is link-only', () => {
    expect(isComparablePair(mkC({}), mkC({ platform: 'amazon', priceUnavailable: true }))).toBe(false)
  })
})
