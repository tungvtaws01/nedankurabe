import { classifyLocal } from './classify-local'

describe('classifyLocal', () => {
  it('classifies brand-name diaper titles that lack the word おむつ', () => {
    // Real Rakuten titles that previously fell into "unknown" (brand + パンツ/テープ + N枚).
    expect(classifyLocal('P&Gジャパン パンパース さらさらパンツ スーパージャンボ Lサイズ')).toBe('diapers')
    expect(classifyLocal('ナチュラル ムーニー Sサイズ 58枚')).toBe('diapers')
    expect(classifyLocal('ムーニーマン低刺激であんしん ゆるうんちモレ安心パンツM 46枚')).toBe('diapers')
    expect(classifyLocal('花王 メリーズ エアスルー パンツ Mサイズ52枚入り')).toBe('diapers')
    expect(classifyLocal('大王製紙 グーン スイミング パンツ 男女共用 Mサイズ 12枚')).toBe('diapers')
    expect(classifyLocal('ユニ・チャーム マミーポコパンツM50枚ドラえもん')).toBe('diapers')
    expect(classifyLocal('GOONグーンスーパービッグ28枚入')).toBe('diapers')
  })

  it('handles full-width dash variants in brand names', () => {
    expect(classifyLocal('ム−ニ−マン Mたっち52枚')).toBe('diapers') // U+2212 minus
    expect(classifyLocal('ユニ・チャーム ム-ニ-マン エアフィット 男の子 ビッグ 38枚')).toBe('diapers') // hyphen
    expect(classifyLocal('マミ−ポコパンツ M50枚')).toBe('diapers')
  })

  it('still routes brand wipes to wipes (wipes rule wins over diaper brand)', () => {
    expect(classifyLocal('パンパース おしりふき 純水99% 80枚×3')).toBe('wipes')
    expect(classifyLocal('ムーニー おしりふき やわらか素材')).toBe('wipes')
  })

  it('keeps the existing consumable genres working', () => {
    expect(classifyLocal('明治ほほえみ らくらくキューブ 1.62kg')).toBe('formula')
    expect(classifyLocal('ピジョン 母乳実感 哺乳瓶 160ml')).toBe('bottles')
    expect(classifyLocal('和光堂 グーグーキッチン 鮭とじゃがいも')).toBe('baby_food')
    expect(classifyLocal('エルゴベビー 抱っこ紐 OMNI Breeze')).toBe('carriers')
  })

  it('returns unknown for genuinely out-of-scope products', () => {
    expect(classifyLocal('トラスコ中山 化粧ビス NO.3 白 M6×16')).toBe('unknown')
    expect(classifyLocal('キッズサークル 外枠 CK-F1050 ピンク')).toBe('unknown')
    expect(classifyLocal('ベビー枕 絶壁頭予防枕 ドーナツ枕')).toBe('unknown')
  })
})
