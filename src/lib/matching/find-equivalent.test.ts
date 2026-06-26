jest.mock('@/lib/llm/openrouter', () => ({
  refineKeyword: jest.fn(),
  semanticMatch: jest.fn(),
  classifyCategory: jest.fn(async () => 'unknown'),
}))
jest.mock('@/lib/crawlers/amazon', () => ({ crawlAmazonSearch: jest.fn() }))
jest.mock('@/lib/crawlers/rakuten', () => ({ crawlRakutenSearch: jest.fn() }))
jest.mock('@/lib/cache', () => ({
  getCached: jest.fn(async () => null),
  setCached: jest.fn(async () => {}),
  makeCacheKey: (s: string) => s,
}))
jest.mock('@/lib/harvest/repo', () => ({
  findListingByPlatformId: jest.fn(async () => null),
  findSiblingListings: jest.fn(async () => []),
  upsertProduct: jest.fn(),
  upsertListing: jest.fn(),
  findAmazonSiblingByRakuten: jest.fn(),
  linkSlugToProduct: jest.fn(async () => {}),
}))
jest.mock('@/lib/matching/db-fallback', () => ({ matchAgainstDb: jest.fn() }))
jest.mock('@/lib/platforms/amazon-link', () => ({
  buildAmazonLinkResult: (i: { asin: string; title: string; imageUrl: string }) => ({
    platform: 'amazon', title: i.title, imageUrl: i.imageUrl, shopName: 'Amazon.co.jp',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: `https://www.amazon.co.jp/dp/${i.asin}?tag=t`, priceUnavailable: true,
  }),
}))

import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached } from '@/lib/cache'
import { findAmazonSiblingByRakuten, linkSlugToProduct } from '@/lib/harvest/repo'
import { matchAgainstDb } from '@/lib/matching/db-fallback'
import { findEquivalent } from './find-equivalent'
import { ProductResult } from '@/lib/types'

const p = (title: string, url: string): ProductResult => ({
  platform: 'amazon', title, imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 1000, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, taxRate: 1.1, affiliateUrl: url,
})

beforeEach(() => {
  jest.clearAllMocks()
  ;(refineKeyword as jest.Mock).mockResolvedValue('明治ほほえみ キューブ')
  ;(getCached as jest.Mock).mockResolvedValue(null)
})

describe('findEquivalent', () => {
  it('runs a fresh targeted search and matches against it', async () => {
    const source = p('Meiji Hohoemi Easy Cube 1620g', 'a-src')
    ;(crawlRakutenSearch as jest.Mock).mockResolvedValue([
      p('明治ほほえみ らくらくキューブ(27g×60袋)', 'r-targeted'),
    ])
    ;(semanticMatch as jest.Mock).mockResolvedValue(0)

    const result = await findEquivalent(source, 'rakuten', [])
    expect(crawlRakutenSearch).toHaveBeenCalledWith('明治ほほえみ キューブ')
    expect(result?.affiliateUrl).toBe('r-targeted')
  })

  it('merges the prior pool as a supplement and dedupes by affiliateUrl', async () => {
    const source = p('Meiji Hohoemi', 'a-src')
    ;(crawlRakutenSearch as jest.Mock).mockResolvedValue([p('dup', 'shared'), p('t1', 't1')])
    const prior = [p('dup', 'shared'), p('prior-only', 'p1')]
    // capture what semanticMatch actually receives
    let received: ProductResult[] = []
    ;(semanticMatch as jest.Mock).mockImplementation(async (_s, cands: ProductResult[]) => {
      received = cands
      return 0
    })

    await findEquivalent(source, 'rakuten', prior)
    // shared appears once; pool = targeted (2) + prior unique (1) = 3
    expect(received.map((r) => r.affiliateUrl)).toEqual(['shared', 't1', 'p1'])
  })

  it('still matches against the prior pool when targeted search returns nothing', async () => {
    const source = p('Meiji Hohoemi', 'a-src')
    ;(crawlRakutenSearch as jest.Mock).mockResolvedValue([])
    ;(semanticMatch as jest.Mock).mockResolvedValue(0)
    const result = await findEquivalent(source, 'rakuten', [p('prior', 'p1')])
    expect(result?.affiliateUrl).toBe('p1')
  })

  it('returns null when the pool is empty', async () => {
    ;(crawlRakutenSearch as jest.Mock).mockResolvedValue([])
    const result = await findEquivalent(p('x', 'a-src'), 'rakuten', [])
    expect(result).toBeNull()
    expect(semanticMatch).not.toHaveBeenCalled()
  })

  it('returns null when semanticMatch finds no match', async () => {
    ;(crawlRakutenSearch as jest.Mock).mockResolvedValue([p('t1', 't1')])
    ;(semanticMatch as jest.Mock).mockResolvedValue(null)
    const result = await findEquivalent(p('x', 'a-src'), 'rakuten', [])
    expect(result).toBeNull()
  })

  it('returns a DB link-only Amazon result for a Rakuten source, without crawling', async () => {
    ;(findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue({
      asin: 'B0ABC12345', productTitle: 'メリーズ M 64枚', productImageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg',
    })
    const source: ProductResult = {
      platform: 'rakuten', title: 'メリーズ M', imageUrl: '', shopName: '', salePrice: 1000,
      shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
      subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1,
      affiliateUrl: 'https://item.rakuten.co.jp/shop/item1/',
    }
    const r = await findEquivalent(source, 'amazon')
    expect(r?.platform).toBe('amazon')
    expect(r?.priceUnavailable).toBe(true)
    expect(r?.affiliateUrl).toContain('B0ABC12345')
    expect(crawlAmazonSearch).not.toHaveBeenCalled()
  })
})

describe('findEquivalent Amazon DB fallback', () => {
  it('falls back to matchAgainstDb when exact-id misses, then writes back', async () => {
    (findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue({
      productId: 688, targetListingId: 'B0FTFXNGFS',
      productTitle: 'パンパース M46', productImageUrl: 'img', similarity: 0.4,
    })
    const rakutenSource = p('パンパース はじめての肌いち M46枚', 'https://item.rakuten.co.jp/jetprice/x392sh/')
    rakutenSource.platform = 'rakuten'
    const out = await findEquivalent(rakutenSource, 'amazon')
    expect(out).not.toBeNull()
    expect(out!.platform).toBe('amazon')
    expect(out!.affiliateUrl).toContain('B0FTFXNGFS')
    expect(linkSlugToProduct).toHaveBeenCalledWith(688, 'rakuten', 'jetprice:x392sh', expect.any(String), 0.8)
  })

  it('returns null when exact-id misses and matchAgainstDb finds nothing', async () => {
    (findAmazonSiblingByRakuten as jest.Mock).mockResolvedValue(null)
    ;(matchAgainstDb as jest.Mock).mockResolvedValue(null)
    const rakutenSource = p('未知の商品', 'https://item.rakuten.co.jp/shop/unknown/')
    rakutenSource.platform = 'rakuten'
    expect(await findEquivalent(rakutenSource, 'amazon')).toBeNull()
  })
})
