jest.mock('@/lib/harvest/repo', () => ({ findProductCandidatesByTokens: jest.fn() }))
jest.mock('@/lib/llm/openrouter', () => ({ semanticMatchAll: jest.fn(), refineKeyword: jest.fn() }))
// rank.ts and pack-size.ts are NOT mocked — exercise the real gate + ranking.

import { findProductCandidatesByTokens } from '@/lib/harvest/repo'
import { semanticMatchAll, refineKeyword } from '@/lib/llm/openrouter'
import { matchAgainstDb } from './db-fallback'
import { ProductResult } from '@/lib/types'

const src = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
  subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: '',
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(refineKeyword as jest.Mock).mockImplementation(async (t: string) => t)
})

it('refines the title to a keyword before retrieval (spaceless JP titles)', async () => {
  (refineKeyword as jest.Mock).mockResolvedValue('明治ほほえみ らくらくキューブ')
  ;(findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 5, title: '明治ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A30' },
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([0])
  const out = await matchAgainstDb(src('明治ほほえみらくらくキューブ(27g×120袋)'), 'amazon')
  expect(refineKeyword).toHaveBeenCalledWith('明治ほほえみらくらくキューブ(27g×120袋)', 'amazon', undefined)
  expect(findProductCandidatesByTokens).toHaveBeenCalledWith('明治ほほえみ らくらくキューブ', 'amazon')
  expect(out.map((m) => m.targetListingId)).toEqual(['A30'])
})

it('returns confirmed candidates ranked by pack closeness, tagged, deduped, capped at 5', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: '明治ほほえみ らくらくキューブ 27g×4袋', imageUrl: 'i', targetListingId: 'A4' },     // 108g, far
    { productId: 2, title: '明治ほほえみ らくらくキューブ 810g×2個', imageUrl: 'i', targetListingId: 'A60' },   // 1620g, closest
    { productId: 2, title: '明治ほほえみ らくらくキューブ 810g×2個', imageUrl: 'i', targetListingId: 'A60' },   // dup
    { productId: 3, title: '明治ほほえみ らくらくキューブ 27g×30袋', imageUrl: 'i', targetListingId: 'A30' },   // 810g, mid
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([0, 1, 2, 3])
  // source 27g×60袋 = 1620g → A60 (exact) closest, then A30, then A4
  const out = await matchAgainstDb(src('明治ほほえみ らくらくキューブ 27g×60袋'), 'amazon')
  expect(out.map((m) => m.targetListingId)).toEqual(['A60', 'A30', 'A4'])
  expect(out[0].sizeMatch).toBe('exact')      // 1620 vs 1620
  expect(out[2].sizeMatch).toBe('different')  // 108 vs 1620
})

it('returns [] when nothing confirms', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 1, title: 'x', imageUrl: 'i', targetListingId: 'A' },
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('y'), 'amazon')).toEqual([])
})

it('returns [] on an empty candidate pool without calling the LLM', async () => {
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([])
  expect(await matchAgainstDb(src('x'), 'amazon')).toEqual([])
  expect(semanticMatchAll).not.toHaveBeenCalled()
})

it('excludes a confirmed candidate whose similarity score is below SIMILARITY_FLOOR', async () => {
  // source and candidate share almost no tokens → real similarity() << 0.12
  (findProductCandidatesByTokens as jest.Mock).mockResolvedValue([
    { productId: 9, title: '全く別の商品 哺乳瓶 240ml ガラス製', imageUrl: 'i', targetListingId: 'X1' },
  ])
  ;(semanticMatchAll as jest.Mock).mockResolvedValue([0])
  const out = await matchAgainstDb(src('パンパース おむつ テープ スーパージャンボM46枚'), 'amazon')
  expect(out).toEqual([])
})
