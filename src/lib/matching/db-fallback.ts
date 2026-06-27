import { ProductResult } from '@/lib/types'
import { type Category } from '@/lib/llm/category-prompts'
import { semanticMatch } from '@/lib/llm/openrouter'
import { rankBySimilarity, similarity } from '@/lib/matching/rank'
import { findProductCandidatesByTokens, type ProductCandidate } from '@/lib/harvest/repo'

// Minimum rankBySimilarity score for an LLM-confirmed candidate to be accepted.
// Locked 2026-06-26 via scripts/tuning/tune-db-fallback.ts (n=150 goldset rows):
//   T=0.12 → precision 0.976, recall 0.857 (max recall 0.871 at T=0).
// Precision is already >= 0.95 at every T because the LLM + brand gate reject most
// false matches; the remaining 3 FPs are high-similarity REMOVE pairs no floor can
// drop. The floor's job is the thin-/junk-pool safety net the goldset can't exercise,
// so we keep it nonzero at the point where recall is still near its max.
export const SIMILARITY_FLOOR = 0.12

export interface DbMatch {
  productId: number
  targetListingId: string
  productTitle: string
  productImageUrl: string
  similarity: number
}

// Adapt a DB product candidate into the minimal ProductResult that
// rankBySimilarity / semanticMatch consume. No live price → effectivePrice 0, so
// semanticMatch's cheapest-tiebreak returns the highest-ranked confirmed match.
function toResult(c: ProductCandidate, platform: 'amazon' | 'rakuten'): ProductResult {
  return {
    platform, title: c.title, imageUrl: c.imageUrl, shopName: '',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

// Find the cross-platform equivalent of `source` among our own DB products that
// already have a listing on `target`. DB-only (no scraping). Returns a match only
// when semanticMatch confirms AND the rank similarity clears SIMILARITY_FLOOR.
// Best-effort: any failure returns null so the caller degrades to no sibling card.
export async function matchAgainstDb(
  source: ProductResult,
  target: 'amazon' | 'rakuten',
  category?: Category,
): Promise<DbMatch | null> {
  const candidates = await findProductCandidatesByTokens(source.title, target).catch(() => [] as ProductCandidate[])
  if (!candidates.length) return null

  // Keep a result→candidate map by object identity; rankBySimilarity preserves refs.
  const pairs = candidates.map((c) => ({ cand: c, result: toResult(c, target) }))
  const resultToCand = new Map(pairs.map((p) => [p.result, p.cand]))
  const ranked = rankBySimilarity(source, pairs.map((p) => p.result))

  const idx = await semanticMatch(source, ranked, { category }).catch(() => null)
  if (idx === null) return null
  const chosen = ranked[idx]
  if (!chosen) return null

  const score = similarity(source.title, chosen.title)
  if (score < SIMILARITY_FLOOR) return null

  const cand = resultToCand.get(chosen)
  if (!cand) return null
  return {
    productId: cand.productId, targetListingId: cand.targetListingId,
    productTitle: cand.title, productImageUrl: cand.imageUrl, similarity: score,
  }
}
