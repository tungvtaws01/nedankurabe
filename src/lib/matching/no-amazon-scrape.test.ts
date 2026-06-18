import { readFileSync } from 'fs'
import { join } from 'path'

// These display/serving modules must NOT scrape Amazon. The only legitimate Amazon
// crawler use is the harvest pipeline (scripts/harvest) and short-link resolution.
const DISPLAY_FILES = [
  'src/app/api/search/route.ts',
  'src/app/api/search/stream/route.ts',
  'src/app/api/lookup/route.ts',
  'src/app/api/lookup/stream/route.ts',
  'src/app/api/preview/route.ts',
  'src/lib/matching/find-equivalent.ts',
]

describe('no Amazon scraping in display paths', () => {
  for (const rel of DISPLAY_FILES) {
    it(`${rel} does not import crawlAmazonSearch/crawlAmazonProduct`, () => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8')
      expect(src).not.toMatch(/crawlAmazonSearch/)
      expect(src).not.toMatch(/crawlAmazonProduct/)
    })
  }
})
