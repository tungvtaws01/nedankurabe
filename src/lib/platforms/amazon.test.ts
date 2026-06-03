import { parseAmazonItem } from './amazon'

const MOCK_ITEM = {
  ASIN: 'B0CCJ3KBN3',
  ItemInfo: { Title: { DisplayValue: 'パンパース テープ S 54枚' } },
  Images: { Primary: { Medium: { URL: 'https://example.com/img.jpg' } } },
  Offers: {
    Listings: [{
      Price: { Amount: 1791 },
      DeliveryInfo: { IsFreeShippingEligible: true },
      MerchantInfo: { Name: 'Amazon.co.jp' },
      ProgramEligibility: { IsAmazonFulfilled: true },
    }],
  },
}

describe('parseAmazonItem', () => {
  it('extracts platform and title', () => {
    const r = parseAmazonItem(MOCK_ITEM, 'mytag-22')
    expect(r.platform).toBe('amazon')
    expect(r.title).toBe('パンパース テープ S 54枚')
  })

  it('salePrice from listing Amount', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').salePrice).toBe(1791)
  })

  it('shippingCost is 0 when IsFreeShippingEligible=true', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').shippingCost).toBe(0)
  })

  it('shippingCost is 490 when IsFreeShippingEligible=false', () => {
    const item = { ...MOCK_ITEM, Offers: { Listings: [{ ...MOCK_ITEM.Offers.Listings[0], DeliveryInfo: { IsFreeShippingEligible: false } }] } }
    expect(parseAmazonItem(item, 'tag').shippingCost).toBe(490)
  })

  it('pointRate is always 1', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').pointRate).toBe(1)
  })

  it('pointsEarned = round(salePrice × 0.01)', () => {
    // round(1791 × 0.01) = 18
    expect(parseAmazonItem(MOCK_ITEM, 'tag').pointsEarned).toBe(18)
  })

  it('effectivePrice = salePrice - points at defaults', () => {
    // 1791 - 18 = 1773
    expect(parseAmazonItem(MOCK_ITEM, 'tag').effectivePrice).toBe(1773)
  })

  it('affiliateUrl contains ASIN and partner tag', () => {
    const url = parseAmazonItem(MOCK_ITEM, 'mytag-22').affiliateUrl
    expect(url).toContain('B0CCJ3KBN3')
    expect(url).toContain('mytag-22')
  })

  it('subscribeAvailable reflects IsAmazonFulfilled', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').subscribeAvailable).toBe(true)
  })
})
