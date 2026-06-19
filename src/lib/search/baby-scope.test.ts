import { isBabyQuery } from './baby-scope'

describe('isBabyQuery', () => {
  it.each([
    'パンパース テープ',
    '明治ほほえみ',
    'エルゴ抱っこ紐',
    'おしりふき',
    'ベビーカー',
    '哺乳瓶',
    '離乳食',
    'チャイルドシート',
  ])('treats baby query "%s" as baby', (q) => {
    expect(isBabyQuery(q)).toBe(true)
  })

  it.each([
    'コーヒー',
    'iPhone',
    'テレビ',
    'ノートパソコン',
  ])('treats off-topic query "%s" as not baby', (q) => {
    expect(isBabyQuery(q)).toBe(false)
  })
})

describe('isBabyQuery — formula brand-lines (regression: 和光堂 はいはい was rejected)', () => {
  it.each([
    'はいはい',
    '和光堂 はいはい',
    'レーベンスミルク',
    '和光堂 レーベンスミルク はいはい',
  ])('treats %s as a baby query', (kw) => {
    expect(isBabyQuery(kw)).toBe(true)
  })

  it.each(['コーヒー', 'ノートパソコン', '日本酒'])('treats off-topic %s as non-baby', (kw) => {
    expect(isBabyQuery(kw)).toBe(false)
  })
})
