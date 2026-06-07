import { ProductResult } from '@/lib/types'
import { semanticMatch } from '@/lib/llm/openrouter'

export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<ProductResult | null> {
  if (!candidates.length) return null
  const idx = await semanticMatch(source, candidates).catch(() => 0)
  if (idx === null) return null
  return candidates[idx] ?? null
}
