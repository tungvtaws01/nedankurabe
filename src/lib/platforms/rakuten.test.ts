import { parseRakutenItem, isTrialOrSamplePack } from './rakuten'

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

describe('isTrialOrSamplePack', () => {
  it('flags お試し', () => {
    expect(isTrialOrSamplePack('パンパース テープ 7枚 お試しセット バラ売り')).toBe(true)
  })

  it('flags バラ売り', () => {
    expect(isTrialOrSamplePack('メリーズ Sサイズ バラ売り 10枚')).toBe(true)
  })

  it('flags ポイント消化', () => {
    expect(isTrialOrSamplePack('パンパース 1枚 ポイント消化 送料無料')).toBe(true)
  })

  it('flags 試供品', () => {
    expect(isTrialOrSamplePack('おむつ 試供品 サンプル')).toBe(true)
  })

  it('flags 【中古】 used items', () => {
    expect(isTrialOrSamplePack('【中古】アシックス ファーストシューズ 12.5cm')).toBe(true)
  })

  it('flags 訳あり defective items', () => {
    expect(isTrialOrSamplePack('パンパース テープ Mサイズ 訳あり 送料無料')).toBe(true)
  })

  it('flags ジャンク junk items', () => {
    expect(isTrialOrSamplePack('ベビーカー ジャンク 部品取り')).toBe(true)
  })

  it('does not flag regular bulk pack', () => {
    expect(isTrialOrSamplePack('パンパース はじめての肌へのいちばん テープ Sサイズ 108枚')).toBe(false)
  })

  it('does not flag large case pack', () => {
    expect(isTrialOrSamplePack('花王 メリーズ テープ Sサイズ 296枚 ケース品 送料無料')).toBe(false)
  })

  it('flags 単品購入不可 non-standalone items', () => {
    expect(isTrialOrSamplePack('バンボ ベビーソファ 専用ラッピング【単品購入不可】')).toBe(true)
  })

  it('flags 購入者限定 buyer-only add-ons', () => {
    expect(isTrialOrSamplePack('【ハンドブレンダー購入者限定ラッピングオプション】ブレンダー専用ラッピング')).toBe(true)
  })

  it('does not flag new first shoes', () => {
    expect(isTrialOrSamplePack('アシックス キッズ スクスク ファーストシューズ 11.5cm 送料無料')).toBe(false)
  })
})
