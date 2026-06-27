jest.mock('@/lib/harvest/repo', () => ({ findProductCandidatesByTokens: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ semanticMatch: jest.fn() }))
// rank.ts is NOT mocked — we exercise the real similarity gate.

import { findProductCandidatesByTokens } from '@/lib/harvest/repo'
import { semanticMatch } from '@/lib/llm/openrouter'
import { matchAgainstDb } from './db-fallback'
import { ProductResult } from '@/lib/types'

const src = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => jest.clearAllMocks())

it('returns the match when confirmed AND above the similarity floor', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 688, title: 'パンパース はじめての肌いち テープ スーパージャンボM46枚', imageUrl: 'i', targetListingId: 'B0FTFXNGFS' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(0)
  const m = await matchAgainstDb(src('パンパース はじめての肌いち テープ スーパージャンボM46枚 おむつ'), 'amazon')
  expect(m).not.toBeNull()
  expect(m!.productId).toBe(688)
  expect(m!.targetListingId).toBe('B0FTFXNGFS')
  expect(m!.productImageUrl).toBe('i')
})

it('returns null when semanticMatch does not confirm', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: 'パンパース M46枚', imageUrl: 'i', targetListingId: 'A' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(null)
  expect(await matchAgainstDb(src('パンパース M46枚'), 'amazon')).toBeNull()
})

it('returns null when confirmed but below the similarity floor', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 2, title: '全く別の商品 哺乳瓶 240ml ガラス製', imageUrl: 'i', targetListingId: 'B' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(0)
  expect(await matchAgainstDb(src('パンパース おむつ テープ スーパージャンボM46枚'), 'amazon')).toBeNull()
})

it('returns null and does not call semanticMatch on an empty candidate pool', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('x'), 'amazon')).toBeNull()
  expect(semanticMatch).not.toHaveBeenCalled()
})
