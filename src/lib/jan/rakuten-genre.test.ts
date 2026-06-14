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

  it('returns null for out-of-scope and unknown genres (so regex/LLM decide)', () => {
    expect(categoryFromGenreId('201591')).toBeNull() // toys
    expect(categoryFromGenreId('566882')).toBeNull() // baby chair
    expect(categoryFromGenreId('407002')).toBeNull() // bibs
    expect(categoryFromGenreId('100533')).toBeNull() // default umbrella
    expect(categoryFromGenreId('999999')).toBeNull() // unrecognised
  })

  it('handles null/undefined/numeric inputs', () => {
    expect(categoryFromGenreId(null)).toBeNull()
    expect(categoryFromGenreId(undefined)).toBeNull()
    expect(categoryFromGenreId('')).toBeNull()
    // numeric genreId coerces to string
    expect(categoryFromGenreId(205197 as unknown as string)).toBe('diapers')
  })
})
