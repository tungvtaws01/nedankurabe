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
