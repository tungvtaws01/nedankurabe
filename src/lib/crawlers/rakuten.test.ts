const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlRakutenSearch, crawlRakutenProduct } from './rakuten'

const SEARCH_HTML = `
<html><body>
<div class="searchresultitem">
  <h2 class="title"><a href="https://item.rakuten.co.jp/netbaby/4902705129566/">明治ほほえみ 780g×2缶入</a></h2>
  <img src="https://thumbnail.image.rakuten.co.jp/img.jpg" />
  <span class="important">5,979</span>
  <span class="free-delivery">送料無料</span>
  <span class="point"><strong>553</strong>ポイント</span>
</div>
<div class="searchresultitem">
  <h2 class="title"><a href="https://item.rakuten.co.jp/shop/item2/">パンパース テープ Sサイズ 108枚</a></h2>
  <img src="https://thumbnail.image.rakuten.co.jp/img2.jpg" />
  <span class="important">3,980</span>
  <span class="point"><strong>36</strong>ポイント</span>
</div>
</body></html>
`

const ITEM_HTML = `
<html><body>
  <h1 itemprop="name">明治ほほえみ(780g×2缶入)</h1>
  <span itemprop="price" content="5979">5,979</span>
  <img id="rakutenLogo" /><img src="https://thumbnail.image.rakuten.co.jp/item.jpg" />
  <div id="point"><strong>553</strong>ポイント</div>
  <span id="free-deliver">送料無料</span>
</body></html>
`

beforeEach(() => {
  mockFetch.mockReset()
})

describe('crawlRakutenSearch', () => {
  it('extracts title, price, points, shipping from search page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('明治ほほえみ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('明治ほほえみ 780g×2缶入')
    expect(results[0].salePrice).toBe(5979)
    expect(results[0].pointsEarned).toBe(553)
    expect(results[0].shippingCost).toBe(0)
    expect(results[0].effectivePrice).toBe(5979 - 553)
    expect(results[0].platform).toBe('rakuten')
  })

  it('charges 490 shipping when free-delivery absent', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('パンパース')
    expect(results[1].shippingCost).toBe(490)
    expect(results[1].effectivePrice).toBe(3980 + 490 - 36)
  })

  it('returns empty array when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const results = await crawlRakutenSearch('test')
    expect(results).toEqual([])
  })

  it('returns empty array when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, text: async () => '' })
    const results = await crawlRakutenSearch('test')
    expect(results).toEqual([])
  })
})

describe('crawlRakutenProduct', () => {
  it('extracts title, price, points from item page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => ITEM_HTML })
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/netbaby/4902705129566/')
    expect(result).not.toBeNull()
    expect(result!.title).toBe('明治ほほえみ(780g×2缶入)')
    expect(result!.salePrice).toBe(5979)
    expect(result!.pointsEarned).toBe(553)
    expect(result!.shippingCost).toBe(0)
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/x/y/')
    expect(result).toBeNull()
  })
})
