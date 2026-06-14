import { normalizeBrand, brandsAreDistinct } from './brand-aliases'

describe('normalizeBrand', () => {
  it('maps JP and EN surface forms to the same canonical id', () => {
    expect(normalizeBrand('P&Gジャパン パンパース テープ Mサイズ')).toBe('pampers')
    expect(normalizeBrand('Pampers Baby Dry Tape M')).toBe('pampers')
  })
  it('is case-insensitive for latin aliases', () => {
    expect(normalizeBrand('babydan ベビーゲート')).toBe('babydan')
    expect(normalizeBrand('BABYDAN gate')).toBe('babydan')
  })
  it('returns null when no known brand appears', () => {
    expect(normalizeBrand('謎の無名ブランド プレイマット 180×200')).toBeNull()
  })
  it('keeps KIRKLAND and RICO as DISTINCT canonical ids', () => {
    expect(normalizeBrand('カークランド おしりふき 100枚')).toBe('kirkland')
    expect(normalizeBrand('RICO ベビー おしりふき')).toBe('rico')
    expect(normalizeBrand('カークランド')).not.toBe(normalizeBrand('RICO'))
  })
  it('does not match ASCII aliases as substrings of longer words', () => {
    expect(normalizeBrand('ergonomic pillow')).toBeNull()        // not ergobaby (ergo)
    expect(normalizeBrand('vermillion paint set')).toBeNull()    // not lion
    expect(normalizeBrand('combination playmat 200')).toBeNull() // not combi
    expect(normalizeBrand('apricot baby snack')).toBeNull()      // not rico
  })
  it('still matches ASCII aliases as whole words and all JP forms', () => {
    expect(normalizeBrand('Combi ベビーカー')).toBe('combi')
    expect(normalizeBrand('Ergo 抱っこ紐')).toBe('ergobaby')
    expect(normalizeBrand('RICO おしりふき 100枚')).toBe('rico')
    expect(normalizeBrand('BABYDAN gate')).toBe('babydan')
    expect(normalizeBrand('パンパース テープ')).toBe('pampers')
  })
})

describe('brandsAreDistinct', () => {
  it('true only when BOTH titles name a known brand and they differ', () => {
    expect(brandsAreDistinct('カークランド おしりふき', 'RICO おしりふき')).toBe(true)
    expect(brandsAreDistinct('パンパース テープ M', 'Pampers Tape M')).toBe(false)
  })
  it('false when either side has no known brand (defer to LLM)', () => {
    expect(brandsAreDistinct('無名 プレイマット', 'パンパース テープ')).toBe(false)
    expect(brandsAreDistinct('無名 A', '無名 B')).toBe(false)
  })
})
