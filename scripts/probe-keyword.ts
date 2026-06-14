/**
 * Throwaway research harness for tuning per-category keyword prompts.
 *
 * Run:
 *   PROBE_FROM=rakuten \
 *   PROBE_TITLE='【送料無料】パンパース さらさらケア テープ 新生児 84枚' \
 *   PROBE_PRICE=1480 \
 *   PROBE_PROMPT=scripts/prompts/universal.txt \
 *   npx jest --config jest.config.ts --runInBand --testMatch '**\/scripts/probe-keyword.ts'
 *
 * Inputs (env):
 *   PROBE_FROM   'rakuten' | 'amazon' — platform the SOURCE product is from (target is the other)
 *   PROBE_TITLE  source product title
 *   PROBE_PRICE  source price in yen (integer)
 *   PROBE_PROMPT path to candidate prompt file; supports {{platform}} and {{title}}
 */
import { readFileSync } from 'fs'
import path from 'path'
import { type Category } from '../src/lib/llm/category-prompts'

// Load .env.local into process.env (no dotenv dependency). Existing env wins.
try {
  for (const line of readFileSync(path.join(__dirname, '../.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* .env.local optional if env already set */ }

async function llm(content: string): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b:free',
      messages: [{ role: 'user', content }],
      max_tokens: 32768,
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = (await res.json()) as { choices: { message: { content: string | null } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

test('probe', async () => {
  const from = (process.env.PROBE_FROM ?? 'rakuten') as 'rakuten' | 'amazon'
  const target: 'amazon' | 'rakuten' = from === 'rakuten' ? 'amazon' : 'rakuten'
  const title = process.env.PROBE_TITLE ?? ''
  const price = Number(process.env.PROBE_PRICE ?? '0')
  const promptTemplate = readFileSync(process.env.PROBE_PROMPT!, 'utf8')

  const { crawlAmazonSearch } = await import('@/lib/crawlers/amazon')
  const { crawlRakutenSearch } = await import('@/lib/crawlers/rakuten')
  const { rankBySimilarity } = await import('@/lib/matching/rank')
  const { semanticMatch } = await import('@/lib/llm/openrouter')
  const cat = process.env.PROBE_CATEGORY as Category | undefined

  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const prompt = promptTemplate
    .replace(/\{\{platform\}\}/g, target)
    .replace(/\{\{title\}\}/g, cleanTitle)

  const keyword = await llm(prompt)
  console.log('\n=== KEYWORD ===\n' + keyword)

  const results =
    target === 'amazon'
      ? await crawlAmazonSearch(keyword).catch(() => [])
      : await crawlRakutenSearch(keyword).catch(() => [])

  const source = {
    platform: from, title, imageUrl: '', shopName: '', salePrice: price,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: price, subscribeAvailable: false, rakutenCardEligible: true,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  } as unknown as import('@/lib/types').ProductResult

  const ranked = rankBySimilarity(source, results)
  console.log('\n=== RANKED CANDIDATES (top 10) ===')
  ranked.slice(0, 10).forEach((r, i) => console.log(`${i}: ¥${r.effectivePrice} ${r.title}`))

  const idx = await semanticMatch(source, ranked, { category: cat }).catch(() => null)
  console.log('\n=== SEMANTIC MATCH ===')
  console.log(idx === null ? 'NO MATCH' : `${idx}: ¥${ranked[idx].effectivePrice} ${ranked[idx].title}`)
  console.log('=== END ===\n')

  expect(true).toBe(true) // harness always "passes"; the agent reads the log
}, 180000)
