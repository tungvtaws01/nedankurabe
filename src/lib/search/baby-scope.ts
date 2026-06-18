import { classifyLocal } from '@/lib/jan/classify-local'
import { getGenreId } from '@/lib/platforms/rakuten'

// Decide whether a search keyword is a baby-product query. A keyword counts as baby
// if EITHER the local category classifier recognizes it OR it matches a specific
// (non-default) Rakuten baby genre.
//
// getGenreId returns "100533" (the broad キッズ・ベビー・マタニティ default) whenever
// nothing specific matches — that default alone is NOT a baby signal, because that
// genre also contains baby-gift coffee/snack/sweets sets (出産内祝い etc.). So an
// off-topic query like "コーヒー" (classifyLocal → 'unknown', getGenreId → default)
// is treated as non-baby; the search routes then return no results and the UI shows
// the baby-only empty state instead of generic Rakuten gift items.
export function isBabyQuery(keyword: string): boolean {
  return classifyLocal(keyword) !== 'unknown' || getGenreId(keyword) !== '100533'
}
