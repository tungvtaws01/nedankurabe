import Anthropic from '@anthropic-ai/sdk'
import { ProductResult } from '@/lib/types'

const SYSTEM = `You are a product matching assistant for a Japanese price comparison service.
Given a source product and numbered candidates from another platform, identify which candidate is the SAME product — same brand, type, size, and quantity.
Respond with JSON only: {"index": <0-based index or -1 if no match>, "confidence": "high" | "low"}
"high" = brand + type + size + quantity all match. "low" = likely same product but some attributes differ.`

export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<ProductResult | null> {
  if (!candidates.length) return null

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const userMsg =
    `Source (${source.platform}): ${source.title} — ¥${source.salePrice}\n\n` +
    `Candidates:\n${candidates.map((c, i) => `[${i}] ${c.title} — ¥${c.salePrice}`).join('\n')}\n\n` +
    `Which index is the same product? -1 if none match.`

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  try {
    const text = res.content.find(b => b.type === 'text')?.text ?? ''
    const { index, confidence } = JSON.parse(text) as { index: number; confidence: 'high' | 'low' }
    if (index === -1 || !candidates[index]) return null
    const match = candidates[index]
    return confidence === 'low' ? { ...match, title: `似た商品: ${match.title}` } : match
  } catch {
    return null
  }
}
