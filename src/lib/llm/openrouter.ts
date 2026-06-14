import { ProductResult } from '@/lib/types'
import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT, type Category } from './category-prompts'
import { computePriceFacts, platformName } from '@/lib/price/explain'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { brandsAreDistinct } from './brand-aliases'
import { composeMatchPrompt } from './match-rules'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const DEFAULT_MODEL = 'openai/gpt-oss-120b:free'
// JUDGE = the discriminating matcher (semanticMatch); needs strong JP + reasoning.
// FAST  = simple classify/refine/explain; a cheaper, smaller model is fine.
// Both fall back to OPENROUTER_MODEL, then to the default.
const JUDGE_MODEL = process.env.OPENROUTER_MODEL_JUDGE ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL
const FAST_MODEL = process.env.OPENROUTER_MODEL_FAST ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL

// These models are non-reasoning instruct models, so outputs are small; cap max_tokens
// tightly per task to save tokens/latency (was 32768 for the old reasoning model).
async function callLLM(
  messages: { role: string; content: string }[],
  opts: { model: string; maxTokens: number },
): Promise<string> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    cache: 'no-store',
    next: { revalidate: 0 },
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens,
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
    }], { model: FAST_MODEL, maxTokens: 24 })
    const id = result.trim().toLowerCase()
    return (CATEGORIES as readonly string[]).includes(id) ? (id as Category) : 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function refineKeyword(
  title: string,
  targetPlatform: 'amazon' | 'rakuten',
  category?: Category | 'unknown',
): Promise<string> {
  // Strip supplementary bracket annotations before LLM sees the title.
  // Amazon appends usage context in [brackets] (e.g. [0ヵ月~1歳頃 固形タイプの粉ミルク])
  // that are not part of the searchable product name and mislead keyword generation.
  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  // Callers that already know the category can pass it in to skip a duplicate classify call.
  const cat = category ?? await classifyCategory(cleanTitle)
  const buildPrompt = cat === 'unknown' ? UNIVERSAL_PROMPT : CATEGORY_PROMPTS[cat]
  try {
    const result = await callLLM([{ role: 'user', content: buildPrompt(targetPlatform, cleanTitle) }], { model: FAST_MODEL, maxTokens: 120 })
    return result || stripBrackets(title)
  } catch {
    return stripBrackets(title)
  }
}

export async function semanticMatch(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<number | null> {
  if (!candidates.length) return null
  try {
    // Brand gate: drop candidates whose KNOWN brand differs from the source's known
    // brand. Track original indices so the return value still indexes `candidates`.
    const gated = candidates
      .map((c, origIdx) => ({ c, origIdx }))
      .filter(({ c }) => !brandsAreDistinct(source.title, c.title))
    if (!gated.length) return null
    const pool = gated.slice(0, 8) // reasoning models exhaust tokens on long lists
    const fmt = (p: ProductResult, i?: number) => {
      const prefix = i !== undefined ? `${i}: ` : 'Source: '
      const desc = p.description ? ` [${p.description.slice(0, 120)}]` : ''
      return `${prefix}${p.title.slice(0, 100)} ¥${p.salePrice.toLocaleString()}${desc}`
    }
    const candidateList = pool.map(({ c }, i) => fmt(c, i)).join('\n')
    const result = await callLLM([{
      role: 'user',
      content: `${composeMatchPrompt(opts?.category)}\n\n${fmt(source)}\nCandidates:\n${candidateList}`,
    }], { model: JUDGE_MODEL, maxTokens: 600 })
    const cleaned = result.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as { matches: number[] }
    if (!Array.isArray(parsed.matches) || parsed.matches.length === 0) return null
    // LLM indices are into `pool`; map back to original `candidates` indices.
    const validOrig = parsed.matches
      .filter((i) => typeof i === 'number' && pool[i] !== undefined)
      .map((i) => pool[i].origIdx)
    if (validOrig.length === 0) return null
    return validOrig.reduce((best, i) =>
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
    }], { model: FAST_MODEL, maxTokens: 200 })

    const sentence = content.trim()
    if (!sentence) return null
    await setCached(cacheKey, sentence).catch(() => {})
    return sentence
  } catch {
    return null
  }
}
