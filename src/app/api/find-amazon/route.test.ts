jest.mock('@/lib/matching/find-equivalent', () => ({ findEquivalent: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ explainPriceDifference: jest.fn() }))

import { POST } from './route'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { ProductResult } from '@/lib/types'
import { NextRequest } from 'next/server'

const mk = (over: Partial<ProductResult>): ProductResult => ({
  platform: 'amazon', title: '', description: undefined, imageUrl: '', shopName: '',
  salePrice: 2000, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 2000, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '', ...over,
})

const reqWith = (bodyObj: unknown) =>
  ({ json: async () => bodyObj } as unknown as NextRequest)

beforeEach(() => {
  ;(findEquivalent as jest.Mock).mockReset()
  ;(explainPriceDifference as jest.Mock).mockReset()
})

describe('POST /api/find-amazon', () => {
  it('returns the match and an explanation when an equivalent is found', async () => {
    const source = mk({ platform: 'amazon', title: 'Amazon 商品', effectivePrice: 2000, affiliateUrl: 'a1' })
    const match = mk({ platform: 'rakuten', title: '楽天 商品', effectivePrice: 1800, affiliateUrl: 'r1' })
    ;(findEquivalent as jest.Mock).mockResolvedValue(match)
    ;(explainPriceDifference as jest.Mock).mockResolvedValue('楽天が¥200お得です。')

    const res = await POST(reqWith({ source, candidates: [] }))
    const data = await res.json() as { result: ProductResult | null; explanation?: string | null }

    expect(data.result?.affiliateUrl).toBe('r1')
    expect(data.explanation).toBe('楽天が¥200お得です。')
    expect(explainPriceDifference).toHaveBeenCalledTimes(1)
  })

  it('returns null result and null explanation when no equivalent is found', async () => {
    const source = mk({ platform: 'amazon', title: 'Amazon 商品', affiliateUrl: 'a2' })
    ;(findEquivalent as jest.Mock).mockResolvedValue(null)

    const res = await POST(reqWith({ source, candidates: [] }))
    const data = await res.json() as { result: ProductResult | null; explanation?: string | null }

    expect(data.result).toBeNull()
    expect(data.explanation).toBeNull()
    expect(explainPriceDifference).not.toHaveBeenCalled()
  })
})
