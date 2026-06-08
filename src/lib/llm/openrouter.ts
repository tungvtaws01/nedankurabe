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
      content: `Extract a search keyword for ${targetPlatform} Japan.
Keep in this priority order:
1. Brand name (e.g. パンパース, メリーズ, Ergobaby)
2. Product line / series name — highest priority after brand (e.g. さらさらケア, はじめての肌へのいちばん, OMNI Breeze, エアフィット) — this distinguishes product tiers, never drop it
3. Product type (e.g. テープ, パンツ, 抱っこひも)
4. Size or weight range (e.g. 新生児, Sサイズ, 5kgまで) — size is critical, keep it
5. Count or volume if space allows (e.g. 84枚)

Remove: promotional text, colors, order codes (B0xxx, CREGBCZ, EBC, ASIN), shop names, adjectives like 送料無料/期間限定.
Output plain text only, max 8 words.

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
    // Limit to top 5 — reasoning models exhaust tokens on long candidate lists
    const pool = candidates.slice(0, 5)
    const fmt = (p: ProductResult, i?: number) => {
      const prefix = i !== undefined ? `${i}: ` : 'Source: '
      const desc = p.description ? ` [${p.description.slice(0, 120)}]` : ''
      return `${prefix}${p.title.slice(0, 100)} ¥${p.salePrice.toLocaleString()}${desc}`
    }
    const candidateList = pool.map((c, i) => fmt(c, i)).join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `You are a product matching engine for Japanese e-commerce platforms (Amazon JP ↔ Rakuten).

List ALL candidates that satisfy ALL HIGH criteria below. The caller will pick the cheapest — just identify every valid match.

HIGH (all must match):
- Brand: same brand including JP/EN equivalents
  Pampers=パンパース, Merries=メリーズ, Moony=ムーニー, Goon=グーン,
  Pigeon=ピジョン, Combi=コンビ, Aprica=アップリカ, Ergobaby=エルゴベビー
- Product line / tier: must be the same line within the brand
  (e.g. さらさらケア ≠ はじめての肌へのいちばん — different tiers even within Pampers)
- Product type: must be the same (e.g. tape≠pants, carrier≠stroller)
- Size / weight range: must match (e.g. 新生児/5kg ≠ Sサイズ/6-11kg)

MEDIUM (minor difference is acceptable):
- Count / volume (e.g. 82枚 vs 84枚 ok; 84枚 vs 200枚 not ok)

LOW (may differ freely):
- Colors, pack design, promotional bundles

Return JSON only: {"matches": [i, j, ...]} listing every valid candidate index, or {"matches": []} if none qualify.

${fmt(source)}
Candidates:
${candidateList}`,
    }])
    // Strip markdown fences that LLMs sometimes wrap around JSON
    const cleaned = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { matches: number[] }
    if (!Array.isArray(parsed.matches) || parsed.matches.length === 0) return null
    // Among all valid matches, pick the one with the lowest effective price
    const valid = parsed.matches.filter(i => typeof i === 'number' && candidates[i] !== undefined)
    if (valid.length === 0) return null
    return valid.reduce((best, i) =>
      candidates[i].effectivePrice < candidates[best].effectivePrice ? i : best
    )
  } catch {
    return null
  }
}

function stripBrackets(title: string): string {
  return title.replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim()
}
