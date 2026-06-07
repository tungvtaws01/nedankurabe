import { ProductResult } from '@/lib/types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

async function callLLM(messages: { role: string; content: string }[]): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    cache: 'no-store',
    next: { revalidate: 0 },
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b:free',
      messages,
      // 32768 tokens for DeepSeek reasoning model — long chain-of-thought before answer.
      max_tokens: 32768,
      temperature: 0,
    }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`)
  const data = await res.json() as { choices: { message: { content: string | null } }[] }
  return data.choices[0]?.message?.content?.trim() ?? ''
}

export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
): Promise<string> {
  try {
    const result = await callLLM([{
      role: 'user',
      content: `Search keyword for ${targetPlatform} Japan. Keep: brand name, product type, model series. Remove: colors, Amazon codes like EBC/B0xxx/CREGBCZ, promotional text, adjectives. Output plain text, max 5 words.\nTitle: ${title}`,
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
    // Limit to top 5 — reasoning models exhaust tokens on long candidate lists
    const pool = candidates.slice(0, 5)
    const fmt = (p: ProductResult, i?: number) => {
      const prefix = i !== undefined ? `${i}: ` : 'Source: '
      const desc = p.description ? ` [${p.description.slice(0, 60)}]` : ''
      return `${prefix}${p.title.slice(0, 60)} ¥${p.salePrice.toLocaleString()}${desc}`
    }
    const candidateList = pool.map((c, i) => fmt(c, i)).join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `Match baby product across platforms. Same brand (Ergobaby=エルゴベビー, Pampers=パンパース etc.), same type, baby not adult. Colors may differ. Return {"match":N} or {"match":null}.
Source: ${fmt(source)}
Candidates:
${candidateList}`,
    }])
    const parsed = JSON.parse(result) as { match: number | null }
    if (parsed.match === null || parsed.match === undefined) return null
    if (!candidates[parsed.match]) return null
    return parsed.match
  } catch {
    return null
  }
}

function stripBrackets(title: string): string {
  return title.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim()
}
