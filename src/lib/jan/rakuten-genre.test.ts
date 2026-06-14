import { categoryFromGenreId } from './rakuten-genre'

describe('categoryFromGenreId', () => {
  it('maps parent baby genre ids to our categories', () => {
    expect(categoryFromGenreId('205197')).toBe('diapers')
    expect(categoryFromGenreId('205194')).toBe('wipes')
    expect(categoryFromGenreId('401171')).toBe('formula')
    expect(categoryFromGenreId('568293')).toBe('formula')
    expect(categoryFromGenreId('213980')).toBe('baby_food')
    expect(categoryFromGenreId('205208')).toBe('bottles')
    expect(categoryFromGenreId('207753')).toBe('bottles')
    expect(categoryFromGenreId('200833')).toBe('strollers')
    expect(categoryFromGenreId('566089')).toBe('carriers')
    expect(categoryFromGenreId('566088')).toBe('car_seats')
    expect(categoryFromGenreId('205205')).toBe('skincare')
    expect(categoryFromGenreId('401166')).toBe('skincare')
  })

  it('maps LEAF (child) genre ids — the ids items actually carry', () => {
    expect(categoryFromGenreId('205198')).toBe('diapers')   // おむつ child
    expect(categoryFromGenreId('205199')).toBe('diapers')
    expect(categoryFromGenreId('205209')).toBe('bottles')   // 哺乳びん child
    expect(categoryFromGenreId('213952')).toBe('strollers') // ベビーカー child
    expect(categoryFromGenreId('412209')).toBe('carriers')  // 抱っこひも child
    expect(categoryFromGenreId('203056')).toBe('car_seats') // チャイルドシート child
  })

  it('maps the 2026-06-14 scope-expansion genres', () => {
    expect(categoryFromGenreId('407003')).toBe('bibs')        // スタイ
    expect(categoryFromGenreId('207751')).toBe('tableware')   // ベビー食器
    expect(categoryFromGenreId('213963')).toBe('baby_chair')  // ベビーチェア
    expect(categoryFromGenreId('213968')).toBe('bouncer')     // バウンサー
    expect(categoryFromGenreId('201591')).toBe('toys')        // おもちゃ
    expect(categoryFromGenreId('551692')).toBe('toothbrush')  // pure 歯ブラシ leaf
    expect(categoryFromGenreId('551695')).toBe('toothpaste')  // pure ジェル歯みがき leaf
  })

  it('maps bath but NOT the noisy niche genres (those are title-regex-only)', () => {
    expect(categoryFromGenreId('505410')).toBe('bath')        // ベビーソープ (clean)
    expect(categoryFromGenreId('505413')).toBe('bath')        // ベビーシャンプー
    // niche genres unmapped on purpose — too many accessories/mis-tags to trust genreId
    expect(categoryFromGenreId('207739')).toBeNull()          // 鼻吸い器
    expect(categoryFromGenreId('567569')).toBeNull()          // 体温計
    expect(categoryFromGenreId('200841')).toBeNull()          // ベビーゲート
    expect(categoryFromGenreId('568495')).toBeNull()          // プレイマット
  })

  it('returns null for still-out-of-scope and unknown genres', () => {
    expect(categoryFromGenreId('100533')).toBeNull() // default umbrella
    expect(categoryFromGenreId('566090')).toBeNull() // ベビーインテリア
    expect(categoryFromGenreId('0')).toBeNull()      // no-genre sentinel
    expect(categoryFromGenreId('999999')).toBeNull() // unrecognised
    expect(categoryFromGenreId('551696')).toBeNull() // mixed dental leaf (tablets) → regex decides
  })

  it('handles null/undefined/numeric inputs', () => {
    expect(categoryFromGenreId(null)).toBeNull()
    expect(categoryFromGenreId(undefined)).toBeNull()
    expect(categoryFromGenreId('')).toBeNull()
    // numeric genreId coerces to string
    expect(categoryFromGenreId(205197 as unknown as string)).toBe('diapers')
  })
})
