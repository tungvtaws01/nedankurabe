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
      // No-brand generic: survives the brand gate (no known maker), LLM rejects it (NO-BRAND rule)
      mockProduct('おむつ テープ S 90枚', 2980),
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
      mockProduct('おむつ テープ S 90枚', 1200),                                 // index 1 — no-brand generic, LLM rejects (survives gate)
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

  it('drops a known cross-brand candidate before the LLM (brand gate)', async () => {
    // The LLM would say match index 0, but the gate must remove it (different known brand).
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"matches":[0]}' } }] }),
    })
    const source = mockProduct('カークランド おしりふき 100枚', 500)
    const idx = await semanticMatch(source, [mockProduct('RICO おしりふき 100枚', 400)])
    expect(idx).toBeNull()
  })

  it('routes to the per-genre rule when category is supplied', async () => {
    // Capture the prompt sent to the LLM and assert the thermometer rule text is present.
    let lastContent = ''
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      lastContent = JSON.parse(init.body).messages[0].content
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"matches":[0]}' } }] }) }
    })
    const source = mockProduct('ピジョン 耳チビオン 耳式体温計 C231', 3000)
    await semanticMatch(source, [mockProduct('ピジョン 耳チビオン C231 体温計', 2800)], { category: 'thermometer' })
    expect(lastContent).toContain('耳式 (ear)')
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

  it('sends the classify prompt on the first call and the refine prompt on the second', async () => {
    mockFetch
      .mockResolvedValueOnce(llmReply('diapers'))
      .mockResolvedValueOnce(llmReply('パンパース テープ 新生児'))
    await refineKeyword('パンパース テープ 新生児 84枚', 'amazon')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const body0 = JSON.parse(mockFetch.mock.calls[0][1].body)
    const body1 = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(body0.messages[0].content).toContain('Classify this Japanese baby product')
    expect(body1.messages[0].content).toContain('Extract a search keyword')
  })
})

describe('explainPriceDifference', () => {
  it('returns the LLM sentence for a winner/loser pair', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockResolvedValue(llmReply('楽天は定価が¥200安く、¥200お得です。'))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-ok-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-ok-1' }
    winner.effectivePrice = 1800
    loser.effectivePrice = 2000
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBe('楽天は定価が¥200安く、¥200お得です。')
  })

  it('returns null when the LLM call throws', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockRejectedValue(new Error('network'))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-throw-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-throw-1' }
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBeNull()
  })

  it('returns null when the LLM returns empty content', async () => {
    const { explainPriceDifference } = await import('./openrouter')
    mockFetch.mockResolvedValue(llmReply(''))
    const winner = { ...mockProduct('楽天 商品', 1800), platform: 'rakuten' as const, affiliateUrl: 'r-empty-1' }
    const loser = { ...mockProduct('Amazon 商品', 2000), platform: 'amazon' as const, affiliateUrl: 'a-empty-1' }
    const text = await explainPriceDifference(winner, loser)
    expect(text).toBeNull()
  })
})
