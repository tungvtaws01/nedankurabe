import { type Category } from '../llm/category-prompts'
import { classifyLocal } from './classify-local'
import { categoryFromGenreId } from './rakuten-genre'
import { isTrialOrSamplePack } from '../platforms/rakuten'

// Resolve a product's fine Category from the strongest signals available, in
// precision order. Used both at enumeration time and by the backfill scripts so a
// product gets the SAME category however it is processed.
//
//   tier 0  pollution/accessory filter  → 'unknown'   (EXCLUDE_KEYWORDS)
//   tier 1  title regex (classifyLocal) → that genre  (explicit keyword = high precision)
//   tier 2  Rakuten genreId map         → that genre  (structured signal fills regex gaps)
//   tier 3  → 'unknown'                                (LLM pass decides later)
//
// Regex wins over genreId on purpose: an explicit keyword in the title (e.g.
// おしりふき) is the actual product, whereas Rakuten's shop-assigned genreId is
// sometimes mis-tagged. genreId only acts when regex is silent. The tier-0 filter
// runs first so mis-tagged pollution (hardware/funeral/adult-care that shops drop
// into baby genres) can never be rescued into a real category by its genreId.
export function resolveCategory(
  title: string,
  genreId?: string | null,
): Category | 'unknown' {
  if (isTrialOrSamplePack(title)) return 'unknown'
  const local = classifyLocal(title)
  if (local !== 'unknown') return local
  return categoryFromGenreId(genreId) ?? 'unknown'
}
