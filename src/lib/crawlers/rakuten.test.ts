const mockFetch = jest.fn()
global.fetch = mockFetch

import { crawlRakutenSearch, crawlRakutenProduct } from './rakuten'

// crawlRakutenSearch now delegates to the Rakuten Ichiba API (searchRakuten),
// which returns JSON: { Items: [{ Item: {...} }] } and is parsed by parseRakutenItem.
const SEARCH_API = JSON.stringify({
  Items: [
    {
      Item: {
        itemName: '明治ほほえみ 780g×2缶入',
        itemCode: 'netbaby:4902705129566',
        itemPrice: 5979,
        postageFlag: 1,
        pointRate: 1,
        itemUrl: 'https://item.rakuten.co.jp/netbaby/4902705129566/',
        smallImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/img.jpg' }],
        genreId: '100533',
      },
    },
    {
      Item: {
        itemName: 'パンパース テープ Sサイズ 108枚',
        itemCode: 'shop:item2',
        itemPrice: 880,
        postageFlag: 1,
        pointRate: 1,
        itemUrl: 'https://item.rakuten.co.jp/shop/item2/',
        smallImageUrls: [{ imageUrl: 'https://thumbnail.image.rakuten.co.jp/img2.jpg' }],
        genreId: '100533',
      },
    },
  ],
})

// Rakuten item pages use EUC-JP encoding; the new crawler uses og:title + itemprop price
// (both available in static HTML). We mock the response with an ArrayBuffer.
const ITEM_HTML_UTF8 = `
<html><head>
  <meta charset="UTF-8">
  <meta property="og:title" content="明治ほほえみ(780g×2缶入)：楽天24 ベビー館" />
  <meta property="og:image" content="https://thumbnail.image.rakuten.co.jp/item.jpg" />
</head><body>
  <span itemprop="price" content="5979">5,979</span>
</body></html>
`

beforeEach(() => {
  mockFetch.mockReset()
  // SCRAPER_API_KEY enables the proxy path for crawlRakutenProduct (HTML crawl).
  process.env.SCRAPER_API_KEY = 'test-key'
  // crawlRakutenSearch -> searchRakuten needs the Rakuten API credentials.
  process.env.RAKUTEN_APP_ID = 'test-app'
  process.env.RAKUTEN_ACCESS_KEY = 'test-key'
  // No affiliate id -> affiliateUrl is the raw item URL (deterministic for assertions).
  delete process.env.RAKUTEN_AFFILIATE_ID
})

describe('crawlRakutenSearch', () => {
  it('extracts title, price, points from the Rakuten API', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_API })
    const results = await crawlRakutenSearch('明治ほほえみ')
    expect(results).toHaveLength(2)
    expect(results[0].title).toBe('明治ほほえみ 780g×2缶入')
    expect(results[0].salePrice).toBe(5979)
    // Points from 1% base rate: floor(floor(5979/1.1) * 1/100) = floor(5435/100) = 54
    expect(results[0].pointsEarned).toBe(54)
    // price >= 3980 → free shipping heuristic
    expect(results[0].shippingCost).toBe(0)
    expect(results[0].effectivePrice).toBe(5979 - 54)
    expect(results[0].platform).toBe('rakuten')
    // No affiliate id configured → affiliateUrl is the raw item URL.
    expect(results[0].affiliateUrl).toBe('https://item.rakuten.co.jp/netbaby/4902705129566/')
  })

  it('charges 700 shipping when price < 3980', async () => {
    mockFetch.mockResolvedValue({ ok: true, text: async () => SEARCH_API })
    const results = await crawlRakutenSearch('パンパース')
    // item2 has price 880 < 3980 and postageFlag 1 → shipping 700
    // points: floor(floor(880/1.1) * 1/100) = floor(799/100) = 7  (880/1.1 = 799.99… in IEEE-754)
    expect(results[1].shippingCost).toBe(700)
    expect(results[1].effectivePrice).toBe(880 + 700 - 7)
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
  it('extracts title and price from og:title + itemprop:price in static HTML', async () => {
    // New crawler uses arrayBuffer() + TextDecoder for EUC-JP encoding support
    const encoder = new TextEncoder()
    const buf = encoder.encode(ITEM_HTML_UTF8).buffer
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => h === 'content-type' ? 'text/html; charset=UTF-8' : null },
      arrayBuffer: async () => buf,
    })
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/netbaby/4902705129566/')
    expect(result).not.toBeNull()
    // og:title "明治ほほえみ(780g×2缶入)：楽天24 ベビー館" → split on "：" → first part
    expect(result!.title).toBe('明治ほほえみ(780g×2缶入)')
    expect(result!.salePrice).toBe(5979)
    // Points estimated from 1% base rate: floor(floor(5979/1.1)/100) = 54
    expect(result!.pointsEarned).toBe(54)
    // price >= 3980 → free shipping heuristic
    expect(result!.shippingCost).toBe(0)
  })

  it('returns null when fetch fails', async () => {
    mockFetch.mockRejectedValue(new Error('network'))
    const result = await crawlRakutenProduct('https://item.rakuten.co.jp/x/y/')
    expect(result).toBeNull()
  })
})
