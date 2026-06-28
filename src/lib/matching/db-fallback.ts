import { ProductResult } from '@/lib/types'
import { type Category } from '@/lib/llm/category-prompts'
import { semanticMatchAll, refineKeyword } from '@/lib/llm/openrouter'
import { rankBySimilarity, similarity } from '@/lib/matching/rank'
import { parsePackSize, sizeRelation, packCloseness } from '@/lib/matching/pack-size'
import { findProductCandidatesByTokens, type ProductCandidate } from '@/lib/harvest/repo'

// Min similarity() score for a confirmed candidate (thin-/junk-pool safety net).
// Locked 2026-06-26 via scripts/tuning/tune-db-fallback.ts, n=150 goldset rows.
// T=0.12 → precision 0.976 / recall 0.857 (max recall 0.871 at T=0).
// Precision ≥0.95 holds at every T — LLM+brand gate carry the load;
// the floor is solely a junk/thin-pool guard.
export const SIMILARITY_FLOOR = 0.12
const MAX_CANDIDATES = 5

export interface DbMatch {
  productId: number
  targetListingId: string
  productTitle: string
  productImageUrl: string
  similarity: number
  sizeMatch?: 'exact' | 'different'
}

function toResult(c: ProductCandidate, platform: 'amazon' | 'rakuten'): ProductResult {
  return {
    platform, title: c.title, imageUrl: c.imageUrl, shopName: '',
    salePrice: 0, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

// All same-product DB candidates on `target`, ranked by pack-size closeness to
// `source` (size-unknown last), deduped by listing id, capped at MAX_CANDIDATES.
// Best-effort: any failure returns []. Ranking/gating use source.title; retrieval
// uses a refined keyword (handles spaceless JP titles).
export async function matchAgainstDb(
  source: ProductResult,
  target: 'amazon' | 'rakuten',
  category?: Category,
): Promise<DbMatch[]> {
  const keyword = await refineKeyword(source.title, target, category).catch(() => source.title)
  const candidates = await findProductCandidatesByTokens(keyword, target).catch(() => [] as ProductCandidate[])
  if (!candidates.length) return []

  const pairs = candidates.map((c) => ({ cand: c, result: toResult(c, target) }))
  const resultToCand = new Map(pairs.map((p) => [p.result, p.cand]))
  const ranked = rankBySimilarity(source, pairs.map((p) => p.result))

  const idxs = await semanticMatchAll(source, ranked, { category }).catch(() => [] as number[])
  if (!idxs.length) return []

  const srcPack = parsePackSize(source.title)
  const matches: DbMatch[] = []
  for (const idx of idxs) {
    const chosen = ranked[idx]
    if (!chosen) continue
    const cand = resultToCand.get(chosen)
    if (!cand) continue
    const sim = similarity(source.title, chosen.title)
    if (sim < SIMILARITY_FLOOR) continue
    const rel = sizeRelation(srcPack, parsePackSize(cand.title))
    matches.push({
      productId: cand.productId, targetListingId: cand.targetListingId,
      productTitle: cand.title, productImageUrl: cand.imageUrl, similarity: sim,
      sizeMatch: rel === 'unknown' ? undefined : rel,
    })
  }

  matches.sort((a, b) =>
    packCloseness(srcPack, parsePackSize(a.productTitle)) - packCloseness(srcPack, parsePackSize(b.productTitle)))

  const seen = new Set<string>()
  const out: DbMatch[] = []
  for (const m of matches) {
    if (seen.has(m.targetListingId)) continue
    seen.add(m.targetListingId)
    out.push(m)
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}
