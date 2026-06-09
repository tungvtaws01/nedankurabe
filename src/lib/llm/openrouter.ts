import { ProductResult } from '@/lib/types'
import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT, type Category } from './category-prompts'
import { computePriceFacts, platformName } from '@/lib/price/explain'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'

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
- Count: compare the TOTAL pieces = per-unit count × number of packs/boxes.
  · Minor differences are fine (82枚 vs 84枚; 264 vs 248).
  · Same total in a different pack format is fine (1 box of 60 vs 2 boxes of 30 = 60 total).
  · But a LARGE total mismatch is a MISMATCH: a single box (e.g. 52枚, 66枚) is NOT
    equivalent to a multi-pack case (e.g. 264枚 = 66枚×4パック / ケース品 / "Case Product").
    Reject when the totals differ by more than ~1.5×.
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

/**
 * Generates one short, friendly Japanese sentence explaining why `winner` is
 * cheaper than `loser`. The prompt pins the exact computed numbers and forbids
 * inventing or altering them, so the LLM-written sentence stays factually correct.
 * Cached by product-pair key. Returns null on any failure — callers fall back to
 * the rule-based bullets.
 */
export async function explainPriceDifference(
  winner: ProductResult,
  loser: ProductResult,
): Promise<string | null> {
  const keyBase = `explain:${winner.affiliateUrl || winner.title}:${loser.affiliateUrl || loser.title}`
  const cacheKey = makeCacheKey(keyBase)
  const cached = await getCached<string>(cacheKey).catch(() => null)
  if (cached) return cached

  try {
    const f = computePriceFacts(winner, loser)
    const listPriceLine = f.listPriceDiff > 0
      ? `${platformName(f.winnerPlatform)}が¥${f.listPriceDiff.toLocaleString()}安い`
      : '同じ'
    const pointsLine = f.pointsDelta > 50
      ? `${platformName(f.winnerPlatform)}が¥${f.pointsDelta.toLocaleString()}多い`
      : 'ほぼ同じ'
    const shippingLine = f.winnerFreeShipping
      ? `${platformName(f.winnerPlatform)}は送料無料、${platformName(f.loserPlatform)}は¥${f.loserShipping.toLocaleString()}`
      : '同条件'

    const content = await callLLM([{
      role: 'user',
      content: `あなたは日本の価格比較アプリのアシスタントです。以下の「事実」だけを使い、なぜ${platformName(f.winnerPlatform)}の方が安いのかを買い物客にやさしく説明する短い日本語の文を、1文（最大2文）で書いてください。

事実:
- 安い方: ${platformName(f.winnerPlatform)}「${winner.title.slice(0, 60)}」
- 高い方: ${platformName(f.loserPlatform)}「${loser.title.slice(0, 60)}」
- 価格差: ¥${f.diff.toLocaleString()}（${f.diffPct}%お得）
- 定価の差: ${listPriceLine}
- ポイント還元の差: ${pointsLine}
- 送料: ${shippingLine}

ルール:
- 上の数字をそのまま使い、数字を変えたり新しく作ったりしないこと。
- 専門用語を避け、親しみやすい言葉で。
- 1文、最大2文。前置きや箇条書き・記号は不要。文だけを出力すること。`,
    }])

    const sentence = content.trim()
    if (!sentence) return null
    await setCached(cacheKey, sentence).catch(() => {})
    return sentence
  } catch {
    return null
  }
}
