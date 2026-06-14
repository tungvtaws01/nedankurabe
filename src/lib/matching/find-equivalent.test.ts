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

import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached } from '@/lib/cache'
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
    ;(crawlAmazonSearch as jest.Mock).mockResolvedValue([p('dup', 'shared'), p('t1', 't1')])
    const prior = [p('dup', 'shared'), p('prior-only', 'p1')]
    // capture what semanticMatch actually receives
    let received: ProductResult[] = []
    ;(semanticMatch as jest.Mock).mockImplementation(async (_s, cands: ProductResult[]) => {
      received = cands
      return 0
    })

    await findEquivalent(source, 'amazon', prior)
    // shared appears once; pool = targeted (2) + prior unique (1) = 3
    expect(received.map((r) => r.affiliateUrl)).toEqual(['shared', 't1', 'p1'])
  })

  it('still matches against the prior pool when targeted search returns nothing', async () => {
    const source = p('Meiji Hohoemi', 'a-src')
    ;(crawlAmazonSearch as jest.Mock).mockResolvedValue([])
    ;(semanticMatch as jest.Mock).mockResolvedValue(0)
    const result = await findEquivalent(source, 'amazon', [p('prior', 'p1')])
    expect(result?.affiliateUrl).toBe('p1')
  })

  it('returns null when the pool is empty', async () => {
    ;(crawlAmazonSearch as jest.Mock).mockResolvedValue([])
    const result = await findEquivalent(p('x', 'a-src'), 'amazon', [])
    expect(result).toBeNull()
    expect(semanticMatch).not.toHaveBeenCalled()
  })

  it('returns null when semanticMatch finds no match', async () => {
    ;(crawlAmazonSearch as jest.Mock).mockResolvedValue([p('t1', 't1')])
    ;(semanticMatch as jest.Mock).mockResolvedValue(null)
    const result = await findEquivalent(p('x', 'a-src'), 'amazon', [])
    expect(result).toBeNull()
  })
})
