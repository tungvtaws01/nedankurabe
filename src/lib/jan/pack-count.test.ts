import { parsePackCount } from './pack-count'

describe('parsePackCount', () => {
  it('reads ×N case-pack notations', () => {
    expect(parsePackCount('おむつ 66枚×4パック ケース')).toBe(4)
    expect(parsePackCount('粉ミルク 800g 2缶セット')).toBe(2)
    expect(parsePackCount('おしりふき 80枚×16個')).toBe(16)
  })
  it('defaults to 1 when no multiplier present', () => {
    expect(parsePackCount('抱っこ紐 エルゴ OMNI Breeze')).toBe(1)
    expect(parsePackCount('粉ミルク 800g')).toBe(1)
  })
  it('does not treat per-unit content (枚/g) as pack count', () => {
    expect(parsePackCount('おむつ Mサイズ 64枚')).toBe(1)
  })
  it('handles full-width digits (NFKC)', () => {
    expect(parsePackCount('粉ミルク ２缶セット')).toBe(2)
    expect(parsePackCount('おしりふき ８０枚×１６個')).toBe(16)
  })
})
