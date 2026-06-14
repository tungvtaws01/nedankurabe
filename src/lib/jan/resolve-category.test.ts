import { resolveCategory } from './resolve-category'

describe('resolveCategory', () => {
  it('tier 1: title regex wins when a keyword is present', () => {
    expect(resolveCategory('花王 メリーズ エアスルー パンツ Mサイズ52枚')).toBe('diapers')
    expect(resolveCategory('ピジョン 母乳実感 哺乳瓶 160ml')).toBe('bottles')
  })

  it('tier 1 beats tier 2: regex keyword overrides a conflicting genreId', () => {
    // Item mis-shelved in the おむつ genre (205197) but it is actually wipes.
    expect(resolveCategory('純水99% おしりふき 80枚×3', '205197')).toBe('wipes')
  })

  it('tier 2: genreId fills the gap when regex is silent', () => {
    // No diaper keyword the regex recognises, but Rakuten genreId says おむつ.
    expect(resolveCategory('お買い得 まとめ買いセット 詰め替え', '205197')).toBe('diapers')
    expect(resolveCategory('限定デザイン 36枚', '401171')).toBe('formula')
  })

  it('tier 0: pollution/accessory is never rescued by genreId', () => {
    // EXCLUDE_KEYWORDS hit (e.g. お試し sample) → unknown even with a real genreId.
    expect(resolveCategory('パンパース お試し 2枚', '205197')).toBe('unknown')
  })

  it('tier 3: unmapped genre + no keyword → unknown', () => {
    expect(resolveCategory('ベビー枕 ドーナツ枕', '201591')).toBe('unknown') // toys genre, unmapped
    expect(resolveCategory('謎の雑貨')).toBe('unknown')
  })
})
