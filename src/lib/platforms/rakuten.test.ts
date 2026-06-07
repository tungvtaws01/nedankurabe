import { parseRakutenItem, isTrialOrSamplePack, getGenreId } from './rakuten'

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

describe('getGenreId', () => {
  it('maps おむつ to diaper genre 205197', () => {
    expect(getGenreId('パンパース おむつ テープ Sサイズ')).toBe('205197')
  })

  it('maps おしりふき to wipes genre 205194', () => {
    expect(getGenreId('おしりふき 水99% ベビー')).toBe('205194')
  })

  it('maps 哺乳瓶 to nursing genre 205208', () => {
    expect(getGenreId('ピジョン 哺乳瓶 160ml')).toBe('205208')
  })

  it('maps 乳首 to nursing genre 205208', () => {
    expect(getGenreId('ピジョン 母乳実感 乳首 Mサイズ')).toBe('205208')
  })

  it('maps ブレンダー to no-genre (0) since real blenders live in kitchen category', () => {
    expect(getGenreId('ハンドブレンダー 離乳食 ブレンダー')).toBe('0')
  })

  it('maps 離乳食 to baby food genre 213980', () => {
    expect(getGenreId('和光堂 ハイハイン 赤ちゃん用')).toBe('213980')
  })

  it('maps ストローマグ to straw cup genre 207753', () => {
    expect(getGenreId('ピジョン ストローマグ')).toBe('207753')
  })

  it('maps コップマグ to straw cup genre 207753', () => {
    expect(getGenreId('ピジョン コップマグ')).toBe('207753')
  })

  it('maps マグマグ (no ストロー) to tableware genre 207750', () => {
    expect(getGenreId('ピジョン マグマグ')).toBe('207750')
  })

  it('maps 抱っこ紐 to carrier genre 566089', () => {
    expect(getGenreId('エルゴベビー 抱っこ紐 新生児')).toBe('566089')
  })

  it('maps ベビーカー to stroller genre 200833', () => {
    expect(getGenreId('コンビ ベビーカー 軽量')).toBe('200833')
  })

  it('maps 歯ブラシ to dental genre 551691', () => {
    expect(getGenreId('ピジョン 歯ブラシ 仕上げ磨き')).toBe('551691')
  })

  it('maps メリー to baby toy genre 201591', () => {
    expect(getGenreId('タカラトミー メリー ベビー')).toBe('201591')
  })

  it('maps プレイマット to baby interior genre 566090', () => {
    expect(getGenreId('プレイマット ベビー 折りたたみ')).toBe('566090')
  })

  it('maps バウンサー to bouncer genre 213968', () => {
    expect(getGenreId('バウンサー ベビー 電動')).toBe('213968')
  })

  it('maps バンボ to baby chair genre 566882', () => {
    expect(getGenreId('バンボ ベビーソファ')).toBe('566882')
  })

  it('defaults to baby category 100533 for unknown keywords', () => {
    expect(getGenreId('ベビー用品 その他')).toBe('100533')
  })
})

describe('isTrialOrSamplePack — spare parts', () => {
  it('flags 補給部品', () => {
    expect(isTrialOrSamplePack('ブレンダー 補給部品 スウィッツプロッツ')).toBe(true)
  })

  it('flags 替刃', () => {
    expect(isTrialOrSamplePack('離乳食ブレンダー パパっとクック 替刃 専用パーツ')).toBe(true)
  })

  it('flags 専用パーツ', () => {
    expect(isTrialOrSamplePack('EDIMOTTO ブレード 専用パーツ 赤ちゃん')).toBe(true)
  })

  it('flags パーツ販売', () => {
    expect(isTrialOrSamplePack('離乳食ブレンダー パパっとクック ブレード [パーツ販売]')).toBe(true)
  })

  it('flags パッキン gasket replacement', () => {
    expect(isTrialOrSamplePack('ピジョン ストローボトル 専用替えパッキン 2個入')).toBe(true)
  })

  it('flags 拡張フレーム extension frame', () => {
    expect(isTrialOrSamplePack('日本育児 スマートゲイト2 手すりよけ拡張フレーム')).toBe(true)
  })

  it('flags 専用プレートレイ tray accessory', () => {
    expect(isTrialOrSamplePack('バンボ Bumbo ベビーソファ 専用プレートレイ')).toBe(true)
  })

  it('does not flag full blender product', () => {
    expect(isTrialOrSamplePack('ブラウン ハンドブレンダー マルチクイック 離乳食 スムージー')).toBe(false)
  })

  it('does not flag full Bumbo seat', () => {
    expect(isTrialOrSamplePack('バンボ マルチシート ベビーソファ 日本正規品')).toBe(false)
  })

  it('flags ふるさと納税 tax donation bundles', () => {
    expect(isTrialOrSamplePack('【ふるさと納税】明治ほほえみ 2缶パック 780g×2缶')).toBe(true)
  })
})
