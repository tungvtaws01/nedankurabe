import { parseRakutenItem } from './rakuten'

const MOCK = {
  itemName: 'パンパース オムツ はじめての肌へのいちばん テープ S 108枚',
  itemPrice: 3980,
  postageFlag: 0,
  pointRate: 30,
  couponFlag: 0,
  smallImageUrls: [{ imageUrl: 'https://example.com/img.jpg' }],
  shopName: '楽天24 ベビー館',
  itemCode: 'rakuten24:4987176206206',
  itemUrl: 'https://item.rakuten.co.jp/rakuten24/4987176206206/',
}

describe('parseRakutenItem', () => {
  it('extracts platform and title', () => {
    const r = parseRakutenItem(MOCK, 'aff-id')
    expect(r.platform).toBe('rakuten')
    expect(r.title).toBe('パンパース オムツ はじめての肌へのいちばん テープ S 108枚')
  })

  it('shippingCost is 0 when postageFlag=0', () => {
    expect(parseRakutenItem(MOCK, 'id').shippingCost).toBe(0)
  })

  it('shippingCost is 490 when postageFlag=1', () => {
    expect(parseRakutenItem({ ...MOCK, postageFlag: 1 }, 'id').shippingCost).toBe(490)
  })

  it('pointRate matches API field', () => {
    expect(parseRakutenItem(MOCK, 'id').pointRate).toBe(30)
  })

  it('pointsEarned = floor(taxExcluded × pointRate / 100)', () => {
    // floor(3980/1.1)=3618; floor(3618×30/100)=1085
    expect(parseRakutenItem(MOCK, 'id').pointsEarned).toBe(1085)
  })

  it('effectivePrice = salePrice - points at defaults (free shipping)', () => {
    // 3980 + 0 - 1085 = 2895
    expect(parseRakutenItem(MOCK, 'id').effectivePrice).toBe(2895)
  })

  it('rakutenCardEligible is true', () => {
    expect(parseRakutenItem(MOCK, 'id').rakutenCardEligible).toBe(true)
  })

  it('affiliateUrl wraps itemUrl when affiliateId provided', () => {
    const url = parseRakutenItem(MOCK, 'aff123').affiliateUrl
    expect(url).toContain('aff123')
    expect(url).toContain(encodeURIComponent('https://item.rakuten.co.jp'))
  })

  it('affiliateUrl falls back to itemUrl when no affiliateId', () => {
    expect(parseRakutenItem(MOCK, '').affiliateUrl).toBe(MOCK.itemUrl)
  })
})
