const mockFetch = jest.fn()
global.fetch = mockFetch

import { refineKeyword, semanticMatch } from './openrouter'
import { ProductResult } from '@/lib/types'

const mockProduct = (title: string, price: number): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: price,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: price, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => {
  mockFetch.mockReset()
  process.env.OPENROUTER_API_KEY = 'test-key'
  process.env.OPENROUTER_MODEL = 'test-model'
})

describe('refineKeyword', () => {
  it('returns LLM response text trimmed', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'パンパース テープ Sサイズ' } }] }),
    })
    const result = await refineKeyword('【期間限定】パンパース はじめての肌 テープ S 108枚 送料無料', 'amazon')
    expect(result).toBe('パンパース テープ Sサイズ')
  })

  it('falls back to bracket-stripped title when LLM fails', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))
    const result = await refineKeyword('【送料無料】パンパース テープ Sサイズ 108枚', 'amazon')
    expect(result).toBe('パンパース テープ Sサイズ 108枚')
  })

  it('falls back to bracket-stripped title when LLM returns empty content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    })
    const result = await refineKeyword('【キャンペーン】パンパース テープ Sサイズ', 'rakuten')
    expect(result).toBe('パンパース テープ Sサイズ')
  })
})

describe('semanticMatch', () => {
  it('returns candidate index from LLM response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"match":1}' } }] }),
    })
    const source = mockProduct('パンパース テープ S 108枚', 3980)
    const candidates = [
      mockProduct('GOO.N テープ S 90枚', 2980),
      mockProduct('パンパース はじめての肌 テープ Sサイズ 108枚', 3800),
    ]
    const idx = await semanticMatch(source, candidates)
    expect(idx).toBe(1)
  })

  it('returns null when LLM says no match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"match":null}' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBeNull()
  })

  it('falls back to 0 when LLM response is invalid JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBe(0)
  })

  it('returns null when candidates is empty', async () => {
    const idx = await semanticMatch(mockProduct('A', 100), [])
    expect(idx).toBeNull()
  })
})
