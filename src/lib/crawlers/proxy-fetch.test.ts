const mockFetch = jest.fn()
global.fetch = mockFetch as unknown as typeof fetch

import { proxyFetch } from './proxy-fetch'

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({ ok: true })
})

describe('proxyFetch via scrape.do', () => {
  beforeEach(() => { process.env.SCRAPEDO_TOKEN = 'test-token' })

  it('forwards caller headers with customHeaders=true so the target localizes (Accept-Language: ja)', async () => {
    await proxyFetch('https://www.amazon.co.jp/s?k=x&i=baby', {
      headers: { 'Accept-Language': 'ja-JP,ja;q=0.9' },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = mockFetch.mock.calls[0]
    expect(calledUrl).toContain('api.scrape.do')
    expect(calledUrl).toContain('customHeaders=true')
    expect((init as RequestInit).headers).toEqual({ 'Accept-Language': 'ja-JP,ja;q=0.9' })
  })

  it('does not add customHeaders when no headers are passed (render path stays unchanged)', async () => {
    await proxyFetch('https://example.com', {}, { render: true })
    const [calledUrl] = mockFetch.mock.calls[0]
    expect(calledUrl).toContain('render=true')
    expect(calledUrl).toContain('super=true')
    expect(calledUrl).not.toContain('customHeaders')
  })
})
