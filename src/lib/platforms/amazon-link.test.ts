import { buildAmazonAffiliateUrl, buildAmazonLinkResult } from './amazon-link'

describe('buildAmazonAffiliateUrl', () => {
  const ORIG = process.env.AMAZON_PARTNER_TAG
  afterEach(() => { process.env.AMAZON_PARTNER_TAG = ORIG })

  it('returns a tagged /dp/ URL when the tag is set', () => {
    process.env.AMAZON_PARTNER_TAG = 'nedankurabe-22'
    expect(buildAmazonAffiliateUrl('B0C7GQGGXK'))
      .toBe('https://www.amazon.co.jp/dp/B0C7GQGGXK?tag=nedankurabe-22')
  })

  it('returns null when the tag is missing (never emit an untagged link)', () => {
    delete process.env.AMAZON_PARTNER_TAG
    expect(buildAmazonAffiliateUrl('B0C7GQGGXK')).toBeNull()
  })
})

describe('buildAmazonLinkResult', () => {
  const ORIG = process.env.AMAZON_PARTNER_TAG
  beforeEach(() => { process.env.AMAZON_PARTNER_TAG = 'nedankurabe-22' })
  afterEach(() => { process.env.AMAZON_PARTNER_TAG = ORIG })

  it('builds a link-only Amazon result with a tagged URL and no price', () => {
    const r = buildAmazonLinkResult({ asin: 'B0C7GQGGXK', title: 'メリーズ M 64枚', imageUrl: 'https://thumbnail.image.rakuten.co.jp/x.jpg' })
    expect(r.platform).toBe('amazon')
    expect(r.priceUnavailable).toBe(true)
    expect(r.salePrice).toBe(0)
    expect(r.effectivePrice).toBe(0)
    expect(r.imageUrl).toBe('https://thumbnail.image.rakuten.co.jp/x.jpg')
    expect(r.affiliateUrl).toBe('https://www.amazon.co.jp/dp/B0C7GQGGXK?tag=nedankurabe-22')
  })

  it('emits an empty affiliateUrl when no tag is configured', () => {
    delete process.env.AMAZON_PARTNER_TAG
    const r = buildAmazonLinkResult({ asin: 'B0C7GQGGXK', title: 't', imageUrl: '' })
    expect(r.affiliateUrl).toBe('')
  })
})
