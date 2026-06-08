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

// Category taxonomy — discovered from Amazon JP + Rakuten (scripts/taxonomy.md).
// CATEGORIES is the single source of truth; Category is derived from it so the
// runtime list and the type can never drift apart.
const CATEGORIES = [
  'diapers', 'wipes', 'formula', 'bottles', 'baby_food',
  'carriers', 'strollers', 'car_seats', 'skincare', 'bath',
] as const

export type Category = typeof CATEGORIES[number]

type PromptBuilder = (platform: string, title: string) => string

// Today's prompt, preserved verbatim as the fallback for unknown/low-confidence titles.
const UNIVERSAL_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan.
Keep in this priority order:
1. Brand name (e.g. パンパース, メリーズ, Ergobaby, 明治ほほえみ — keep full brand name)
2. Product line / model name — highest priority after brand, never drop it
   (e.g. さらさらケア, OMNI Breeze, らくらくキューブ, ハイハイン, ADAPT)
3. Product type (e.g. テープ, パンツ, 抱っこひも, 粉ミルク, 離乳食)
4. Size / weight / volume from the product name — critical, always keep
   (e.g. 新生児, Sサイズ, 5kgまで, 800g, 540g, 60袋)
   Do NOT invent stage/age from context — only use what is in the title itself.
5. Count only if it distinguishes the product (e.g. 84枚, 20袋)

Remove: colors, promotional text, order codes (B0xxx, CREGBCZ, ASIN), shop names, adjectives like 送料無料/新作/おすすめ/期間限定.
Output plain text only, max 8 words.

Title: ${title}`

// Per-category prompts. Each starts as UNIVERSAL_PROMPT and is replaced with a
// tuned builder during empirical tuning (later task). Keys MUST match CATEGORIES.
const CATEGORY_PROMPTS: Record<Category, PromptBuilder> = {
  diapers: UNIVERSAL_PROMPT,
  wipes: UNIVERSAL_PROMPT,
  formula: UNIVERSAL_PROMPT,
  bottles: UNIVERSAL_PROMPT,
  baby_food: UNIVERSAL_PROMPT,
  carriers: UNIVERSAL_PROMPT,
  strollers: UNIVERSAL_PROMPT,
  car_seats: UNIVERSAL_PROMPT,
  skincare: UNIVERSAL_PROMPT,
  bath: UNIVERSAL_PROMPT,
}

export async function classifyCategory(title: string): Promise<Category | 'unknown'> {
  try {
    const result = await callLLM([{
      role: 'user',
      content: `Classify this Japanese baby product into exactly one category id.
Category ids: ${CATEGORIES.join(', ')}
Output ONLY the id, or "unknown" if none fit. No other text.

Title: ${title}`,
    }])
    const id = result.trim().toLowerCase()
    return (CATEGORIES as readonly string[]).includes(id) ? (id as Category) : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
): Promise<string> {
  // Strip supplementary bracket annotations before LLM sees the title.
  // Amazon appends usage context in [brackets] (e.g. [0ヵ月~1歳頃 固形タイプの粉ミルク])
  // that are not part of the searchable product name and mislead keyword generation.
  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const category = await classifyCategory(cleanTitle)
  const buildPrompt = category === 'unknown' ? UNIVERSAL_PROMPT : CATEGORY_PROMPTS[category]
  try {
    const result = await callLLM([{ role: 'user', content: buildPrompt(targetPlatform, cleanTitle) }])
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
    // Limit to top 8 — reasoning models exhaust tokens on long candidate lists.
    // Callers should pre-rank (see matching/rank.ts) so the true match is in this window.
    const pool = candidates.slice(0, 8)
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
  Pigeon=ピジョン, Combi=コンビ, Aprica=アップリカ, Ergobaby=エルゴベビー,
  Meiji=明治, Morinaga=森永, Snow Brand=雪印, Wakodo=和光堂, Kao=花王
- Product line / model: must be the same line or model within the brand
  · Diapers: さらさらケア ≠ はじめての肌へのいちばん (different tiers)
  · Formula: らくらくキューブ ≠ 缶タイプ (different form); ほほえみ ≠ ステップ (different stage)
  · Carriers: OMNI Breeze ≠ ADAPT ≠ EMBRACE (different models)
  · Baby food: ハイハイン ≠ グーグーキッチン (different product lines)
- Product type: must be the same (tape≠pants, cube≠powder, carrier≠stroller, liquid≠solid)
- Size / stage / volume: must match — interpretation depends on category:
  · Diapers: weight range (新生児/5kg ≠ Sサイズ/6-11kg)
  · Formula / baby food: age stage (0ヶ月 ≠ 6ヶ月頃) AND can/pack size (400g ≠ 800g)
  · Carriers: supported weight range (newborn ≠ toddler) if specified
  · General: treat any size or stage difference as a mismatch

MEDIUM (minor difference is acceptable):
- Count / sheet count (e.g. 82枚 vs 84枚 ok; 84枚 vs 200枚 not ok)
- Pack format for same volume (e.g. 1 box of 60 bags vs 2 boxes of 30 bags)
- N/A for products with no count dimension (carriers, strollers, single-unit items)

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
