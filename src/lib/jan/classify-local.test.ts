import { classifyLocal } from './classify-local'

describe('classifyLocal scored lexicon', () => {
  it('formula brand-lines win', () => {
    expect(classifyLocal('和光堂 レーベンスミルク はいはい 810g×8缶')).toBe('formula')
  })
  it('weaning dish with 離乳食 word still classifies as tableware (specificity beats baby_food)', () => {
    expect(classifyLocal('ベビー食器 離乳食 スプーン セット')).toBe('tableware')
  })
  it('diaper brand without the word おむつ', () => {
    expect(classifyLocal('メリーズ パンツ Mサイズ 58枚')).toBe('diapers')
  })
  it('unrelated text → unknown', () => {
    expect(classifyLocal('ノートパソコン 15インチ')).toBe('unknown')
  })
})

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

  it('splits dental into toothbrush vs toothpaste by the title type-word', () => {
    expect(classifyLocal('クリニカKid\'s ハブラシ 0-2才用')).toBe('toothbrush')
    expect(classifyLocal('ピジョン はじめての仕上げ専用 電動歯ブラシ')).toBe('toothbrush')
    expect(classifyLocal('ピジョン ジェル状歯みがき ぶどう味 40ml')).toBe('toothpaste')
    expect(classifyLocal('丹平製薬 こどもハミガキ上手 いちご味 180ml')).toBe('toothpaste')
  })

  it('classifies the other scope-expansion genres', () => {
    expect(classifyLocal('マールマール スタイ よだれかけ 360度')).toBe('bibs')
    expect(classifyLocal('リッチェル ベビー食器 離乳食セット')).toBe('tableware')
    expect(classifyLocal('大和屋 すくすくローチェア ベビーチェア')).toBe('baby_chair')
    expect(classifyLocal('ベビービョルン バウンサー Bliss')).toBe('bouncer')
    expect(classifyLocal('フィッシャープライス ベビージム おもちゃ')).toBe('toys')
  })

  it('does NOT misroute メリーズ (diaper) to toys via メリー', () => {
    expect(classifyLocal('花王 メリーズ パンツ Mサイズ 58枚')).toBe('diapers')
  })

  it('classifies the newly-enumerated genres', () => {
    expect(classifyLocal('シースター ベビースマイル メルシーポット 電動鼻吸い器 S-504')).toBe('nasal_aspirator')
    expect(classifyLocal('ピジョン 耳チビオン 耳式体温計')).toBe('thermometer')
    expect(classifyLocal('日本育児 スルする～とゲイト ベビーゲート')).toBe('safety_gate')
    expect(classifyLocal('CARAZ カラズ プレイマット 折りたたみ')).toBe('playmat')
  })

  it('does NOT route プレイマット to toys (プレイジム is toys, プレイマット is playmat)', () => {
    expect(classifyLocal('ジョイントマット 大判 ベビー playmat')).toBe('playmat')
    expect(classifyLocal('フィッシャープライス プレイジム ジム おもちゃ')).toBe('toys')
  })

  it('returns unknown for genuinely out-of-scope products', () => {
    expect(classifyLocal('トラスコ中山 化粧ビス NO.3 白 M6×16')).toBe('unknown')
    expect(classifyLocal('キッズサークル 外枠 CK-F1050 ピンク')).toBe('unknown')
    expect(classifyLocal('ベビー枕 絶壁頭予防枕 ドーナツ枕')).toBe('unknown')
  })
})
