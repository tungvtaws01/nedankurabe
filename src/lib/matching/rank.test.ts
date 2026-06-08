import { similarity, rankBySimilarity } from './rank'
import { ProductResult } from '@/lib/types'

const p = (title: string): ProductResult => ({
  platform: 'rakuten', title, imageUrl: '', shopName: '', salePrice: 0,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
  effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: true,
  teikiRates: null, taxRate: 1.1, affiliateUrl: title,
})

describe('similarity', () => {
  it('scores shared numeric tokens (weight/count) highly across languages', () => {
    // English Amazon title vs Japanese Rakuten title sharing 780 + 2
    const s = similarity('Meiji Hohoemi Powder 780g x 2 Cans', '明治ほほえみ(780g×2缶)')
    expect(s).toBeGreaterThan(0)
  })

  it('returns 0 when nothing overlaps at all', () => {
    expect(similarity('Easy Cube 1620g', 'パンパース テープ')).toBe(0)
  })

  it('rewards same-language word overlap', () => {
    const shared = similarity('パンパース さらさら テープ S', 'パンパース さらさら テープ S 84枚')
    const none = similarity('パンパース さらさら テープ S', 'メリーズ パンツ M')
    expect(shared).toBeGreaterThan(none)
  })
})

describe('rankBySimilarity', () => {
  it('promotes the candidate sharing size/count numbers to the front', () => {
    const source = p('Meiji Hohoemi Powder 780g x 2 Cans')
    const ranked = rankBySimilarity(source, [
      p('明治ほほえみ らくらくキューブ(27g×60袋)'),
      p('明治ほほえみ(780g×2缶)'),       // shares 780 + 2 → best
      p('明治ほほえみ らくらくミルク(240ml×24缶)'),
    ])
    expect(ranked[0].title).toBe('明治ほほえみ(780g×2缶)')
  })

  it('is stable — preserves input order when no candidate has any signal', () => {
    const source = p('XYZ totally unrelated source')
    const input = [p('明治A'), p('明治B'), p('明治C')]
    const ranked = rankBySimilarity(source, input)
    expect(ranked.map((r) => r.title)).toEqual(['明治A', '明治B', '明治C'])
  })
})
