import { ProductResult } from '@/lib/types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function callLLM(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://nedankurabe.vercel.app',
      'X-Title': 'ねだんくらべ',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'nvidia/nemotron-3-ultra-550b-a55b:free',
      messages,
      max_tokens: 128,
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
): Promise<string> {
  try {
    const result = await callLLM([{
      role: 'user',
      content: `Extract a clean, concise Japanese search keyword from this product title for searching on ${targetPlatform} Japan.\nKeep: brand name, product type, size/variant (Sサイズ, 108枚, etc.).\nRemove: promotional text (【送料無料】, pt倍, 期間限定, etc.), shop names, punctuation noise.\nReturn ONLY the keyword, no explanation.\nTitle: ${title}`,
    }])
    return result || stripBrackets(title)
  } catch {
    return stripBrackets(title)
  }
}

export async function semanticMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<number | null> {
  if (!candidates.length) return null
  try {
    const candidateList = candidates
      .map((c, i) => `${i}: ${c.title} ¥${c.salePrice.toLocaleString()}`)
      .join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `You are matching products across Japanese e-commerce platforms.\nSource: ${source.title} ¥${source.salePrice.toLocaleString()}\nCandidates:\n${candidateList}\n\nWhich candidate is the SAME product (same brand, type, size/count)?\nAccessories, replacement parts, and different sizes are NOT a match.\nReturn JSON only: {"match": 0} or {"match": null}`,
    }])
    const parsed = JSON.parse(result) as { match: number | null }
    if (parsed.match === null || parsed.match === undefined) return null
    if (!candidates[parsed.match]) return 0
    return parsed.match
  } catch {
    return 0
  }
}

function stripBrackets(title: string): string {
  return title.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim()
}
