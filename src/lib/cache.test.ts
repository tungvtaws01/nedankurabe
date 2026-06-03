jest.mock('@vercel/kv', () => ({
  kv: { get: jest.fn(), set: jest.fn() },
}))

import { kv } from '@vercel/kv'
import { makeCacheKey, getCached, setCached } from './cache'

describe('makeCacheKey', () => {
  it('returns 64-char hex for any input', () => {
    expect(makeCacheKey('パンパース')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('normalises to same key regardless of case/whitespace', () => {
    expect(makeCacheKey('Pampers  S')).toBe(makeCacheKey('pampers s'))
  })

  it('different inputs produce different keys', () => {
    expect(makeCacheKey('pampers')).not.toBe(makeCacheKey('merries'))
  })
})

describe('getCached', () => {
  it('returns parsed value when present', async () => {
    const data = [{ platform: 'amazon' }]
    ;(kv.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(data))
    expect(await getCached('key')).toEqual(data)
  })

  it('returns null when absent', async () => {
    ;(kv.get as jest.Mock).mockResolvedValueOnce(null)
    expect(await getCached('missing')).toBeNull()
  })
})

describe('setCached', () => {
  it('serialises and sets with 1800s TTL', async () => {
    const data = [{ platform: 'rakuten' }]
    await setCached('key', data)
    expect(kv.set).toHaveBeenCalledWith('key', JSON.stringify(data), { ex: 1800 })
  })
})
