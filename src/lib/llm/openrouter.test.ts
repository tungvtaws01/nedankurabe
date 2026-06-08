const mockFetch = jest.fn()
global.fetch = mockFetch

import { refineKeyword, semanticMatch, classifyCategory } from './openrouter'
import { ProductResult } from '@/lib/types'

const llmReply = (content: string) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content } }] }),
})

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
      json: async () => ({ choices: [{ message: { content: '{"matches":[1]}' } }] }),
    })
    const source = mockProduct('パンパース テープ S 108枚', 3980)
    const candidates = [
      mockProduct('GOO.N テープ S 90枚', 2980),
      mockProduct('パンパース はじめての肌 テープ Sサイズ 108枚', 3800),
    ]
    const idx = await semanticMatch(source, candidates)
    expect(idx).toBe(1)
  })

  it('returns the cheapest among multiple valid matches', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"matches":[0,2]}' } }] }),
    })
    const source = mockProduct('パンパース さらさらケア テープ 新生児', 2000)
    const candidates = [
      mockProduct('パンパース さらさらケア テープ 新生児 84枚 (高い店)', 2640),  // index 0
      mockProduct('GOO.N テープ S 90枚', 1200),                                  // index 1 — wrong brand
      mockProduct('パンパース さらさらケア テープ 新生児 82枚 (安い店)', 1800),  // index 2
    ]
    const idx = await semanticMatch(source, candidates)
    expect(idx).toBe(2) // picks cheapest valid match
  })

  it('returns null when LLM says no match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"matches":[]}' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBeNull()
  })

  it('returns null when LLM response is invalid JSON (safe fallback — no wrong match)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'not json' } }] }),
    })
    const idx = await semanticMatch(mockProduct('A', 100), [mockProduct('B', 200)])
    expect(idx).toBeNull()
  })

  it('parses JSON wrapped in markdown fences', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"matches":[0]}\n```' } }] }),
    })
    const source = mockProduct('パンパース さらさらケア テープ 新生児', 1980)
    const idx = await semanticMatch(source, [mockProduct('パンパース さらさらケア テープ 新生児 82枚', 1950)])
    expect(idx).toBe(0)
  })

  it('returns null when candidates is empty', async () => {
    const idx = await semanticMatch(mockProduct('A', 100), [])
    expect(idx).toBeNull()
  })
})

describe('classifyCategory', () => {
  it('returns a known category id when the LLM names one', async () => {
    mockFetch.mockResolvedValue(llmReply('diapers'))
    expect(await classifyCategory('パンパース テープ Sサイズ 108枚')).toBe('diapers')
  })

  it('is case-insensitive and trims the LLM reply', async () => {
    mockFetch.mockResolvedValue(llmReply('  Formula  '))
    expect(await classifyCategory('明治ほほえみ らくらくキューブ')).toBe('formula')
  })

  it('returns "unknown" when the LLM names a non-category', async () => {
    mockFetch.mockResolvedValue(llmReply('something-else'))
    expect(await classifyCategory('謎の商品')).toBe('unknown')
  })

  it('returns "unknown" when the LLM call fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await classifyCategory('パンパース テープ')).toBe('unknown')
  })
})

describe('refineKeyword dispatch', () => {
  it('uses the classified category prompt, returning the refine reply', async () => {
    mockFetch
      .mockResolvedValueOnce(llmReply('diapers'))
      .mockResolvedValueOnce(llmReply('パンパース さらさらケア テープ 新生児'))
    const result = await refineKeyword('【送料無料】パンパース さらさらケア テープ 新生児 84枚', 'amazon')
    expect(result).toBe('パンパース さらさらケア テープ 新生児')
  })

  it('falls back to universal prompt when category is unknown (still returns refine reply)', async () => {
    mockFetch
      .mockResolvedValueOnce(llmReply('unknown'))
      .mockResolvedValueOnce(llmReply('和光堂 グーグーキッチン 12ヶ月'))
    const result = await refineKeyword('和光堂 グーグーキッチン 12ヶ月頃から', 'rakuten')
    expect(result).toBe('和光堂 グーグーキッチン 12ヶ月')
  })
})
