import { ProductResult } from '@/lib/types'

// Lightweight pre-ranking for match candidates.
//
// Purpose: ensure the true cross-platform equivalent survives semanticMatch's
// top-N window even when the merged candidate pool is large. This is NOT a
// matcher — it only orders candidates so the LLM sees the most promising ones
// first.
//
// Key constraint: Amazon JP titles are often English/romaji while Rakuten
// titles are Japanese, so plain word overlap is frequently near-zero across
// platforms. The decisive, language-agnostic signals are NUMERIC tokens —
// weights, counts, volumes, sizes (780g, 84枚, 240ml, ×2缶) — so those are
// weighted highest. When there is no signal at all, the sort is stable and
// preserves the input order (callers put the targeted, relevance-ranked search
// results first), which is the right fallback.

// Pull comparable numbers out of a title: a digit run plus its immediate unit
// (g, kg, ml, l, 枚, 袋, 缶, 個, ヶ月/カ月, サイズ, kg ranges...). The number is
// the load-bearing part; the unit disambiguates 80g from 80枚.
function numericTokens(title: string): Set<string> {
  const out = new Set<string>()
  const re = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l|枚|袋|缶|個|本|包|ヶ月|カ月|か月|ヵ月|箱|セット|サイズ|s|m|l|xl|号)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(title)) !== null) {
    const num = m[1]
    const unit = (m[2] ?? '').toLowerCase()
    out.add(unit ? `${num}${unit}` : num)
  }
  return out
}

// Word/segment tokens for same-language and shared-romaji overlap (brand names,
// model words). Lowercased; CJK runs are kept whole and also emitted as
// character bigrams so spaceless Japanese titles can still overlap.
function textTokens(title: string): Set<string> {
  const lower = title.toLowerCase()
  const out = new Set<string>()
  // ASCII / latin words and digit-free romaji
  for (const w of lower.match(/[a-z]{2,}/g) ?? []) out.add(w)
  // CJK runs → whole run + bigrams
  for (const run of lower.match(/[ぁ-ゖァ-ヶ一-鿿㐀-䶿]{2,}/g) ?? []) {
    out.add(run)
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2))
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

// Combined similarity in [0, 1]. Numeric agreement dominates because it
// transfers across languages and is decisive for these products; text overlap
// is a lighter secondary signal.
export function similarity(a: string, b: string): number {
  const numScore = jaccard(numericTokens(a), numericTokens(b))
  const textScore = jaccard(textTokens(a), textTokens(b))
  return 0.7 * numScore + 0.3 * textScore
}

// Order candidates by descending similarity to the source title. Stable on
// ties: candidates with equal scores keep their input order, so the caller's
// relevance-first ordering is preserved when the scorer has nothing to say.
export function rankBySimilarity(
  source: ProductResult,
  candidates: ProductResult[],
): ProductResult[] {
  return candidates
    .map((c, i) => ({ c, i, score: similarity(source.title, c.title) }))
    .sort((x, y) => (y.score - x.score) || (x.i - y.i))
    .map((r) => r.c)
}
