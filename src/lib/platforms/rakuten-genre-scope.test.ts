import { searchRakuten } from './rakuten'

describe('searchRakuten genre scoping', () => {
  const ORIG_FETCH = global.fetch
  let calledUrls: string[]

  beforeEach(() => {
    calledUrls = []
    process.env.RAKUTEN_APP_ID = 'test-app'
    process.env.RAKUTEN_ACCESS_KEY = 'test-key'
    // Mock fetch: always return an empty Items list so all genre attempts "miss".
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      calledUrls.push(String(url))
      return { ok: true, text: async () => JSON.stringify({ Items: [] }) } as unknown as Response
    }) as unknown as typeof fetch
  })

  afterEach(() => { global.fetch = ORIG_FETCH })

  it('never queries the all-genres genreId=0, and returns [] for an off-topic keyword', async () => {
    const results = await searchRakuten('コーヒー')
    expect(results).toEqual([])
    expect(calledUrls.length).toBeGreaterThan(0)
    expect(calledUrls.some((u) => /[?&]genreId=0(&|$)/.test(u))).toBe(false)
  })
})
