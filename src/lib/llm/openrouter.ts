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
      // 1024 tokens supports reasoning models (e.g. DeepSeek) which generate
      // chain-of-thought before the final answer. 128 was too low — the model
      // exhausted tokens during reasoning and returned content: null.
      max_tokens: 1024,
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
      content: `You are a Japanese shopping assistant. Extract a search keyword to find this product on ${targetPlatform} Japan.
Keep: brand name (if present), product type, key specs (size, count, thickness, water content %).
Remove: promotional text (【送料無料】, pt倍, 期間限定, ランキング1位, etc.), shop names.
If the source has a brand (e.g. パンパース, ムーニー, ピジョン, メリーズ), ALWAYS include it in the keyword.
Return ONLY the keyword, no explanation.
Title: ${title}`,
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
      content: `You are matching Japanese baby products across e-commerce platforms.
Source: ${source.title} ¥${source.salePrice.toLocaleString()}
Candidates:
${candidateList}

Apply these rules IN ORDER — all must pass:
1. BRAND: If the source has a brand name (パンパース/ムーニー/ピジョン/メリーズ/エルゴ/コンビ etc.),
   the candidate MUST have the exact same brand. A different brand is NOT a match.
2. PRODUCT TYPE: Must be the same type (e.g. おしりふき ≠ おてふき; 詰替え ≠ 蓋付き; テープ ≠ パンツ; 缶 ≠ キューブ ≠ 液体).
3. TARGET USER: Source is a baby/child product — adult (大人用/介護用) or pet products are NOT a match.
4. QUANTITY: Count/volume can differ up to 2× but not more.

Return {"match": N} for the best matching candidate index, or {"match": null} if none qualify.
Return JSON only.`,
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
