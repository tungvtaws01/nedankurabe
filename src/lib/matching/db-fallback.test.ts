jest.mock('@/lib/harvest/repo', () => ({ findProductCandidatesByTokens: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ semanticMatch: jest.fn(), refineKeyword: jest.fn() }))
// rank.ts is NOT mocked — we exercise the real similarity gate.

import { findProductCandidatesByTokens } from '@/lib/harvest/repo'
import { semanticMatch, refineKeyword } from '@/lib/llm/openrouter'
import { matchAgainstDb } from './db-fallback'
import { ProductResult } from '@/lib/types'

const src = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => {
  jest.clearAllMocks()
  // Default: keyword refinement is identity, so existing tests are unaffected.
  ;(refineKeyword as jest.Mock).mockImplementation(async (t: string) => t)
})

it('refines the source title into a keyword before DB retrieval (spaceless JP titles)', async () => {
  // Raw title has no spaces → a whitespace splitter would produce one unmatchable
  // ILIKE token. matchAgainstDb must retrieve using the refined keyword instead.
  (refineKeyword as jest.Mock).mockResolvedValue('明治ほほえみ 780g')
  ;(findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 5, title: '明治ほほえみ 780g 母乳サイエンス 乳児用調製粉乳', imageUrl: 'i', targetListingId: 'B0G2RVVXWP' },
  ])
  ;(semanticMatch as jest.Mock).mockResolvedValue(0)
  const m = await matchAgainstDb(src('明治ほほえみ（780g×2パック）'), 'amazon')
  expect(refineKeyword).toHaveBeenCalledWith('明治ほほえみ（780g×2パック）', 'amazon', undefined)
  expect(findProductCandidatesByTokens).toHaveBeenCalledWith('明治ほほえみ 780g', 'amazon')
  expect(m?.targetListingId).toBe('B0G2RVVXWP')
})

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
