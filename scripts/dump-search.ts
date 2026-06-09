// Throwaway discovery helper: dump crawled search results for a keyword, so a
// tuning agent can find real product titles + their cross-platform equivalents
// without a browser (the crawlers are exactly what the matching pipeline sees).
//
// Run:
//   DUMP_PLATFORM=amazon DUMP_KEYWORD='パンパース テープ 新生児' \
//   npx jest --config jest.config.ts --runInBand --testMatch '**/scripts/dump-search.ts'
//
// Inputs (env):
//   DUMP_PLATFORM  'amazon' | 'rakuten' — which platform to search
//   DUMP_KEYWORD   search keyword
import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local into process.env (no dotenv dependency). Existing env wins.
try {
  for (const line of readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local optional if env already set */ }

test('dump', async () => {
  const platform = (process.env.DUMP_PLATFORM ?? 'amazon') as 'amazon' | 'rakuten'
  const keyword = process.env.DUMP_KEYWORD ?? ''

  const { crawlAmazonSearch } = await import('@/lib/crawlers/amazon')
  const { crawlRakutenSearch } = await import('@/lib/crawlers/rakuten')

  const results =
    platform === 'amazon'
      ? await crawlAmazonSearch(keyword).catch(() => [])
      : await crawlRakutenSearch(keyword).catch(() => [])

  console.log(`\n=== ${platform} :: "${keyword}" :: ${results.length} results ===`)
  results.slice(0, 20).forEach((r, i) => console.log(`${i}: ¥${r.salePrice} ${r.title}`))
  console.log('=== END ===\n')

  expect(true).toBe(true)
}, 120000)
