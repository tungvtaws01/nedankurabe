import { ProductResult } from '@/lib/types'
import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT, type Category } from './category-prompts'
import { computePriceFacts, platformName } from '@/lib/price/explain'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'

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
): Promise<string> {
  // Strip supplementary bracket annotations before LLM sees the title.
  // Amazon appends usage context in [brackets] (e.g. [0ヵ月~1歳頃 固形タイプの粉ミルク])
  // that are not part of the searchable product name and mislead keyword generation.
  const cleanTitle = title.replace(/\[([^\]]{0,60})\]/g, '').replace(/\s+/g, ' ').trim()
  const category = await classifyCategory(cleanTitle)
  const buildPrompt = category === 'unknown' ? UNIVERSAL_PROMPT : CATEGORY_PROMPTS[category]
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
  Wipes (おしりふき) brands also: レック/LEC (純水ベビーケア・水99.9%), アイリスオーヤマ/Genki!, 西松屋.
  DISTINCT brands NEVER match even if specs look identical: Costco's KIRKLAND (カークランド) ≠ RICO ≠ a コストコ generic — same retailer/sheet-count is NOT the same product.
  NO-BRAND rule (HIGH): if one side names NO maker (a generic, brand-less title) and the other names a specific brand, that is a MISMATCH — return no-match for it EVEN IF size/type/sheet-count/specs are identical. Identical specs do not prove the same product; a shared brand is required.
- Product line / model: must be the same line or model within the brand
  · Diapers: さらさらケア ≠ はじめての肌へのいちばん ≠ 超吸収エアリー ≠ 卒業パンツ (different lines/tiers);
    エアスルー ≠ ぐっすりパンツ (Merries); エアフィット ≠ マシュマロ肌ごこち (Moonyman)
  · Formula: らくらくキューブ ≠ 缶タイプ (different form); ほほえみ ≠ ステップ (different stage)
  · Carriers: OMNI Breeze ≠ ADAPT ≠ EMBRACE (different models)
  · Baby food: ハイハイン ≠ グーグーキッチン (different product lines). The specific
    DISH/FLAVOR must also match within a line — グーグーキッチン 鮭とじゃがいもの和風煮 ≠
    牛肉のすき焼き風ごはん ≠ ラタトゥイユ; 栄養マルシェ flavors differ; same line +
    different dish/flavor = a DIFFERENT product (mismatch)
  · Wipes: 純水/水99% ≠ アルコール除菌タイプ; トイレに流せる (flushable) ≠ regular; 手口ふき (hand & mouth) ≠ おしりふき (bottom); within a brand, named wipe lines differ (Moony やわらか素材 ≠ 水分たっぷり厚手 ≠ こすらずするりんっ; 厚手 ≠ 通常 only when one explicitly says 厚手)
  · Sunscreen/UV (日焼け止め・UVケア): the SPF rating is part of the SKU — SPF50/50+ ≠ SPF35 ≠ SPF29 ≠ SPF21; never match across different SPF levels (a number like "クリーム50" usually denotes SPF50)
- Product type: must be the same (tape≠pants, cube≠powder, carrier≠stroller, liquid≠solid)
- Usage variant: 夜用 (night) ≠ 昼用/標準 (day/regular). Night-use and day/regular are
  different product lines — treat as a mismatch.
- Gender: 男の子用 ≠ 女の子用. The boy and girl versions are different products — do NOT
  match across gender. For gender-split products (especially 水あそびパンツ swim pants), COLOR
  encodes gender: ブルー/青 = 男の子用, ピンク = 女の子用 — so blue-vs-pink, or a color on one
  side vs the opposite gender label on the other, is a gender MISMATCH. (A plain color on a
  NON-gender-split product is fine — see LOW.)
- Size / stage / per-unit volume: must match — interpretation depends on category:
  · Diapers: weight range (新生児/5kg ≠ Sサイズ/6-11kg). Letter sizes are STRICT —
    新生児 ≠ Sサイズ ≠ Mサイズ ≠ Lサイズ ≠ ビッグ ≠ ビッグより大きい/スーパービッグ.
    ADJACENT sizes are STILL a mismatch (M≠L, L≠ビッグ); never match across different sizes.
  · Formula / baby food: age stage (0ヶ月 ≠ 6ヶ月頃) AND PER-UNIT can size (a 400g can ≠ an 800g can)
  · Carriers: supported weight range (newborn ≠ toddler) if specified
  · General: treat any per-unit size or stage difference as a mismatch

PACK QUANTITY — normalized downstream, NOT a matching criterion:
- The number of identical retail units (×N, N個セット, ケース, 箱×N, まとめ買い, "Case Product")
  may differ freely. A case-pack and a single pack of the SAME unit product ARE a match —
  unit price is compared downstream. Do NOT reject because one side is a multi-pack/セット/ケース
  and the other is a single. (e.g. 66枚×4パック ケース品 matches a single 66枚 pack.)
- Per-unit count WITHIN one pack: small differences are fine (82枚 vs 84枚). A drastically
  different per-unit count that signals a different SKU — e.g. a 3-piece trial vs a 64-piece
  pack — is a mismatch (per-unit size, governed above), but ordinary pack-quantity differences are not.
- N/A for products with no count dimension (carriers, strollers, single-unit items)

LOW (may differ freely):
- Plain colors (without a gender label), pack design, promotional bundles

Return JSON only: {"matches": [i, j, ...]} listing every valid candidate index, or {"matches": []} if none qualify.

${fmt(source)}
Candidates:
${candidateList}`,
    }], { model: JUDGE_MODEL, maxTokens: 600 })
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
    }], { model: FAST_MODEL, maxTokens: 200 })

    const sentence = content.trim()
    if (!sentence) return null
    await setCached(cacheKey, sentence).catch(() => {})
    return sentence
  } catch {
    return null
  }
}
