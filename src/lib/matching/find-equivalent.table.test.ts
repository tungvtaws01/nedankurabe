import { findEquivalent } from './find-equivalent'
import type { ProductResult } from '@/lib/types'

jest.mock('@/lib/harvest/repo', () => ({
  findListingByPlatformId: jest.fn(),
  findSiblingListings: jest.fn(),
  upsertProduct: jest.fn(),
  upsertListing: jest.fn(),
}))
jest.mock('@/lib/platforms/rakuten', () => ({ lookupRakuten: jest.fn() }))
import { findListingByPlatformId, findSiblingListings } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'

const src: ProductResult = {
  platform: 'amazon', title: 'Pampers M', imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
  subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1,
  affiliateUrl: 'https://www.amazon.co.jp/dp/B0ABC12345',
}

it('returns the table sibling without calling the LLM when source ASIN is known', async () => {
  ;(findListingByPlatformId as jest.Mock).mockResolvedValue({ id: 1, product_id: 42, platform: 'amazon' })
  ;(findSiblingListings as jest.Mock).mockResolvedValue([{ platform_id: 'shop:999', product_id: 42 }])
  ;(lookupRakuten as jest.Mock).mockResolvedValue({ ...src, platform: 'rakuten', affiliateUrl: 'r' })

  const result = await findEquivalent(src, 'rakuten')
  expect(result?.platform).toBe('rakuten')
  expect(findSiblingListings).toHaveBeenCalledWith(42, 'rakuten')
})
