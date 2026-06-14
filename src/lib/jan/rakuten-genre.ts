import { type Category } from '../llm/category-prompts'

// Maps Rakuten Ichiba genreId → our fine product Category. Rakuten assigns a
// genreId to every item (RawRakutenItem.genreId), and the enumeration walks a
// fixed set of baby genres (scripts/harvest/genres.ts → mirrors GENRE_MAP in
// rakuten.ts). This is a STRUCTURED, shop-independent signal — more reliable than
// title regex for the cases it covers — so resolveCategory() uses it to fill the
// gaps regex leaves.
//
// Keyed by the LEAF genreId Rakuten stamps on each item (a child of the parent
// genre the harvest walks), discovered empirically with
// scripts/harvest/discover-genre-leaves.ts. Every leaf listed sits under a parent
// that maps cleanly to one category, so the whole subtree inherits that category.
// Out-of-scope parents (toys, baby chairs, bibs, tableware, dental, bouncers, the
// キッズ umbrella) are deliberately OMITTED so their items stay 'unknown' — the
// correct outcome, not a miss.
const GENRE_ID_TO_CATEGORY: Record<string, Category> = {
  // おむつ (parent 205197) — diaper size/type sub-genres
  '205197': 'diapers', '205198': 'diapers', '205199': 'diapers',
  '213973': 'diapers', '551689': 'diapers',
  // おしりふき (parent 205194) — single genre
  '205194': 'wipes',
  // 哺乳びん・授乳用品 (parent 205208) + ストローマグ (207753)
  '205208': 'bottles', '205209': 'bottles', '200828': 'bottles', '205210': 'bottles',
  '213979': 'bottles', '205211': 'bottles', '568330': 'bottles', '568331': 'bottles',
  '205242': 'bottles', '204020': 'bottles', '205212': 'bottles', '207753': 'bottles',
  // 粉ミルク (401171) + 液体ミルク (568293)
  '401171': 'formula', '568293': 'formula',
  // 離乳食・ベビーフード (213980)
  '213980': 'baby_food',
  // ベビーカー (parent 200833) — stroller type sub-genres
  '200833': 'strollers', '213952': 'strollers', '401151': 'strollers', '568494': 'strollers',
  '213944': 'strollers', '213948': 'strollers', '213945': 'strollers', '213943': 'strollers',
  '213949': 'strollers', '213950': 'strollers',
  // 抱っこひも・スリング (parent 566089)
  '566089': 'carriers', '412209': 'carriers', '401156': 'carriers', '401158': 'carriers',
  '412217': 'carriers',
  // チャイルドシート (parent 566088)
  '566088': 'car_seats', '203056': 'car_seats', '213954': 'car_seats', '563772': 'car_seats',
  '203051': 'car_seats', '407014': 'car_seats',
  // ベビーローション・オイル (205205) + 日焼け止め (401166)
  '205205': 'skincare', '401166': 'skincare',
}

export function categoryFromGenreId(genreId: string | null | undefined): Category | null {
  if (!genreId) return null
  return GENRE_ID_TO_CATEGORY[String(genreId)] ?? null
}
