jest.mock('@/lib/harvest/repo', () => ({ findMatchByAsin: jest.fn(), linkSlugToProduct: jest.fn(async () => {}) }))
jest.mock('@/lib/platforms/rakuten', () => ({ lookupRakuten: jest.fn() }))
jest.mock('@/lib/matching/db-fallback', () => ({ matchAgainstDb: jest.fn() }))
jest.mock('@/lib/platforms/amazon-link', () => ({
  buildAmazonLinkResult: (i: { asin: string; title: string; imageUrl: string }) => ({
    platform: 'amazon', title: i.title, imageUrl: i.imageUrl, shopName: 'Amazon.co.jp',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: `https://www.amazon.co.jp/dp/${i.asin}?tag=t`, priceUnavailable: true,
  }),
}))

import { findMatchByAsin, linkSlugToProduct } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { matchAgainstDb } from '@/lib/matching/db-fallback'
import { resolveAmazonPaste } from './resolve-amazon-paste'
import { ProductResult } from '@/lib/types'

const rakutenResult = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: 'ri', shopName: 'shop', salePrice: 2000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 20,
  effectivePrice: 1980, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: 'https://item.rakuten.co.jp/shop/abc/',
})

beforeEach(() => jest.clearAllMocks())

it('returns null when there is neither a DB match nor a slug title', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  expect(await resolveAmazonPaste('B0EXACT0001', '')).toBeNull()
  expect(matchAgainstDb).not.toHaveBeenCalled()
})

it('exact ASIN match: returns Amazon card + hydrated Rakuten sibling, no fallback', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue({
    productTitle: 'パンパース M46', productImageUrl: 'ri', rakutenItemCode: 'jetprice:10718259',
  })
  ;(lookupRakuten as jest.Mock).mockResolvedValue(rakutenResult('パンパース M46'))
  const out = await resolveAmazonPaste('B0EXACT0001', 'slug title')
  expect(out!.amazonCard.affiliateUrl).toContain('B0EXACT0001')
  expect(out!.amazonCard.title).toBe('パンパース M46')
  expect(out!.rakuten!.platform).toBe('rakuten')
  expect(matchAgainstDb).not.toHaveBeenCalled()
})

it('ASIN miss: DB fallback finds a Rakuten sibling, hydrates price, writes back', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  ;(matchAgainstDb as jest.Mock).mockResolvedValue({
    productId: 688, targetListingId: 'jetprice:10718259',
    productTitle: 'パンパース はじめての肌いち M46枚', productImageUrl: 'ri', similarity: 0.4,
  })
  ;(lookupRakuten as jest.Mock).mockResolvedValue(rakutenResult('パンパース はじめての肌いち M46枚'))
  const out = await resolveAmazonPaste('B0MISS00002', 'パンパース M46枚')
  expect(out!.amazonCard.title).toBe('パンパース はじめての肌いち M46枚')
  expect(out!.amazonCard.imageUrl).toBe('ri')
  expect(out!.rakuten!.salePrice).toBe(2000)
  expect(matchAgainstDb).toHaveBeenCalledWith(expect.objectContaining({ platform: 'amazon' }), 'rakuten')
  expect(linkSlugToProduct).toHaveBeenCalledWith(688, 'amazon', 'B0MISS00002', 'パンパース はじめての肌いち M46枚', 0.8)
})

it('ASIN miss + fallback miss: Amazon card from slug title, no Rakuten', async () => {
  (findMatchByAsin as jest.Mock).mockResolvedValue(null)
  ;(matchAgainstDb as jest.Mock).mockResolvedValue(null)
  const out = await resolveAmazonPaste('B0MISS00003', 'スリングだっこ紐')
  expect(out!.amazonCard.title).toBe('スリングだっこ紐')
  expect(out!.rakuten).toBeNull()
  expect(linkSlugToProduct).not.toHaveBeenCalled()
})
