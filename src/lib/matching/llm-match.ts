import { ProductResult } from '@/lib/types'
import { semanticMatch } from '@/lib/llm/openrouter'
import { type Category } from '@/lib/llm/category-prompts'

export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
  opts?: { category?: Category },
): Promise<ProductResult | null> {
  if (!candidates.length) return null
  const idx = await semanticMatch(source, candidates, opts).catch(() => null)
  if (idx === null) return null
  return candidates[idx] ?? null
}
