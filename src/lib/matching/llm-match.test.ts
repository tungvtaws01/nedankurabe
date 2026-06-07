jest.mock('@anthropic-ai/sdk')
import Anthropic from '@anthropic-ai/sdk'
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

function mockCreate(responseText: string) {
  const mockMessages = {
    create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: responseText }] }),
  }
  ;(Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(
    () => ({ messages: mockMessages } as unknown as Anthropic)
  )
}

describe('findBestMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns candidate at index returned by Claude', async () => {
    mockCreate(JSON.stringify({ index: 0, confidence: 'high' }))
    const result = await findBestMatch(base, candidates)
    expect(result?.affiliateUrl).toBe('https://r1')
  })

  it('returns null when Claude returns index -1', async () => {
    mockCreate(JSON.stringify({ index: -1, confidence: 'low' }))
    expect(await findBestMatch(base, candidates)).toBeNull()
  })

  it('prefixes title with 似た商品 when confidence is low', async () => {
    mockCreate(JSON.stringify({ index: 0, confidence: 'low' }))
    const result = await findBestMatch(base, candidates)
    expect(result?.title).toMatch(/^似た商品/)
  })

  it('returns null for empty candidates list', async () => {
    expect(await findBestMatch(base, [])).toBeNull()
  })
})
