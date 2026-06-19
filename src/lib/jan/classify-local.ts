import { type Category } from '../llm/category-prompts'
import { LEXICON, THRESHOLD } from './lexicon'

// Score every category by summed weights of matching token groups; return the highest
// scorer at or above THRESHOLD. Order-independent — specificity lives in `weight`, not
// list position. Ties broken by the higher weight already encoded; exact score ties fall
// through to 'unknown' (ambiguous) to avoid arbitrary first-match bias.
export function classifyLocal(title: string): Category | 'unknown' {
  const score = new Map<Category, number>()
  for (const { category, tokens, weight } of LEXICON) {
    if (tokens.test(title)) score.set(category, (score.get(category) ?? 0) + weight)
  }
  let best: Category | 'unknown' = 'unknown'
  let bestScore = THRESHOLD - 1
  let tied = false
  for (const [cat, s] of score) {
    if (s > bestScore) { best = cat; bestScore = s; tied = false }
    else if (s === bestScore) { tied = true }
  }
  return tied ? 'unknown' : best
}
