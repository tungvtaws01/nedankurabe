const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlAmazonSearch, crawlAmazonProduct } from './amazon'

const SEARCH_HTML = `
<html><body>
<div data-asin="B09XYZ1111" data-component-type="s-search-result">
  <h2><a><span>パンパース テープ はじめての肌 Sサイズ 108枚</span></a></h2>
  <img class="s-image" src="https://m.media-amazon.com/img1.jpg" />
  <span class="a-price"><span class="a-price-whole">3,980</span></span>
  <span class="a-size-base a-color-price">40 pt</span>
</div>
<div data-asin="B09XYZ2222" data-component-type="s-search-result">
  <h2><a><span>メリーズ テープ Mサイズ 64枚</span></a></h2>
  <img class="s-image" src="https://m.media-amazon.com/img2.jpg" />
  <span class="a-price"><span class="a-price-whole">1,580</span></span>
  <span class="a-size-base a-color-price">送料無料</span>
</div>
</body></html>
`

const PRODUCT_HTML = `
<html><body>
  <span id="productTitle">パンパース テープ はじめての肌 Sサイズ 108枚</span>
  <img id="landingImage" src="https://m.media-amazon.com/img.jpg" />
  <span class="a-price-whole">3,980</span>
  <span class="a-size-base a-color-price">40 pt</span>
</body></html>
`

beforeEach(() => {
  mockFetch.mockReset()
  process.env.AMAZON_PARTNER_TAG = ''
})

describe('crawlAmazonSearch', () => {
  it('extracts title, price, ASIN from search page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlAmazonSearch('パンパース テープ Sサイズ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('パンパース テープ はじめての肌 Sサイズ 108枚')
    expect(results[0].salePrice).toBe(3980)
    expect(results[0].pointsEarned).toBe(40)
    expect(results[0].platform).toBe('amazon')
    expect(results[0].affiliateUrl).toContain('B09XYZ1111')
  })

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await crawlAmazonSearch('test')).toEqual([])
  })

  it('returns empty array when response not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => '' })
    expect(await crawlAmazonSearch('test')).toEqual([])
  })
})

describe('crawlAmazonProduct', () => {
  it('extracts title, price, points from product page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => PRODUCT_HTML })
    const result = await crawlAmazonProduct('B09XYZ1111')
    expect(result).not.toBeNull()
    expect(result!.title).toBe('パンパース テープ はじめての肌 Sサイズ 108枚')
    expect(result!.salePrice).toBe(3980)
    expect(result!.pointsEarned).toBe(40)
    expect(result!.platform).toBe('amazon')
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    expect(await crawlAmazonProduct('BADASIN')).toBeNull()
  })
})
