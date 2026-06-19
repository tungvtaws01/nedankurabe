import { BABY_GENRE_IDS, isBabyGenre } from './rakuten'

describe('BABY_GENRE_IDS allow-set', () => {
  it('includes specific baby genres', () => {
    expect(BABY_GENRE_IDS.has('401171')).toBe(true) // 粉ミルク
    expect(BABY_GENRE_IDS.has('205197')).toBe(true) // おむつ
  })
  it('excludes the broad gift-leaking genres', () => {
    expect(BABY_GENRE_IDS.has('100533')).toBe(false)
    expect(BABY_GENRE_IDS.has('0')).toBe(false)
  })
  it('isBabyGenre handles numeric and missing ids', () => {
    expect(isBabyGenre(401171)).toBe(true)
    expect(isBabyGenre('100533')).toBe(false)
    expect(isBabyGenre(undefined)).toBe(false)
  })
})
