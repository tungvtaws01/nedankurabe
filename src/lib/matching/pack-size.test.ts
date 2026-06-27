import { parsePackSize, sizeRelation, packCloseness } from './pack-size'

describe('parsePackSize', () => {
  it.each([
    ['明治ほほえみ（780g×2パック）', 'g', 1560],
    ['明治ほほえみ らくらくキューブ(27g×60袋入)', 'g', 1620],
    ['明治ほほえみ らくらくキューブ 27g×4袋入', 'g', 108],
    ['明治ほほえみ らくらくミルク ケース販売(240ml×24缶)', 'ml', 5760],
    ['明治 ほほえみ 2缶パック 1560g（780g（大缶）×2缶）×4個（1ケース）', 'g', 6240], // nested parens, no double-count
    ['森永 はぐくみ 大缶 810g×3個セット', 'g', 2430],
    ['マミーポコ夜用パンツビッグ大 22枚', '枚', 22],
    ['グーン Mサイズ テープ 52枚', '枚', 52],
    ['メリーズ エアスルー パンツ Mサイズ 156枚 52枚×3袋', '枚', 156], // total + breakdown
    ['ユニ・チャーム ムーニーおしりふき 詰替64枚×3', '枚', 192], // base × mult
    ['【パンツ】メリーズパンツ Mサイズ(6~11kg) 58枚', '枚', 58], // kg-range excluded
  ])('parses %s', (title, dim, total) => {
    expect(parsePackSize(title)).toEqual({ dimension: dim, total })
  })

  it.each([
    '明治 ほほえみ らくらくミルク アタッチメントII',
    '森永 はぐくみ エコらくパック つめかえ用(400g*2袋入)×3個セット', // all measures inside parens → unknown
  ])('returns null for unparseable %s', (title) => {
    expect(parsePackSize(title)).toEqual({ dimension: null, total: null })
  })
})

describe('sizeRelation', () => {
  const g = (total: number | null) => ({ dimension: 'g' as const, total })
  it('exact within ±25%', () => {
    expect(sizeRelation(g(1620), g(1560))).toBe('exact')   // ratio 0.96
    expect(sizeRelation(g(1000), g(800))).toBe('exact')    // ratio 0.8 (boundary)
  })
  it('different outside band', () => {
    expect(sizeRelation(g(3240), g(108))).toBe('different') // 30x
    expect(sizeRelation(g(1000), g(2000))).toBe('different')
  })
  it('unknown when a total is null or dimensions differ', () => {
    expect(sizeRelation(g(1000), g(null))).toBe('unknown')
    expect(sizeRelation(g(1000), { dimension: 'ml', total: 1000 })).toBe('unknown')
  })
})

describe('packCloseness', () => {
  it('0 for identical, larger for farther, Infinity for unknown', () => {
    const g = (total: number | null) => ({ dimension: 'g' as const, total })
    expect(packCloseness(g(1000), g(1000))).toBe(0)
    expect(packCloseness(g(1000), g(2000))).toBeGreaterThan(packCloseness(g(1000), g(1200)))
    expect(packCloseness(g(1000), g(null))).toBe(Infinity)
  })
})
