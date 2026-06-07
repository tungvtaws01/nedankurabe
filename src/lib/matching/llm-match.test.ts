jest.mock('@/lib/llm/openrouter', () => ({
  semanticMatch: jest.fn(),
}))
import { semanticMatch } from '@/lib/llm/openrouter'
import { findBestMatch } from './llm-match'
import { ProductResult } from '@/lib/types'

const base: ProductResult = {
  platform: 'amazon', title: 'パンパース テープ S 82枚', imageUrl: '', shopName: 'Amazon',
  salePrice: 2178, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 22,
  effectivePrice: 2156, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
}

const candidates: ProductResult[] = [
  { ...base, platform: 'rakuten', title: 'パンパース はじめての肌へのいちばん テープ S 82枚', salePrice: 1980, effectivePrice: 1860, affiliateUrl: 'https://r1' },
  { ...base, platform: 'rakuten', title: 'GOO.N テープ S 72枚', salePrice: 1200, effectivePrice: 1100, affiliateUrl: 'https://r2' },
]

describe('findBestMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns candidate at index returned by semanticMatch', async () => {
    (semanticMatch as jest.Mock).mockResolvedValue(0)
    const result = await findBestMatch(base, candidates)
    expect(result?.affiliateUrl).toBe('https://r1')
  })

  it('returns null when semanticMatch returns null', async () => {
    (semanticMatch as jest.Mock).mockResolvedValue(null)
    expect(await findBestMatch(base, candidates)).toBeNull()
  })

  it('returns null for empty candidates list', async () => {
    expect(await findBestMatch(base, [])).toBeNull()
  })
})
