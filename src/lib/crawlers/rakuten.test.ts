const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlRakutenSearch, crawlRakutenProduct } from './rakuten'

// Rakuten search page uses JSON-LD for structured data (stable, SEO-driven)
// Points are JavaScript-rendered and not in initial HTML.
const SEARCH_HTML = `
<html><body>
<script type="application/ld+json">
{
  "@type": "ItemList",
  "itemListElement": [
    {
      "@type": "ListItem",
      "position": 1,
      "item": {
        "@type": "Product",
        "name": "明治ほほえみ 780g×2缶入",
        "url": "https://item.rakuten.co.jp/netbaby/4902705129566/?scid=test",
        "image": ["https://thumbnail.image.rakuten.co.jp/img.jpg"],
        "offers": { "@type": "Offer", "price": 5979, "priceCurrency": "JPY" }
      }
    },
    {
      "@type": "ListItem",
      "position": 2,
      "item": {
        "@type": "Product",
        "name": "パンパース テープ Sサイズ 108枚",
        "url": "https://item.rakuten.co.jp/shop/item2/",
        "image": "https://thumbnail.image.rakuten.co.jp/img2.jpg",
        "offers": { "@type": "Offer", "price": 880, "priceCurrency": "JPY" }
      }
    }
  ]
}
</script>
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
  // Enable proxy path so crawlRakutenSearch exercises JSON-LD crawl logic
  process.env.SCRAPER_API_KEY = 'test-key'
})

describe('crawlRakutenSearch', () => {
  it('extracts title, price, shipping from JSON-LD on search page', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('明治ほほえみ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('明治ほほえみ 780g×2缶入')
    expect(results[0].salePrice).toBe(5979)
    // Points are JS-rendered on search page — set to 0, accurate on item page tap
    expect(results[0].pointsEarned).toBe(0)
    // price >= 3980 → free shipping heuristic
    expect(results[0].shippingCost).toBe(0)
    expect(results[0].effectivePrice).toBe(5979)
    expect(results[0].platform).toBe('rakuten')
    // tracking params stripped from URL
    expect(results[0].affiliateUrl).not.toContain('?scid=')
  })

  it('charges 490 shipping when price < 3980', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_HTML })
    const results = await crawlRakutenSearch('パンパース')
    // item2 has price 880 < 3980 → shipping 490
    expect(results[1].shippingCost).toBe(490)
    expect(results[1].effectivePrice).toBe(880 + 490)
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
