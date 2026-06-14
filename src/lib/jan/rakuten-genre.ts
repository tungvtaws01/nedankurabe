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
// Remaining out-of-scope parents (the キッズ umbrella 100533, ベビーインテリア 566090,
// the no-genre sentinel 0) are deliberately OMITTED so their items stay 'unknown'
// — the correct outcome, not a miss.
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

  // --- 2026-06-14 scope-expansion genres ---
  // 歯ブラシ・虫歯ケア (parent 551691): leaves mix brush/paste/wipe/tablet, so the
  // toothbrush↔toothpaste split is done by title regex (tier-1). Only the PURE
  // leaves are mapped here as a tier-2 fallback for keyword-less items; the mixed
  // leaves (551696/205204/551694) are intentionally left to the regex.
  '551692': 'toothbrush', '551693': 'toothbrush',  // 歯ブラシ / 仕上げブラシ
  '568329': 'toothbrush',                            // mostly 仕上げ磨き用 brushes (POSY/リーチ)
  '551695': 'toothpaste',                            // ジェル状歯みがき
  // スタイ・お食事エプロン (parent 407002)
  '407002': 'bibs', '407003': 'bibs', '407005': 'bibs', '407004': 'bibs', '407006': 'bibs',
  // ベビー食器 (parent 207750) — NOT 207753, that is ストローマグ → bottles
  '207750': 'tableware', '207751': 'tableware', '207752': 'tableware',
  '566111': 'tableware', '401170': 'tableware', '551698': 'tableware',
  // ベビーチェア (parent 566882)
  '566882': 'baby_chair', '213963': 'baby_chair', '566883': 'baby_chair',
  '566885': 'baby_chair', '551686': 'baby_chair', '566884': 'baby_chair',
  // バウンサー (parent 213968)
  '213968': 'bouncer',
  // ベビー向けおもちゃ (parent 201591)
  '201591': 'toys', '205272': 'toys', '201598': 'toys', '201592': 'toys', '205243': 'toys',
  '201595': 'toys', '204024': 'toys', '201596': 'toys', '205278': 'toys', '201597': 'toys', '201594': 'toys',

  // --- 2026-06-14 newly enumerated genres ---
  '505410': 'bath', '505413': 'bath',          // ベビーソープ / ベビーシャンプー (clean consumable genre)
  // The niche genres (鼻吸い器 207739, 体温計 567569, ベビーゲート 200841/200840, プレイ
  // マット 568495) are deliberately NOT mapped: those Rakuten genres are noisy — packed
  // with accessories (probe covers, tubes, adapters) and shop mis-tags (a blender, cereal,
  // a car door-guard). genreId there is unreliable, so these are TITLE-REGEX-ONLY
  // (classify-local). Keyword-less items in them stay 'unknown' (precision over coverage).
}

export function categoryFromGenreId(genreId: string | null | undefined): Category | null {
  if (!genreId) return null
  return GENRE_ID_TO_CATEGORY[String(genreId)] ?? null
}
