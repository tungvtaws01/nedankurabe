import { isValidJan13, extractJans } from './jan'

describe('isValidJan13', () => {
  it('accepts a valid JAN-13 (check digit correct)', () => {
    expect(isValidJan13('4902430911573')).toBe(true) // P&G Pampers
  })
  it('rejects wrong check digit', () => {
    expect(isValidJan13('4902430911574')).toBe(false)
  })
  it('rejects non-13-digit or non-45/49 prefix', () => {
    expect(isValidJan13('490243091157')).toBe(false)  // 12 digits
    expect(isValidJan13('1234567890123')).toBe(false) // valid-shaped but wrong prefix
  })
})

describe('extractJans', () => {
  it('pulls valid JANs out of marketing text, dedupes', () => {
    const text = '【送料無料】おむつ JAN:4902430911573 まとめ買い 4902430911573'
    expect(extractJans(text)).toEqual(['4902430911573'])
  })
  it('ignores 13-digit runs that fail the check digit', () => {
    expect(extractJans('code 4902430911574 here')).toEqual([])
  })
  it('returns [] when none present', () => {
    expect(extractJans('ベビー用品 お買い得')).toEqual([])
  })
})
