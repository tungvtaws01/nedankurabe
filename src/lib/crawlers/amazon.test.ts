const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlAmazonSearch, crawlAmazonProduct, resolveAmazonShortLink, isAmazonShortLink } from './amazon'

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

describe('isAmazonShortLink', () => {
  it('recognizes Amazon mobile-share short hosts', () => {
    expect(isAmazonShortLink('https://amzn.asia/d/0hw5G7DL')).toBe(true)
    expect(isAmazonShortLink('https://amzn.to/abc123')).toBe(true)
    expect(isAmazonShortLink('amzn.asia/d/0hw5G7DL')).toBe(true) // no protocol
    expect(isAmazonShortLink('https://a.co/d/xyz')).toBe(true)
  })

  it('does not treat full Amazon or Rakuten URLs as short links', () => {
    expect(isAmazonShortLink('https://www.amazon.co.jp/dp/B0C7GQGGXK')).toBe(false)
    expect(isAmazonShortLink('https://item.rakuten.co.jp/shop/123/')).toBe(false)
    expect(isAmazonShortLink('not a url')).toBe(false)
  })
})

describe('resolveAmazonShortLink', () => {
  it('resolves a short link to its canonical /dp/<ASIN> URL via the redirect Location', async () => {
    const canonical = 'https://www.amazon.co.jp/dp/B0C7GQGGXK?ref=cm_sw_r_cp_ud_dp_X&social_share=Y'
    mockFetch.mockResolvedValue({
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? canonical : null) },
    })
    const resolved = await resolveAmazonShortLink('https://amzn.asia/d/0hw5G7DL')
    expect(resolved).toBe(canonical)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][1].redirect).toBe('manual')
  })

  it('returns non-short URLs unchanged without fetching', async () => {
    const full = 'https://www.amazon.co.jp/dp/B0C7GQGGXK'
    const resolved = await resolveAmazonShortLink(full)
    expect(resolved).toBe(full)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back to the followed final URL when no Location header is present', async () => {
    const canonical = 'https://www.amazon.co.jp/dp/B0C7GQGGXK'
    mockFetch
      .mockResolvedValueOnce({ headers: { get: () => null } })       // manual redirect: no Location
      .mockResolvedValueOnce({ url: canonical, headers: { get: () => null } }) // follow: final url
    const resolved = await resolveAmazonShortLink('https://amzn.to/abc123')
    expect(resolved).toBe(canonical)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns the original URL when resolution throws', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const short = 'https://amzn.asia/d/0hw5G7DL'
    expect(await resolveAmazonShortLink(short)).toBe(short)
  })
})
