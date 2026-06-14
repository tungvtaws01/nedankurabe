// Canonical brand id → every surface form seen on either platform (JP / EN / variants).
// Adding a brand = add one row. KIRKLAND and RICO are SEPARATE ids on purpose, so the
// brand gate treats them as a mismatch (same retailer/sheet-count ≠ same product).
export const BRAND_ALIASES: Record<string, string[]> = {
  pampers: ['パンパース', 'Pampers'],
  merries: ['メリーズ', 'Merries', 'Merys', 'Melys'],
  moony: ['ムーニー', 'Moony'],
  goon: ['グーン', 'GOON', 'Goo.n'],
  pigeon: ['ピジョン', 'Pigeon'],
  combi: ['コンビ', 'Combi'],
  aprica: ['アップリカ', 'Aprica'],
  ergobaby: ['エルゴベビー', 'エルゴ', 'Ergobaby', 'Ergo'],
  meiji: ['明治', 'Meiji'],
  morinaga: ['森永', 'Morinaga'],
  snowbrand: ['雪印', 'Snow Brand'],
  wakodo: ['和光堂', 'Wakodo'],
  kao: ['花王', 'Kao'],
  lec: ['レック', 'LEC'],
  iris: ['アイリスオーヤマ', 'Genki!'],
  nishimatsuya: ['西松屋'],
  kirkland: ['カークランド', 'KIRKLAND', 'Kirkland'],
  rico: ['RICO', 'リコ'],
  babybjorn: ['ベビービョルン', 'BabyBjorn', 'BabyBjörn', 'Baby Bjorn'],
  stokke: ['ストッケ', 'STOKKE', 'Stokke'],
  katoji: ['カトージ', 'KATOJI'],
  bumbo: ['バンボ', 'Bumbo'],
  ingenuity: ['インジェニュイティ', 'Ingenuity', 'Kids2'],
  yamatoya: ['大和屋', 'yamatoya'],
  richell: ['リッチェル', 'Richell'],
  babydan: ['ベビーダン', 'Babydan', 'BabyDan'],
  lascal: ['ラスカル', 'Lascal'],
  nihonikuji: ['日本育児'],
  omron: ['オムロン', 'OMRON'],
  tanita: ['タニタ', 'TANITA'],
  citizen: ['シチズン', 'CITIZEN'],
  dretec: ['ドリテック', 'dretec'],
  terumo: ['テルモ', 'TERUMO'],
  babysmile: ['ベビースマイル', 'BabySmile'],
  seastar: ['シースター'],
  tampei: ['丹平製薬', '丹平', 'Tampei'],
  lion: ['ライオン', 'LION'],
  jex: ['ジェクス', 'チュチュベビー', 'チュチュ', 'ChuChu'],
  edinter: ['エドインター', 'Ed Inter'],
  takaratomy: ['タカラトミー', 'Takara Tomy'],
  fisherprice: ['フィッシャープライス', 'Fisher-Price', 'Fisher Price'],
  sassy: ['サッシー', 'Sassy'],
  people: ['ピープル', 'People'],
  brightstarts: ['ブライトスターツ', 'Bright Starts'],
  kumon: ['くもん', 'KUMON', '公文'],
  marlmarl: ['マールマール', 'MARLMARL'],
  tenmois: ['10mois', 'ディモワ'],
  skater: ['スケーター', 'Skater'],
  edisonmama: ['エジソンママ', 'EDISONmama', 'Edison Mama'],
}

const NORMALIZED: Array<[string, string[]]> = Object.entries(BRAND_ALIASES).map(
  ([id, forms]) => [id, forms.map((f) => f.toLowerCase())],
)

// Returns the canonical brand id whose alias appears in the title, else null.
// Case-insensitive; on overlap the LONGEST matching alias wins.
export function normalizeBrand(title: string): string | null {
  const hay = title.toLowerCase()
  let bestId: string | null = null
  let bestLen = 0
  for (const [id, forms] of NORMALIZED) {
    for (const f of forms) {
      if (f.length > bestLen && hay.includes(f)) {
        bestId = id
        bestLen = f.length
      }
    }
  }
  return bestId
}

// True iff BOTH titles name a KNOWN brand and the brands differ. When either side
// has no recognised brand, returns false (defer to the LLM + NO-BRAND rule).
export function brandsAreDistinct(a: string, b: string): boolean {
  const ba = normalizeBrand(a)
  const bb = normalizeBrand(b)
  return ba !== null && bb !== null && ba !== bb
}
