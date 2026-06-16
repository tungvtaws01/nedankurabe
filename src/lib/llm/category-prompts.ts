// Category taxonomy + per-category keyword-extraction prompts.
//
// These prompts are EMPIRICALLY TUNED — each was iterated against real Amazon JP
// and Rakuten data and validated end-to-end (see scripts/tuning/*.md for the
// per-category tuning notes and probe results).
//
// Each tuned builder's body mirrors the corresponding scripts/prompts/*.txt file
// verbatim, with the {{platform}} / {{title}} placeholders rewritten as the
// ${platform} / ${title} template-literal interpolations. Keep the two in sync.
//
// CATEGORIES is the single source of truth; Category is derived from it so the
// runtime list and the type can never drift apart.

export const CATEGORIES = [
  'diapers', 'wipes', 'formula', 'bottles', 'baby_food',
  'carriers', 'strollers', 'car_seats', 'skincare', 'bath',
  // Added 2026-06-14 (scope expansion); each empirically tuned via the tune-category
  // skill (scripts/tuning/*.md) and baked into its own <CAT>_PROMPT below.
  'toothbrush', 'toothpaste', 'bibs', 'tableware', 'baby_chair', 'bouncer', 'toys',
  // Added 2026-06-14 (newly enumerated Rakuten genres — bath already existed but had
  // no dedicated genre crawled; these were not crawled before).
  'nasal_aspirator', 'thermometer', 'safety_gate', 'playmat',
] as const

export type Category = typeof CATEGORIES[number]

export type PromptBuilder = (platform: string, title: string) => string

// Cross-cutting anti-hallucination preamble prepended to EVERY keyword prompt by
// refineKeyword. Empirically, the per-category prompts (which translate via finite
// brand/line/type maps) make the model GUESS from training memory when a token is not
// in the map: it substitutes a more famous product line (母乳相談室→母乳実感,
// アイクレオ 赤ちゃんミルク→バランスミルク), forces the item type into the listed set
// (ストローボトル/乳頭保護器→哺乳びん), invents capacity/material (silicone item →
// プラスチック, no-capacity title → 380ml), or infers a brand from a shop/maker name.
// A 2026-06-15 audit found this in ~40% of no_match items across 5 genres. These rules
// OVERRIDE the per-category maps and are kept generic so they help every category.
export const ANTI_HALLUCINATION =
`CRITICAL — extract only what is written (these rules OVERRIDE the maps/examples below):
1. Use ONLY brand/line/type/size/material/capacity that LITERALLY appear in the title. NEVER invent or infer one (no guessed ml/g, no guessed size, no guessed material).
2. NEVER substitute a different or more famous product line/type for what is written. Translating the SAME written line/brand EN<->JP via the maps is fine; replacing 母乳相談室 with 母乳実感, or 赤ちゃんミルク with バランスミルク, is FORBIDDEN.
3. Keep the brand exactly as written (keep both Latin and katakana forms if both appear). Never take a shop/retailer/maker name as the brand.
4. If the item TYPE in the title is not in this category's list, output it VERBATIM — do not force it into the list (e.g. ストローボトル/ストローマグ/コップ/乳頭保護器/フリーザーパック stay as written, NOT 哺乳びん/乳首/消毒).

`

// Today's prompt, preserved verbatim as the fallback for unknown/low-confidence titles.
export const UNIVERSAL_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan.
Keep in this priority order:
1. Brand name (e.g. パンパース, メリーズ, Ergobaby, 明治ほほえみ — keep full brand name)
2. Product line / model name — highest priority after brand, never drop it
   (e.g. さらさらケア, OMNI Breeze, らくらくキューブ, ハイハイン, ADAPT)
3. Product type (e.g. テープ, パンツ, 抱っこひも, 粉ミルク, 離乳食)
4. Size / weight / volume from the product name — critical, always keep
   (e.g. 新生児, Sサイズ, 5kgまで, 800g, 540g, 60袋)
   Do NOT invent stage/age from context — only use what is in the title itself.
5. Count only if it distinguishes the product (e.g. 84枚, 20袋)

Remove: colors, promotional text, order codes (B0xxx, CREGBCZ, ASIN), shop names, adjectives like 送料無料/新作/おすすめ/期間限定.
Output plain text only, max 8 words.

Title: ${title}`

// Starter prompt for any FUTURE new category before it is tuned (the 2026-06-14
// scope-expansion genres have since been tuned into their own builders below). It is
// deliberately distinct from UNIVERSAL_PROMPT so the category-prompts test still
// guards every category against an accidental universal fallback. Tune per-category
// with the tune-category skill, then bake into a <CAT>_PROMPT.
export const NEW_GENRE_PROMPT: PromptBuilder = (platform, title) => `Extract a Japanese search keyword for ${platform} Japan for this baby product.
Output Japanese keywords, space-separated, in this priority order:
1. Brand — keep the maker/brand exactly as written in the title; NEVER invent one that is not present.
2. Product line / model / character name — keep verbatim, never generalize.
3. Product type noun (e.g. 歯ブラシ / 歯みがき / スタイ / お食事エプロン / ベビー食器 / ベビーチェア / ハイチェア / バウンサー / おもちゃ).
4. Size / age-stage / volume only if it appears in the title (e.g. 0-3才, 6ヶ月, 50g, Mサイズ).
Drop: colors, promotional text (送料無料/新作/期間限定), order codes, shop names, adjectives.
Output Japanese keywords only, max 7 words.

Title: ${title}`

// Empirically tuned diapers (おむつ) prompt — see scripts/taxonomy.md "diapers tuning"
// (validated end-to-end 10/10 via scripts/probe-keyword.ts). Body mirrors
// scripts/prompts/diapers.txt with {{platform}}→${platform} and {{title}}→${title}.
export const DIAPERS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this DIAPER (おむつ) product.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese): パンパース / メリーズ / ムーニー / ムーニーマン / グーン / マミーポコ / ゲンキ / ナチュラルムーニー
   (English to JP: Pampers=パンパース, Merries/Merys/Melys=メリーズ, Moony=ムーニー, Moonyman/Moony Man=ムーニーマン, Goo.n/Goon=グーン, Mamy Poko=マミーポコ, Genki=ゲンキ)
   If NO brand from this list appears in the title, do NOT substitute a famous brand — keep the actual maker/name written in the title, or omit brand. NEVER invent a brand that is not present.
2. Product line / tier (Japanese) — NEVER drop, NEVER generalize. Map English to JP:
   - Pampers "Smooth Care"/"Sarasara"=さらさらケア ; "First Skin"/"Baby's First Skin"=はじめての肌へのいちばん ; "Silky Touch"=さらさらケア
   - Merries "First Premium"=ファーストプレミアム ; "Air Through"/"Sarasara Air Through"=エアスルー
   - Moony "Marshmallow Skin"=マシュマロ肌ごこち ; "Natural Moony"/"Organic Cotton"=ナチュラルムーニー
   - Goon "Super Absorbent"/"Gungun"=ぐんぐん吸収
   - Swim/water-play pants: "Swim Pants"/"Swimming Pants"/"Water Play"/水遊び/水あそび=水あそびパンツ — a DISTINCT product, never reduce to plain パンツ.
   - Nighttime/training are distinct PRODUCTS — keep the name verbatim: オヤスミマン (night), トレパンマン (training), and Moonyman's ゆるうんちモレ安心.
   さらさらケア and はじめての肌へのいちばん are DIFFERENT tiers — keep whichever appears.
   If a clearly-named line/product appears that is not in this list, KEEP it verbatim — do not generalize to plain パンツ.
   Only include a line/tier that LITERALLY appears in the title. If none is named, OMIT it — never guess or add a line (e.g. do not add ファーストプレミアム or ぐんぐん吸収 unless the title says so).
3. Type/form: keep the FORM that appears — テープ (tape) / パンツ (pants) / 吸収パッド・パッド / ライナー / お産パッド. Always include it, and NEVER convert one form into another (a パッド or ライナー is not パンツ).
4. Size/weight — write letter sizes in FULL form with サイズ, never a bare letter:
   新生児 / Sサイズ / Mサイズ / Lサイズ / ビッグサイズ (NOT bare "S"/"M"/"L" — Rakuten shop titles use the サイズ suffix and a bare letter returns nothing).
   If there is no letter size, use the kg range as written (e.g. 5kgまで, 6-11kg).
   Use ONLY what is in the title. Do NOT invent.
5. Gender: KEEP 男の子用 / 女の子用 if present — swim pants and some pull-ups are gender-specific (different SKUs). This is NOT a color or character name; do not remove it.

Do NOT include: count (枚/枚数/袋), pack/case wording, ウルトラジャンボ/UJ/大容量/ケース品/まとめ買い, colors (青/ピンク/ブルー etc.), Disney/character names, order codes (B0xxx/ASIN), shop names, 送料無料/限定/Amazon.co.jp.

Output plain Japanese keywords only, no English, max 7 words.

Title: ${title}`

// Empirically tuned baby wipes prompt. Body mirrors scripts/prompts/wipes.txt.
export const WIPES_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY WIPES (おしりふき / ウェットティッシュ) product.

The Amazon title may be English-translated. Translate to Japanese and output Japanese ONLY.

Output Japanese keywords in this exact priority order, space-separated:

1. Brand (Japanese). Map English to JP:
   - Moony/Mooney/Moonie=ムーニー ; Natural Moony/Organic Cotton Moony=ナチュラルムーニー
   - Merries/Merys=メリーズ ; Goo.n/Goon/GOON=グーン ; Pampers=パンパース
   - Pigeon=ピジョン ; Wakodo=和光堂 ; LEC/Lek/レック=レック ; Genki=ゲンキ
   - "by Amazon"/MamaBear/Amazon basics baby=Amazonベーシック  (drop unknown 3rd-party seller prefixes like Tap Rich, SDKWDH, Thorl, BabyZarasu, Pikotta)
   If brand is unknown, use おしりふき as the generic anchor.

2. Product line / feature (Japanese). Keep the ONE that appears, map English to JP:
   - Pampers "Best for Skin"=肌へのいちばん
   - Moony "Soft Material"=やわらか素材 ; "Soft and Thick"/"Thick"=やわらか厚手 ; "Cashmere Touch"=カシミヤタッチ
   - Goon "Skin Friendly"/"Skin-Friendly"=肌にやさしい
   - Pigeon "Soft Thick Finish"=おしりナップ やわらか厚手仕上げ
   - LEC "Pure Water Baby Care"=純水ベビーケア
   - generic "99% Pure Water"=純水99% (use only if no stronger line word above)
   SPECIAL CASE: if the brand is ナチュラルムーニー (Natural Moony / Organic Cotton),
   the brand name IS the line — do NOT append やわらか素材/やわらか厚手. Add NO line token unless
   the title literally contains one. Never add a feature word (厚手/やわらか/純水) that is not in the title.

3. Form. Always include the one that applies:
   - Refill / つめかえ / 詰替 / Replacement=詰替
   - Case / 本体 / ケース付き=本体  (if neither stated, omit)

4. Count — include ONLY the per-pack sheet count and pack number if clearly stated,
   in the form 枚数×個数 (e.g. 76枚×8 , 56枚×12 , 70枚×10).
   Do NOT include the grand total (e.g. 608枚, 1200枚). Do NOT include "Case"/"x N sets" multipliers.
   If count is unclear, omit it rather than guess.

Do NOT include: 純水 percentage if a line word is present, ノンアルコール/無香料/無添加/弱酸性/保湿/日本製/Made in Japan, marketing words (送料無料/限定/まとめ買い/大容量/おすすめ/期間限定), colors, character/Disney names, order codes (B0xxx/ASIN), shop names, [Case Item]/[Amazon.co.jp Exclusive].

Keep it TIGHT: brand + line + form + count = at most 5 tokens. Over-specifying zeroes out Rakuten.
Output plain Japanese keywords only, no English, no punctuation except × between counts.

Title: ${title}`

// Empirically tuned formula prompt. Body mirrors scripts/prompts/formula.txt.
export const FORMULA_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this baby FORMULA (粉ミルク・液体ミルク) product.

Amazon titles are often English-translated. Translate to Japanese using these maps.

BRAND / LINE (English to JP):
- Meiji Hohoemi = 明治ほほえみ
- Meiji Step = 明治ステップ
- Morinaga Hagukumi = 森永はぐくみ
- Morinaga E Akachan / E-Akachan = 森永E赤ちゃん
- Morinaga Chil Mil / Chilmil = 森永チルミル
- Wakodo Lebens Milk Hai Hai / Haihai = 和光堂 レーベンスミルク はいはい
- Wakodo Gungun = 和光堂 フォローアップミルク ぐんぐん
- Bean Stark / Beanstalk Sukoyaka M1 = ビーンスターク すこやかM1
- Bean Stark / Beanstalk Tsuyoiko = ビーンスターク つよいこ
- Snow Brand Megmilk Pyua / PYUA = 雪印メグミルク ぴゅあ
- Icreo Balance Milk = アイクレオ バランスミルク
- Icreo Follow Up = アイクレオ フォローアップミルク

FORM — keep the form word; powder, cube, and liquid are DIFFERENT products, never conflate:
- powder in a can: emit NO form word (do NOT write the generic 粉ミルク); just use 大缶 if the title says Large Can
- Eco Raku Pack / Eco-Raku Pack Refill / Tsumekae = エコらくパック つめかえ用
- Eco Raku Pack First Set / hajimete set = エコらくパック はじめてセット
- Raku Raku Cube / Easy Cube / Raku-Raku Cubes = らくらくキューブ
- Easy Milk / Raku Raku Milk / Liquid Milk = らくらくミルク (this is 液体ミルク — liquid, in 缶/紙パック; NEVER write 粉ミルク for it)

STAGE — these are DIFFERENT products, keep whichever the title states, never swap:
- ほほえみ / はぐくみ / はいはい / すこやかM1 / バランスミルク / ぴゅあ / E赤ちゃん = 0ヶ月～ (newborn). Do NOT add ステップ/フォローアップ.
- Step / Follow Up / Follow-up = ステップ / フォローアップミルク (9ヶ月～ / 1歳～). Keep the line name as-is.

Output Japanese keywords in this priority order, space-separated:
1. Brand + line (from the map above)
2. Form word (らくらくキューブ / らくらくミルク / エコらくパック つめかえ用) ONLY if the title is that form. For a plain powder can, emit no form word at all.
3. Size as written in the title: g for powder/cube (800g, 540g, 1680g), ml for liquid (240ml). Keep 大缶 when present.

Never emit the generic word 粉ミルク by itself — it is too broad and zeros/pollutes the result set.

Remove: count multipliers / case wording (×2缶, ×8, ケース, x 24 Cans), oz/fl oz, bag breakdowns like (27g×20袋), 送料無料, marketing words, Amazon.co.jp限定/Exclusive, bonus/おまけ/スティック/attachment, order codes (B0xxx/ASIN), shop names, oligosaccharide/DHA ingredient lists.

Output plain Japanese keywords only, no English, max 5 words.

Title: ${title}`

// Empirically tuned bottles prompt. Body mirrors scripts/prompts/bottles.txt.
export const BOTTLES_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY BOTTLE / FEEDING (哺乳びん・授乳用品) product.

Amazon JP titles are often English-translated. Translate to Japanese using these maps.
Brands: Pigeon=ピジョン / Combi=コンビ / ChuChu=チュチュ / Betta or Dr. Betta or Doctor Betta=ドクターベッタ / NUK=ヌーク / Medela=メデラ / Richell=リッチェル / b.box=ビーボックス.
Product lines: "Breast Milk Feeling"/"Bonyu Jitsukan"/"Mother's Natural Feeling"/"Mother's Milk"=母乳実感 ; "teteo"/"Jyunyu no Otehon"=テテオ 授乳のお手本 ; "Brain"=ブレイン ; "Slim"/"Slim Type"=スリムタイプ ; "Multi-Fit"=マルチフィット ; "Premium Choice Learner Bottle"=プレミアムチョイス ラーナーボトル ; "Wide"/"Wide Mouth"=広口.
Medela pump models: "Easy"=イージー ; "Swing Maxi"=スイング マキシ ; "Harmony"=ハーモニー ; "Freestyle"=フリースタイル ; "Solo"=ソロ. Keep the model word.
Item type: "Baby Bottle"/"Feeding Bottle"=哺乳びん ; "Nipple"/"Teat"=乳首 ; "Breast Pump"/"Electric Breast Pump"/"Sakunyuki"=さく乳器 ; "Sterilizer"/"Sterilization"=消毒.
Material: "glass"/"Heat-resistant Glass"=ガラス ; "plastic"/"PPSU"/"Polyphenylsulfone"=プラスチック.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map above) — always keep.
2. Product line (Japanese, from map) — NEVER drop (母乳実感 / テテオ / ブレイン / スリムタイプ / プレミアムチョイス). Lines are different products; keep whichever appears.
3. Item type — exactly ONE of 哺乳びん / 乳首 / さく乳器 / 消毒. This is decisive: a nipple is NOT a bottle, a pump is NOT a bottle. Pick from the title.
4. Material: ガラス or プラスチック — only if the title states it (glass/PPSU/plastic). Skip if absent.
5. Capacity in ml as written (160ml / 240ml / 150ml). Keep if present.
6. Nipple size only if it is the defining attribute of a nipple item (Sサイズ / Mサイズ / 新生児).

Do NOT include: colors, character names (Disney/Bear/Tree/Bird/Music/Zoo/Flower/ライオンキング), 1個/2個入/セット, order codes (B0xxx/WS2/WS4/ASIN/品番), shop names, 送料無料/正規品/限定/出産祝い/医療機関, generic filler (ベビー用品/赤ちゃん/育児/ミルク/授乳用品).

Keep the keyword TIGHT — brand + line + type + material + capacity is enough. Over-specifying zeros the Rakuten result set.
Output Japanese keywords only, max 6 words.

Title: ${title}`

// Empirically tuned baby food prompt. Body mirrors scripts/prompts/baby_food.txt.
export const BABY_FOOD_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY FOOD / weaning product (離乳食・ベビーフード).

Amazon JP titles are often English-translated. Translate to Japanese using these maps.

BRAND (English to JP):
- Wakodo = 和光堂
- Kewpie / Kiewpy = キユーピー
- Pigeon = ピジョン
- Meiji = 明治
- Glico = グリコ
- Kameda / Kameda Seika = 亀田製菓
- Edison / Edisonmama = エジソンママ

PRODUCT LINE (English to JP) — never drop, this is decisive:
- Goo Goo Kitchen / GooGoo Kitchen / Goo Kitchen / Plenty of Ingredients = グーグーキッチン
- Nutrition Marche / Nutritional Marche / Nutrition Marché = 栄養マルシェ
- BIG Nutrition Marche / Big Size Nutrition Marche / ビッグサイズの栄養マルシェ = BIG栄養マルシェ
- Tezukuri Ouen / Homemade Support = 手作り応援
- Nico Nico Box / Niko Niko Box / Smile Box / Smiling Box = にこにこボックス
- Dietary Management Recipe / Dietary Recipes / Specialty Recipes / Feeding Recipes = 管理栄養士のこだわりレシピ
- Food Education Recipe / Nutritional Education Recipe / Educational Recipes = 食育レシピ
- High Hine / Haihin / Haihain = ハイハイン
- Vegetable High Hine / Vegetable Haihain = 野菜ハイハイン
- Baby Snack / Baby Treats / 赤ちゃんのおやつ = 赤ちゃんのおやつ

FORM / TYPE — keep the form word, these are DIFFERENT products:
- pouch / レトルト パウチ = パウチ
- jar / 瓶 = 瓶
- cup / カップ = カップ
- powder / 粉末 = 粉末
- snack / rice cracker / senbei / おやつ / せんべい = おやつ

AGE STAGE — DIFFERENT products, keep whichever the title states, never swap:
- 5 Months = 5ヶ月 ; 7 Months = 7ヶ月 ; 9 Months = 9ヶ月 ; 12 Months = 12ヶ月 ; 1 Year and 4 Months = 1歳4ヶ月
Output age as Nヶ月 (or 1歳4ヶ月). Only use what the title states.

Output Japanese keywords in this priority order, space-separated:
1. Brand (Japanese, from map) — always keep.
2. Product line (Japanese, from map) — NEVER drop. Lines are different products.
3. Age stage (Nヶ月 / 1歳4ヶ月) if the title states it.
4. SNACKS ONLY (おやつ / せんべい / cookies / biscuits / ウェハース / クッキー / ビスケット):
   ALSO keep the flavor/variety word — for snacks the flavor IS the distinguishing
   attribute (バナナクッキー ≠ かぼちゃクッキー ≠ ミルクウェハース ≠ チーズスティック).
   Translate snack flavors: Banana Cookies = バナナクッキー, Pumpkin Cookies = かぼちゃクッキー,
   Cheese Stick = チーズスティック, Milk Wafers = ミルクウェハース, Biscuit = ビスケット.
   Never collapse a snack to just brand + age.

For NON-snack meals/bento: keep the keyword TIGHT — brand + line + age is enough. Do NOT add the dish/flavor name; over-specifying zeros the Rakuten result set.

Remove (NON-snack only): flavor/variety descriptions (rice/fish/vegetable dish names), counts and set wording (16 Types x 2, 3 Servings, Assorted, Eating Comparison Set, 詰め合わせ, セット, ×2個, 80g×2), weights (80g, 70g, oz), bonus/おまけ/tissue/spoon/gauze, 送料無料/限定/出産祝い, order codes (B0xxx/ASIN/NA-75), shop names, generic filler (赤ちゃん, 幼児食, レトルト, ベビーフード alone, Made in Japan).

Output Japanese keywords only, no English, max 5 words.

Title: ${title}`

// Empirically tuned carriers prompt. Body mirrors scripts/prompts/carriers.txt.
export const CARRIERS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY CARRIER (抱っこひも / 抱っこ紐 / ベビーキャリア) product.

Amazon titles are often English-translated. Translate to Japanese and output Japanese ONLY.

The two decisive fields are BRAND and the EXACT MODEL/LINE NAME. The model name is the single most important token — NEVER drop it, NEVER generalize it, NEVER swap it for a similar model. Keep the model in katakana (Rakuten titles are usually katakana).

BRAND (English to JP):
- Ergobaby / Ergo Baby / EBC = エルゴベビー
- BabyBjorn / BabyBjörn / Baby Bjorn / Baby Björn / Bjorn = ベビービョルン
- Aprica = アップリカ
- Combi = コンビ
- napnap / Napnap = ナップナップ
- POGNAE = ポグネー
- BABY&Me / Baby and Me = ベビーアンドミー
- Konny = コニー
- montbell / mont-bell = モンベル

MODEL / LINE (English to JP) — pick the ONE that appears; this is the decisive token:
Ergobaby:
- OMNI Breeze = オムニブリーズ
- OMNI 360 / Omni 360 Cool Air = オムニ360 (Rakuten often writes オムニ 360 クールエア — keep クールエア if the title says Cool Air)
- OMNI Deluxe = オムニ デラックス
- ADAPT (SoftFlex / SoftTouch) = アダプト (ソフトフレックス / ソフトタッチ) — keep ソフトフレックス/ソフトタッチ if present
- EMBRACE (Soft Air) = エンブレース (ソフトエアー) — keep ソフトエアー if present
- Aerloom = エアルーム
- Alta Hip Seat = アルタ ヒップシート
BabyBjorn:
- Harmony = ハーモニー
- Move / MOVE = ムーブ
- One KAI Air / One Kai Air = ワンカイエアー
- One Air / ONE Air = ワンエアー
- Mini Air / MINI = ミニ エアー
- Free = フリー
Aprica:
- Koala Ultra Mesh EX / Koala UltraMesh EX = コアラ ウルトラメッシュ EX
- Koala (plain) = コアラ
- Coalanghug / Colanghug Light = コランハグ
napnap:
- Tran (Hip Seat) = トラン (ヒップシート)
- Vision = ヴィジョン
- BASIC = ベーシック

Output Japanese keywords in this priority order, space-separated:
1. Brand (Japanese, from map). Always include.
2. Exact model / line (Japanese katakana, from map). Always include — this is the decisive field.
3. Carry-type only if it is the distinguishing form for that brand (ヒップシート for napnap Tran). Otherwise omit.

Keep it TIGHT: brand + model = usually 2-4 tokens. Over-specifying (color, 新生児, 4WAY, メッシュ, 送料無料, 正規品, carry positions, marketing) shrinks or zeroes Rakuten results — do NOT add them.

Do NOT include: colors, 新生児/0ヶ月/月齢, 4WAY/3WAY, メッシュ unless it is part of the model name (ウルトラメッシュ), 対面/前向き/おんぶ/腰, 送料無料/正規品/10年保証/2年保証/SG基準/出産祝い/限定/新作, order codes (CREGBC.../B0xxx/ASIN/numeric SKUs), shop names, attachments (よだれパッド/カバー).

Output plain Japanese keywords only, no English, no punctuation. Max 5 words.

Title: ${title}`

// Empirically tuned strollers prompt. Body mirrors scripts/prompts/strollers.txt.
export const STROLLERS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this STROLLER / BUGGY (ベビーカー・バギー) product.

Amazon JP titles are often English-translated; Rakuten titles are katakana. Translate to Japanese using these maps.

BRANDS (English to JP) — always keep:
- Aprica = アップリカ
- Combi = コンビ
- Pigeon = ピジョン
- Cybex = サイベックス
- Graco = グレコ
- Joie = ジョイー
- Richell = リッチェル
- Nishimatsuya = 西松屋

MODEL / LINE — highest priority after brand, NEVER drop, NEVER generalize. Keep the exact line word AND its alphanumeric grade code (AH / AG / AF / AD / AI / AC / GB / RB5 / BB6) when the title has one:
- Aprica: "Luxuna Cushion" / "Racuna Cushion" / "Rakuna Cushion" = ラクーナクッション ; "Luxuna Cushion Free" / "Racuna Cushion Free" = ラクーナクッションフリー ; "Magical Air" = マジカルエアー ; "Magical Air Free" = マジカルエアーフリー ; "Karoon Air Mesh" = カルーンエアーメッシュ ; "Karoon Air" = カルーンエアー ; "Optia Cushion Grace" / "Optier Cushion" / "Opti-Cushion" = オプティアクッショングレイス ; "Optia" = オプティア ; "Smoove" = スムーヴ
- Combi: "Sugocal" = スゴカル ; "Sugocal Switch" = スゴカルSwitch ; "Mechacal" = メチャカル ; "White Label" = ホワイトレーベル ; "Egg Shock" = エッグショック
- Cybex: "Libelle" = リベル ; "Melio" = メリオ ; "Mios" = ミオス ; "Eezy S" = イージーS
- Graco: "Citi Star" / "City Star" = シティスター ; "Citi" = シティ
- Pigeon: "Runfee" = ランフィ ; "Bingle" = ビングル

TYPE — keep exactly the one the title states; A型 / B型 / AB型 are DIFFERENT products, never swap or invent:
- "A-Type" / "A-Shaped" / "A-Shape" / "A formula" = A型
- "B-Type" / "B-Shaped" / "B-Shape" = B型
- "AB-Type" = AB型
- "three-wheel" / "3輪" = 三輪 ; "buggy" = バギー

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep.
2. Model / line (Japanese, from map) — NEVER drop. Include the grade code (AH/AG/AF/AD/AI/AC/GB/RB5...) if the title has one; it distinguishes model years/grades.
3. Type — A型 / B型 / AB型 / 三輪 / バギー — only if the title states it.

Do NOT include: colors (Navy/Beige/Black/Gray/Green/ネイビー/ベージュ), model years (2024/2025/2026 Model), age/weight ranges (1 Month to 36 Months / 7ヶ月 / 22kg / 15kg), order/ASIN codes (B0xxx / 2217030 / 7-digit numbers), shop names, marketing (送料無料/正規品/3年保証/即納/限定/出産祝い/軽量/コンパクト/折りたたみ/両対面/オート4輪), rain covers / accessories / レインカバー / バンパーバー unless the product IS the accessory. There is NO count dimension for strollers — never add 個/台/セット.

Keep the keyword TIGHT — brand + model(+grade) + type is enough. Over-specifying (color, year, weight, marketing) shrinks or zeros the Rakuten result set.
Output Japanese keywords only, max 5 words.

Title: ${title}`

// Empirically tuned car seats prompt. Body mirrors scripts/prompts/car_seats.txt.
export const CAR_SEATS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this CHILD CAR SEAT (チャイルドシート / ジュニアシート / ベビーシート) product.

Amazon JP titles are often English-translated; Rakuten titles are katakana. Translate to Japanese and output Japanese ONLY.

The decisive fields are BRAND + EXACT MODEL + INSTALL (ISOFIX vs シートベルト固定) + AGE GROUP. The model name is the single most important token — NEVER drop it, NEVER generalize it, NEVER swap a similar model.

BRANDS (English to JP) — always keep:
- Aprica = アップリカ
- Combi = コンビ
- Cybex = サイベックス
- Joie = ジョイー
- Recaro = レカロ
- Maxi-Cosi = マキシコシ
- Graco = グレコ
- Takata = タカタ
- AileBebe / Ailbebe / Elbebe / Carmate = エールベベ
- Leaman = リーマン
- Nishimatsuya = 西松屋

MODEL / LINE (English to JP) — pick the ONE that appears; Amazon spells these many ways, all map to the same katakana:
Aprica:
- Cururila / Crurilla / Kururilla / KuruRila / Kururia / Cururia = クルリラ ; keep the grade word EXACTLY — these are DIFFERENT models, never merge: "X Plus" = エックスプラス ; "Plus Light" / "+ Lite" = プラスライト ; "Bright" / "Prite" = プライト ; "Light" (alone) = ライト
- Fradia / Fladia / FradiaGrow / Fladea / Fradia Grow = フラディア ; "Fradia Grow" = フラディアグロウ
- Dearturn = ディアターン
- Reride = リライド
Combi:
- Kurumove / Crew Move / Culmove = クルムーヴ ; "Compact" = コンパクト ; "Long" = ロング ; keep エッグショック if present
- Neroom = ネルーム
- Joytrip = ジョイトリップ
Cybex:
- Cloud = クラウド ; Sirona = シローナ ; Aton = エイトン (keep grade like T / G / Z2 if present)
Joie:
- Arc / I-Arc / Eye Arc = アイアーク ; Tilt = チルト ; Elevate = エレベート ; I-Pivot = アイピボット ; I-Avana / I-Irvana = アイアバーナ
Graco:
- Junior Plus / Junior Plus Next = ジュニアプラス (keep ネクスト if "Next") ; G-Junior = Gジュニア
AileBebe:
- Kurutto / Cruit / Kurt = クルット ; "Kurt R" / "Cruit R" = クルットR ; "The First 2" = ザファースト2 ; "Grand 2" / "Grans 2" = グランス2 ; "Slide" = クルットスライド

INSTALL — keep exactly what the title states; ISOFIX and シートベルト固定 are DIFFERENT products, never swap or invent:
- "ISOFIX" / "Isofix" / "アイソフィックス" = ISOFIX
- "Seat Belt Fixed" / "Belt Fixed" / "シートベルト固定" = シートベルト固定

AGE GROUP — keep only if the title states it (newborn seat vs booster are different products):
- "Newborn" / 新生児 = 新生児 ; "Junior Seat" / "Booster" / ジュニアシート = ジュニアシート

Output Japanese keywords in this priority order, space-separated:
1. Brand (Japanese, from map) — always include.
2. Exact model / line (Japanese katakana, from map) — always include, this is the decisive field.
3. Install — ISOFIX or シートベルト固定 — only the one the title states.
4. Age group word ジュニアシート ONLY for booster / junior seats (the title's primary type is "Junior Seat" / "Booster" with no newborn use, e.g. Graco Junior Plus). Do NOT add ジュニアシート to a newborn/rotating seat even if the marketing text mentions ジュニアシート — it over-narrows the result set.

Keep the keyword TIGHT — brand + model + install is usually 3-4 tokens. Over-specifying (color, year/2024/2025 Model, R129, weight/age ranges like 新生児～4歳, 回転式, marketing 正規品/送料無料/保証, order codes B0xxx / 7-digit numbers / BF136, shop names) shrinks or zeroes the Rakuten result set — do NOT add them. There is NO count dimension for car seats — never add 個/台/セット.

Output plain Japanese keywords only, no English, no punctuation. Max 5 words.

Title: ${title}`

// Empirically tuned skincare prompt. Body mirrors scripts/prompts/skincare.txt.
export const SKINCARE_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY SKINCARE (ベビースキンケア) product.

The Amazon title may be English-translated. Translate to Japanese and output Japanese ONLY.

Output Japanese keywords in this exact priority order, space-separated:

1. Brand (Japanese). Map English to JP:
   - Alobaby/Aloe Baby/ALOBABY = アロベビー
   - Pigeon = ピジョン ; Atopita = アトピタ ; Curel = キュレル
   - Johnson/Johnson's = ジョンソン ; Merries = メリーズ
   - Mama&Kids/Mama and Kids = ママ&キッズ ; Weleda/WELEDA = ヴェレダ
   - arau.baby/Arau Baby = アラウベビー ; Wakodo = 和光堂
   - Kenei (Baby Vaseline) = ベビーワセリン (the product name IS the anchor; drop maker 健栄製薬/Kenei)
   - Minon = ミノン ; Cow/牛乳石鹸 = 牛乳石鹸
   If brand is unknown, use the product-type word as the anchor.

2. Product line / variant (Japanese) — KEEP whichever appears, map English to JP:
   - Alobaby "Milk Lotion" = ミルクローション ; "UV Moist Milk"/"UV & Outdoor" = UVモイストミルク ; "Mushiyoke"/insect = 虫除け
   - Pigeon "Baby Milk Lotion"/"Baby Mill Lotion" = ベビーミルクローション ; "うるおいプラス"/"Uruoi Plus"/"Moisture Plus" = うるおいプラス ; "Momonolea"/"Momonoha"/"Momonoba"/"Peppermint Leaf"/"Peach Leaf"/"Thigh Leaves" = ももの葉 (this is a 薬用ローション; emit ピジョン ももの葉 + size, do not add a separate ローション token)
   - Atopita "Moisturizing Whole/Full Body Milk/Milky Lotion" = 保湿全身ミルキィローション ; "Moisturizing Whole/Full Body Foaming/Foam Soap" = 保湿全身泡ソープ ; "Baby Lotion" = ベビーローション乳液
   - Weleda "Calendra/Calendula" = カレンドラ ; "Calendra Baby Milk Lotion" = カレンドラ ベビーミルクローション ; "Calendra Baby Oil" = カレンドラ ベビーオイル ; "Calendra Baby Wash & Shampoo" = カレンドラ ベビーウォッシュ&シャンプー
   Keep ONLY the line that literally appears. Do NOT add a line word that is not in the title.
   For Weleda, the full type word (ミルクローション / ベビーオイル / ウォッシュ) is part of the line — keep it, do NOT shorten ミルクローション to just ローション.

3. Product TYPE (Japanese) — VERY DECISIVE, must match. A lotion is NOT a UV is NOT a wash.
   Map English to JP and ALWAYS include the one the title states:
   - Lotion/Milk Lotion/Milky Lotion = ローション (or ミルクローション if line above already says so — do not duplicate)
   - Cream = クリーム ; Milk (body milk) = ミルク
   - Sunscreen/UV/UV Milk/UV Cream = UV ; or 日焼け止め
   - Foam Soap/Foaming Soap/Body Wash/Wash = 泡ソープ ; Shampoo = シャンプー
   - Baby Oil/Oil = ベビーオイル ; Gel = ジェル ; Balm = バーム ; Vaseline = ワセリン
   If the line word in step 2 already encodes the type (e.g. ミルクローション, 泡ソープ, ベビーオイル), do not add a redundant type word.

4. Size (ml or g) exactly as written in the title (e.g. 380ml, 300g, 200ml, 350ml, 100g, 120ml).
   Convert fl oz / oz back to the ml/g the title gives in parentheses; use that ml/g value.
   Always keep size — it separates本体 from つめかえ sizes.

Do NOT include: つめかえ/詰替/Refill, セット/set/×N本/2本/Bottles, 送料無料/限定/まとめ買い/大容量/お徳用, オーガニック/無添加/無香料/敏感肌/弱酸性/低刺激/保湿 marketing claims, SPF/PA values, scent variants (微香性/無香料/Gentle Aroma), Disney/character/Hello Kitty names, [Amazon.co.jp Exclusive], order codes (B0xxx/ASIN), shop/maker names.

Keep it TIGHT: brand + line + type + size = at most 5 tokens. Over-specifying zeroes out Rakuten.
Output plain Japanese keywords only, no English, no punctuation.

Title: ${title}`

// Empirically tuned bath prompt. Body mirrors scripts/prompts/bath.txt.
export const BATH_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY BATH / INFANT BATHING (お風呂・沐浴用品) product.

Amazon JP titles are often English-translated. Translate to Japanese using these maps.
Brands: Richell=リッチェル / Eiwa or Nagawa or Wawa=永和 / Aprica=アップリカ / Combi=コンビ / Pigeon=ピジョン / Stokke=ストッケ / Swimava or Swimmer=スイマーバ / Nishimatsuya=西松屋.
Product lines / models: "Plush" or "Fluffy" or "Fukafuka"=ふかふか ; "Baby Bath Plus K"=ベビーバスプラスK ; "Step Up"=ステップアップ ; "Cool Bath Mat" or "Non-Cool Bath Mat" or "Hinyari Shinai"=ひんやりしないおふろマット ; "Funwari"=ふんわり ; "Hajimete no Ofuro kara Tsukaeru"=はじめてのお風呂から使える ; "Yuonkei"=湯温計 ; "Body Ring"=ボディリング ; "Neck Ring" or "Ukiwa Kubi Ring"=うきわ首リング.
Item type — DECISIVE, pick exactly ONE that matches the title:
  "Baby Bath" or "Baby Bathtub" or "Bathtub"=ベビーバス ; "Bath Chair" or "Bath Seat" or "Bath Support" or "Baby Chair"=バスチェア ; "Bath Mat"=おふろマット ; "Thermometer" or "Hot Water Thermometer" or "Bath Thermometer"=湯温計 ; "Shower"=シャワー ; "Swim Ring" or "Float" or "Body Ring"=浮き輪 ; "Bathrobe"=バスローブ ; "Washbasin"=洗面器.
A baby bath tub is NOT a bath chair; a bath mat is NOT a tub; a thermometer is NOT a tub. Match the type exactly.
Feature: "foldable"=折りたたみ ; "inflatable" or "air pump"=空気入れ / エアポンプ ; "with mat" or "mat included"=マット付き. Keep only if stated.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep when present.
2. Product line / model (Japanese, from map) — NEVER drop (ふかふか / ベビーバスプラスK / ステップアップ / ひんやりしないおふろマット / ふんわり / はじめてのお風呂から使える / ボディリング). Lines are different products.
3. Item type — exactly one of ベビーバス / バスチェア / おふろマット / 湯温計 / シャワー / 浮き輪 / バスローブ / 洗面器. This is decisive.
4. Feature: 折りたたみ / 空気入れ / マット付き — only if the title states it.
5. Size only if stated as a defining attribute (新生児 only if it is the model name itself, otherwise skip).

Do NOT include: colors (ベージュ/グレー/ピンク/イエロー/グリーン), character names (くま/スヌーピー/ミッフィー/Snoopy/Miffy/白くま/しろくま — keep 白くま only for ピジョン 湯温計 where it is the model), order/品番 codes (120030/SW130/B0xxx/ASIN), shop names, 送料無料/正規品/出産祝い/プレゼント/クリスマス/限定, generic filler (赤ちゃん/ベビー/ベビー用品/お風呂グッズ/沐浴/入浴).

THE TARGET PLATFORM FOR THIS REQUEST IS: ${platform}. Apply exactly ONE of the two rules below based on that value.

RULE A — when ${platform} = rakuten (DEFAULT, full keyword):
Emit the FULL Japanese keyword: brand + product line/model + type (+ feature if stated). Rakuten titles are fully descriptive, so the line word is what discriminates ふかふかベビーバスプラスK from ステップアップ from 抗菌K — NEVER drop the line. Example: source "Richell Plush Baby Bath Plus K" → keyword "リッチェル ふかふか ベビーバスプラスK". Source "Richell Step Up Plush Baby Bath" → "リッチェル ふかふか ベビーバス ステップアップ".

RULE B — when ${platform} = amazon (minimal keyword):
Amazon JP titles are English-translated, so Japanese line/feature words in katakana (ボディリング / マット付き / ひんやりしない / ステップアップ / プラスK) usually return ZERO results. Keep the keyword MINIMAL: brand + ONE broad Japanese type word only (ベビーバス / バスチェア / おふろマット / 湯温計 / 浮き輪). DROP katakana line names and feature words. Example: source "リッチェル ふかふか ベビーバスプラスK" → keyword "リッチェル ベビーバス". Source "スイマーバ ボディリング" → "スイマーバ 浮き輪".

Output Japanese keywords only, max 6 words.

Title: ${title}`


// Tuned toothbrush prompt — mirrors scripts/prompts/toothbrush.txt (see scripts/tuning/toothbrush.md).
export const TOOTHBRUSH_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY/KIDS TOOTHBRUSH (歯ブラシ・ハブラシ) product.

Amazon JP titles are usually Japanese. If any part is English, normalize with these maps.
Brands: Pigeon=ピジョン / Combi=コンビ / Ebisu or EBiSU=エビス / Lion=ライオン / Clinica Kid's or Clinica Kids=クリニカKid's / Wakodo=和光堂 / HAMICO=HAMICO / ChuChu=チュチュ.
Product lines: "teteo"/"Hajimete Hamigaki"=テテオ はじめて歯みがき ; "Nyushi Brush"/"Lesson"=乳歯ブラシ レッスン段階 ; "Nikopika"=にこピカ.
Item type: "Toothbrush"=歯ブラシ ; "Electric Toothbrush"=電動歯ブラシ.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep. For Clinica include ライオン クリニカKid's.
2. Product line, Japanese, ONLY for Pigeon — keep verbatim WITH its stage number:
   乳歯ブラシ レッスン段階4 etc. (Pigeon lesson) / 乳歯ケア (Pigeon finishing).
   For Combi, the brand コンビ テテオ already identifies the line — do NOT add はじめて歯みがき (it bloats the query and zeros Rakuten).
3. Item type — decisive, choose ONLY from what the title literally states:
   電動仕上げブラシ (electric finishing) if "電動" appears in the title — an electric brush is NOT a manual one.
   仕上げみがき用 or 仕上げ専用 (finishing brush, parent applies) ONLY if 仕上げ appears in the title — a finishing brush is a DISTINCT product from a child's own brush. Do NOT add 仕上げ when the title has no 仕上げ.
   Otherwise just 歯ブラシ or ハブラシ.
4. Age / stage — ONLY copy it if the exact characters appear in the title; keep verbatim WITH its number/digits, in full form. Examples of forms you may copy: レッスン段階4, 0-2才用, 3-5才用, 6-12才用, 0.5〜2歳向け, 2〜6歳向け, 6歳以上向け, 12か月~, 1才6か月~, 6ヶ月.
   For Pigeon レッスン段階, keep the digit — NEVER shorten to bare レッスン段階 (each numbered stage is a different product).
   ABSOLUTE RULE: NEVER invent, guess, or infer an age/stage. If no age string is literally present in the title, output NO age token at all. Adding an age that is not in the title zeros the Rakuten search.

Do NOT include: colors (ピンク/ブルー/グリーン/オレンジ), character names (ドラえもん/ミッフィー/ハローキティ/キティ/シナモロール/名探偵コナン/すみっコぐらし/リサとガスパール/いないいないばあっ), pack/count (2本入/12本/×3本/1個/セット), order codes (B-6382/Ci602/ASIN/B0xxx), shop names, 送料無料/正規品/出産祝い/プレゼント/メール便, marketing filler (やわらかい/かわいい/おしゃれ/人気/おすすめ/赤ちゃん/ベビー用品/子供用).

Keep the keyword TIGHT — brand + line + type + stage is enough. Over-specifying zeros the Rakuten result set.
Output Japanese keywords only, max 6 words.

Title: ${title}`

// Tuned toothpaste prompt — mirrors scripts/prompts/toothpaste.txt (see scripts/tuning/toothpaste.md).
export const TOOTHPASTE_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY / KIDS TOOTHPASTE (子供用歯みがき・歯みがきジェル) product.

Amazon JP titles are in Japanese; no English translation is needed. Use the title as-is.

What decides a toothpaste match, in priority order:
1. Brand — ALWAYS keep. ピジョン(Pigeon) / コンビ(Combi) / テテオ(teteo) / ジェクス チュチュベビー(ChuChu) / L8020 / 丹平製薬(ハミケア) / 和光堂(にこピカ) / クリニカKid's(LION) / チェックアップ(Check-Up・ライオン歯科材) / ライオン / アラウ.ベビー / ソダテコ.
2. Product line / sub-brand — keep when present: 親子で乳歯ケア / ぷちキッズ / にこピカ / ハミケア / チェックアップジェル / クリニカKid's.
3. Form — DECISIVE, pick exactly ONE that matches the title. Different form = different product:
   ジェル状歯みがき / 歯みがきジェル (gel) ; ペースト・ハミガキ (paste) ; 泡・フォーム (foam) ; タブレット・粒 (tablet) ; マウスドロップ・スプレー (drop/spray, e.g. ハミケア) ; 歯みがきナップ / 歯みがきシート (wipe). A gel is NOT a tablet, a wipe, a spray, or a paste.
4. Flavor — keep when present; a DIFFERENT flavor is a DIFFERENT product, never drop or change it:
   ぶどう/グレープ(grape) ; いちご/ストロベリー(strawberry) ; りんご(apple) ; メロン(melon) ; みかん/オレンジ(orange) ; バナナ(banana) ; ピーチ(peach) ; ヨーグルト ; ミント ; 無香料(unscented). 「キシリトール」 is sweetener, NOT a flavor.
5. フッ素 ppm if the title states it (例: 950ppm).
6. Volume — keep when present: 40ml / 50g / 30g / 25g / 60g.

Remove: 個数/セット (×3個, 2個セット, 60粒), colors, character names, ages/月齢 unless part of the line name (9ヵ月頃から, 1歳頃から → drop), order/JAN codes (B0xxx, ASIN, 490xxxx), shop/倉庫 names, 医薬部外品, 送料無料/正規品/まとめ買い/お買い得/プレゼント/出産祝い, generic filler (赤ちゃん/ベビー/子供/キッズ/オーラルケア/虫歯予防/乳歯ケア/歯磨き後/離乳食).

THE TARGET PLATFORM FOR THIS REQUEST IS: ${platform}. Apply exactly ONE of the two rules below based on that value.

RULE A — when ${platform} = rakuten (DEFAULT, full keyword):
Rakuten titles are fully descriptive, so emit the FULL Japanese keyword: brand + line + form + flavor (+ volume). The flavor and line are what discriminate variants, so keep them. Example: source "ピジョン ジェル状歯みがき いちご味 40ml" → "ピジョン ジェル状歯みがき いちご 40ml". Source "ジェクス チュチュベビー L8020乳酸菌 薬用ハミガキジェル ぶどう風味 50g" → "チュチュベビー L8020 ハミガキジェル ぶどう".

RULE B — when ${platform} = amazon (TIGHT keyword):
Amazon JP search AND-matches every token and zeroes out on over-specification. Keep the keyword TIGHT: brand + ONE form word + flavor (drop the volume). Use the FULL brand token Amazon indexes — for ChuChu use チュチュベビー (not チュチュ). Example: source "ピジョン 親子で乳歯ケア ジェル状歯みがき いちご味 40ml" → "ピジョン ジェル状歯みがき いちご". Source "コンビ テテオ 子供用 歯磨きジェル ぶどう味" → "コンビ 歯磨きジェル ぶどう".
IMPORTANT: use ONLY a form word that literally appears in the title. NEVER invent a form. If the title has no form word and the line/sub-brand IS the product identity (e.g. ハミケア, にこピカ シート), keep brand + line + flavor and add NO form word. Example: source "丹平製薬 ハミケア グレープ風味 25g" → "丹平製薬 ハミケア グレープ" (do NOT add ジェル). Source "和光堂 にこピカ 歯みがきシート" → "和光堂 にこピカ シート".

Output Japanese keywords only, max 6 words.

Title: ${title}`

// Tuned bibs prompt — mirrors scripts/prompts/bibs.txt (see scripts/tuning/bibs.md).
export const BIBS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BIB / BABY EATING-APRON (スタイ・よだれかけ・お食事エプロン) product.

The Amazon title may be English-translated. Translate to Japanese and output Japanese ONLY.

Output Japanese keywords in this exact priority order, space-separated:

1. Brand (Japanese). KEEP the brand. Map English to JP:
   - MARLMARL/Marlmarl = マールマール
   - BabyBjorn/BabyBjörn/Baby Bjorn = ベビービョルン
   - 10mois/Dimois = 10mois ディモワ (keep both tokens)
   - Bibetta = ビベッタ ; Skater = スケーター ; Konny = コニー
   - Bemute = ベムート ; Aenababy = アエナベビー ; Hoppetta = ホッペッタ
   If the brand is unknown / a no-name boutique item, use the product-type word as the anchor.

2. Product line / collection / design name (Japanese) — KEEP whichever literally appears.
   Bibs are design-heavy: a named collection decides the match. Examples to keep if present:
   - MARLMARL: deco デコ, joujou ジュジュ, bouquet ブーケ, dolce ドルチェ, tutu — keep the line word.
   - 10mois/ディモワ: マロービブ, 6重ガーゼ, シリコンビブ — keep it.
   - Skater character lines (おさるのジョージ, ミッキー, ハローキティ) — keep the character name.
   - Konny: パイピング — keep it.
   Do NOT invent a line that is not in the title.

3. Product TYPE (Japanese) — VERY DECISIVE, must match. A feeding apron is NOT a drool bib.
   Pick the ONE the title states and keep it:
   - スタイ / よだれかけ / ビブ = drool bib (newborn neckwear). These are interchangeable; emit スタイ.
   - お食事エプロン / 食事エプロン = feeding apron (mealtime). Keep お食事エプロン.
   - 長袖エプロン / 長袖お食事エプロン = long-sleeve feeding apron — keep 長袖.
   - つけ襟 = collar-style bib.
   Do NOT swap a feeding apron for a drool bib or vice-versa.

4. Key feature / material (Japanese) — keep at most ONE that defines the item, if present:
   - シリコン (silicone) ; 防水 (waterproof) ; 6重ガーゼ / ガーゼ (gauze) ;
   - 360度 / まあるい / 丸型 (round) ; スナップ ; 撥水
   Skip if it would push the keyword over-long.

Do NOT include: pack/piece counts (2枚, 3枚セット, ×N), colors (ピンク/ブルー/8カラー), sizes unless they are the only distinguisher, 送料無料/出産祝い/ギフト/プレゼント/名入れ/刺繍/ラッピング, 保育園/離乳食/赤ちゃん/ベビー generic words, おしゃれ/かわいい, order codes (B0xxx/SBEP1/ASIN), shop/maker names (フィセル).

Keep it TIGHT: brand + line + type + (one feature) = at most 5 tokens. Over-specifying zeroes out Rakuten.
Output plain Japanese keywords only, no English except brand tokens like 10mois, no punctuation.

Title: ${title}`

// Tuned tableware prompt — mirrors scripts/prompts/tableware.txt (see scripts/tuning/tableware.md).
export const TABLEWARE_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY TABLEWARE (ベビー食器: お皿・ボウル・コップ・スプーン・フォーク・おはし・ランチプレート・食器セット) product.

The Amazon title may be English-translated. Translate to Japanese and output Japanese ONLY.

Output Japanese keywords in this exact priority order, space-separated:

1. Brand (Japanese). KEEP the brand. Map English to JP:
   - Richell = リッチェル ; Pigeon = ピジョン ; Combi = コンビ
   - EDISONmama / EDISON mama / Edison = エジソンママ
   - NUK = ヌーク ; Skater = スケーター ; Agatsuma = アガツマ
   - Le Creuset = ル・クルーゼ ; MIKIHOUSE / Miki House = ミキハウス
   - LEC = レック
   If the brand is unknown / a no-name boutique item, use the product-type word as the anchor.

2. Product line / character series (Japanese) — KEEP whichever literally appears; it defines the SKU.
   - Richell: ピーナッツ コレクション (Snoopy line), おでかけ — keep the line word.
   - Pigeon: KIPPOI — keep it.
   - EDISONmama: あつまる / もぐもぐ / くるくる — these name the SKU (あつまるプレート,
     あつまるボウル, もぐもぐトレイ, くるくるプレート). Keep the line word; it decides the match.
   - Combi: ベビーレーベル plus ステップアップ食器セット / ナビゲート食器セット — keep the full line.
   - Character series decide the SKU: アンパンマン, ミッフィー, おはなし, スヌーピー,
     くまのプーさん, ミッキー, トーマス, ドラえもん, おさるのジョージ, ハローキティ —
     keep the character name if present.
   Do NOT invent a line that is not in the title.

3. Product TYPE (Japanese) — VERY DECISIVE. A SET is not a single item; a plate is not a spoon.
   Pick the ONE the title states and keep it:
   - 食器セット / お食事セット / 〜点セット = multi-piece set — emit 食器セット.
   - プレート / ランチプレート / 仕切り皿 / お皿 = plate.
   - ボウル / お椀 / 茶碗 = bowl.
   - コップ / カップ = cup.
   - スプーン / フォーク / スプーンフォーク / カトラリー = utensils.
   - おはし / 箸 / 箸トレーニング = chopsticks.
   Keep set-vs-single exactly as the title states; do not swap a set for a single piece.

4. Key material / feature (Japanese) — keep at most ONE that defines the item, if present:
   - メラミン (melamine) ; ステンレス (stainless) ; 木製 (wood) ; シリコン (silicone) ;
   - 割れない / トライ ; 吸盤付き ; 燕三条
   Skip if it would push the keyword over-long.

Do NOT include: pack/piece counts beyond the 〜点セット line (4点, 2個, ×N), colors (クリームイエロー/パステル/ミントグリーン), sizes, 送料無料/出産祝い/お食い初め/ギフト/プレゼント/ラッピング/名入れ/離乳食, 食洗機対応/電子レンジ/レンジOK/煮沸/BPAフリー, すくいやすい/こぼれない/かわいい/おしゃれ, 赤ちゃん/ベビー/子供/キッズ generic words, order codes (B0xxx/SY-1/M370/XP7AG/ASIN/品番), shop/maker names.

Keep it TIGHT: brand + line + type + (one material) = at most 5 tokens. Over-specifying zeroes out Rakuten.
Output plain Japanese keywords only, no English except brand tokens like NUK, no punctuation.

Title: ${title}`

// Tuned baby_chair prompt — mirrors scripts/prompts/baby_chair.txt (see scripts/tuning/baby_chair.md).
export const BABY_CHAIR_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY / KIDS CHAIR (ベビーチェア — ハイチェア / ローチェア / テーブルチェア / ブースター / お座り補助ソファ) product.

Amazon JP titles are often English-translated; Rakuten titles are katakana. Translate to Japanese and output Japanese ONLY.

The decisive fields are BRAND + EXACT MODEL/LINE + CHAIR TYPE. The model/line is the single most important token after brand — NEVER drop it, NEVER generalize it, NEVER swap a similar model. CHAIR TYPE is decisive: a high chair, a low chair, a clip-on table chair and a booster/seat-aid are DIFFERENT products — never swap or invent the type.

BRANDS (English to JP) — always keep, output the Japanese form:
- Yamatoya / sukusuku maker = 大和屋
- Stokke = ストッケ
- Katoji = カトージ
- Bumbo = バンモ→バンボ (always バンボ)
- Richell = リッチェル
- Ingenuity / Kids2 = インジェニュイティ
- BabyBjorn / Baby Bjorn / Baby Björn = ベビービョルン
- Aprica = アップリカ
- Combi = コンビ

MODEL / LINE (English to JP) — pick the ONE that appears; keep it VERBATIM, it is decisive:
- "Sukusuku Chair" / "Suku Suku" = すくすくチェア ; "Sukusuku Chair GL" = すくすくチェアGL ; "Sukusuku Slim" / "Slim-J" = すくすくスリム ; "Affel" / "Afull" = アッフル
- "Tripp Trapp" / "TrippTrapp" = トリップトラップ ; "Nomi" = ノミ ; "Clikk" / "Click" = クリック ; "Steps" = ステップス
- "Easy Fit" / "EasyFit" = イージーフィット ; "New York Baby" / "NewYork Baby" = ニューヨークベビー
- "Multi Seat" / "MultiSeat" = マルチシート ; "Baby Sofa" = ベビーソファ
- "Gokigen Chair" / "2WAY Gokigen" = 2WAYごきげんチェア
- "Baby Base" = ベビーベース (keep grade like 3.0 if present)

CHAIR TYPE — keep exactly the one the title's product IS; do not invent a second type:
- "High Chair" / "ハイチェア" = ハイチェア (tall, sits at the dining table; usually 木製 wooden)
- "Low Chair" / "ローチェア" = ローチェア (floor-level)
- "Table Chair" / "Hook-on" / "Clamp" / "卓上" / "テーブルチェア" = テーブルチェア (clips onto a table edge)
- "Booster" / "ブースター" = ブースターシート (sits on an existing chair)
- "Baby Sofa" / "Floor Seat" / "お座り補助" = ベビーソファ
- "Wooden" / 木製 = 木製 (keep ONLY for wooden high chairs where it distinguishes, e.g. 大和屋 / ストッケ)

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always include.
2. Exact model / line (Japanese, from map) — always include; this is the decisive field. Keep grade tokens (GL / スリム / 3.0) when present.
3. Chair type — ONE word (ハイチェア / ローチェア / テーブルチェア / ブースターシート / ベビーソファ) — only the type the product actually is.

Do NOT include: colors (Navy/Beige/Gray/Natural/ナチュラル/ホワイト/グレー), cushion/tray/guard accessories sold with it (クッション / テーブル付き / ガード / トレイ / ハーネス) unless the product IS that accessory, age/weight ranges (7ヶ月/5才/15kg/80kg/6ヶ月から), order/ASIN codes (B0xxx / 7-digit numbers / model SKU like 5501NA), shop names (yamatoya認定店), marketing (送料無料 / 正規品 / 7年保証 / おしゃれ / 北欧 / 長く使える / 出産祝い / ギフト / 高さ調節). There is NO count dimension for chairs — never add 個/台/セット/点.

Keep the keyword TIGHT — brand + model + type is usually 3 tokens. Over-specifying (color, accessories, age/weight, marketing) shrinks or zeros the Rakuten result set — do NOT add them.

Output plain Japanese keywords only, no English, no punctuation. Max 5 words.

Title: ${title}`

// Tuned bouncer prompt — mirrors scripts/prompts/bouncer.txt (see scripts/tuning/bouncer.md).
export const BOUNCER_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY BOUNCER / ROCKER / HI-LOW CHAIR / ELECTRIC SWING (バウンサー・ハイローラック・電動スウィング) product.

Amazon JP titles are often English-translated; Rakuten titles are katakana. Translate to Japanese and output Japanese ONLY.

The decisive fields are BRAND + MODEL/LINE + TYPE. The TYPE must be preserved: a manual bouncer (バウンサー) is NOT the same product as a hi-low rack (ハイローラック/ハイローチェア) and NOT the same as an electric/auto swing (電動・オートスウィング) or cradle (ゆりかご). Never swap or invent a type the title does not state.

BRANDS (English to JP) — always keep:
- BabyBjorn / Baby Bjorn / Babybjörn = ベビービョルン
- Combi = コンビ
- Aprica = アップリカ
- Katoji = カトージ
- Stokke = ストッケ
- Ingenuity / Kids2 = インジェニュイティ
- Richell = リッチェル
- Nishimatsuya = 西松屋
If NO known brand appears, keep the actual maker name written in the title; never invent a famous brand.

MODEL / LINE — highest priority after brand, NEVER drop, NEVER generalize. Keep the exact line word(s) verbatim. Amazon spells these many ways; map to the katakana:
- BabyBjorn: "Bliss" = ブリス ; "Bliss Air" = ブリス エアー ; "Balance Soft" = バランスソフト ; "Balance Soft Air" = バランスソフト エアー (keep エアー/Air — Air is a mesh variant that is a distinct SKU)
- Combi: "Nemurila" / "Nemulila" = ネムリラ ; keep the grade word EXACTLY — these are DIFFERENT models: "Auto Swing" / "AUTO SWING" = オートスウィング (electric) ; "BEDi" = BEDi ; "Auto DR" = Auto DR ; "Long" = ロング ; "White Label" = ホワイトレーベル
- Aprica: "YuraLism" / "Yura Rhythm" / "Yurarizumu" = ユラリズム ; "Auto" = オート (electric swing) ; "Smart" = スマート ; "Premium" = プレミアム
- Katoji: "Piccolo" = ピッコロ ; "Swing Hi-Low Rack" = スイングハイローラック
- Stokke: "Steps" = ステップス
- Ingenuity: "Keep Cozy" = キープコージー ; "Cozy Spot" = コージースポット ; "Soothing" = スージング ; "Rocking" = ロッキング
- Richell: "Bouncing Seat" / "Bouncing Seat N" = バウンシングシート N

TYPE — keep exactly the one the title states; these are DIFFERENT products, never swap or invent:
- "Bouncer" / バウンサー / "Bouncing Seat" = バウンサー (manual rocker)
- "Hi-Low Rack" / "Hi-Low Chair" / "High Low" / ハイローラック / ハイローチェア = ハイローチェア
- "Electric" / "Auto Swing" / "Electric Swing" / 電動 / オートスウィング = electric — keep オートスウィング or 電動 as the title states
- "Cradle" / ゆりかご = ゆりかご

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep.
2. Model / line (Japanese, from map) — NEVER drop. Keep エアー/Air, the grade word, and オートスウィング when the title has them; they distinguish SKUs.
3. Type — バウンサー / ハイローチェア / 電動 / オートスウィング / ゆりかご — only the one the title states.

Do NOT include: colors (アンスラサイト/グレーベージュ/ブラック/ネイビー/Black/Gray/Beige etc.), fabric-only words alone, age/weight ranges (0ヶ月/1ヶ月～2歳/新生児～4歳/22kg), order/ASIN codes (B0xxx / 7-digit numbers / 12428 / 17554), shop names, marketing (送料無料/正規品/日本正規品/10年保証/2年保証/SG認証/出産祝い/出産準備/ギフト/コンパクト/軽量/折りたたみ/リクライニング/洗える/洗濯可). Replacement covers / cushions sold alone (シート単品 / クッション / カバー / 洗い替え) are ACCESSORIES, not the product — if the title is an accessory, keep the accessory word; otherwise never add it. There is NO count dimension — never add 個/台/セット.

Keep the keyword TIGHT — brand + model + type is enough (usually 3-4 tokens). Over-specifying (color, age, marketing, fabric) shrinks or zeroes the Rakuten result set.
Output plain Japanese keywords only, no English except model codes that are written in latin (BEDi/Air), max 5 words.

Title: ${title}`

// Tuned toys prompt — mirrors scripts/prompts/toys.txt (see scripts/tuning/toys.md).
export const TOYS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY/INFANT TOY (ベビーおもちゃ / 知育玩具: メリー・モビール, プレイジム・ベビージム, ガラガラ・ラトル, 歯固め, 積み木, 乗用・三輪車, おもちゃ箱) product.

Amazon titles may be English-translated. Translate to Japanese and output Japanese ONLY (katakana/kanji as Rakuten uses).

The decisive fields are BRAND + the EXACT PRODUCT/LINE NAME. The product/line name is the single token that identifies this specific SKU — NEVER drop it, NEVER generalize it, NEVER swap it for a similar product.

BRAND (English to JP) — keep the brand if present:
- Fisher-Price / Fisher Price = フィッシャープライス
- Oball / O ball = オーボール (maker Kids2 / キッズツー — drop the maker, keep オーボール)
- Bright Starts = ブライトスターツ (maker Kids2 / キッズツー)
- Sassy = サッシー
- Ed Inter = エドインター
- People = ピープル
- KUMON = くもん
- Takara Tomy = タカラトミー
- Bandai = バンダイ
- Combi = コンビ
- Mattel = マテル
- Anpanman = アンパンマン (maker アガツマ / Agatsuma — drop the maker, keep アンパンマン)

PRODUCT / LINE NAME — the decisive token. Keep it VERBATIM in Japanese, exactly as written:
- e.g. オーボール ラトル, レインフォレスト, デラックスジム, ミュージカルジム, やりたい放題, くるくるチャイム, 森のあそび箱, よくばりボックス, ビジーカー, にこにこミラーラトル, バンブルバイツ.
- If a character/property IS the product identity (アンパンマン, ミニーマウス, リトルマーメイド, サンリオベビー), keep it.

Output Japanese keywords in this priority order, space-separated:
1. Brand (Japanese, from map). Include if present.
2. Exact product / line name (Japanese, verbatim). Always include — this is the decisive field.
3. Product type ONLY if a type word actually appears in the title AND it is not already part of the line name (ジム, ラトル, ガラガラ, 歯固め, メリー, 乗用, 積み木, つみき). NEVER invent a type that is not in the title (e.g. do not add ラトル to a busy-board or box). Never repeat a word already in the keyword. If the line name already conveys the type (ミュージカルジム, よくばりボックス, コップがさね), omit a separate type word.

Keep it TIGHT: usually 2-4 tokens. Over-specifying zeroes out Rakuten — do NOT add colors, age/月齢 (0ヶ月/1歳/対象年齢), counts, 知育玩具, marketing.

Do NOT include: colors, 新生児/0ヶ月/月齢/対象年齢/いつから, ◯歳, 男の子/女の子, 知育玩具/おもちゃ/玩具 (unless the only type word), 出産祝い/プレゼント/ギフト/送料無料/正規品/人気/おすすめ/限定/クリスマス, order/model codes (GXC10/HBP41/BK-52/HD-019/B0xxx/ASIN/numeric SKUs), shop names, BPAフリー.

Output plain Japanese keywords only, no English, no punctuation. Max 5 words.

Title: ${title}`

// Tuned nasal_aspirator prompt — mirrors scripts/prompts/nasal_aspirator.txt (see scripts/tuning/nasal_aspirator.md).
export const NASAL_ASPIRATOR_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY NASAL ASPIRATOR (鼻吸い器・鼻水吸引器) product.

Amazon JP titles are usually Japanese. If any part is English, normalize with these maps.
Brands: Seastar or SeaStar=シースター / BabySmile or Baby Smile or babysmile=ベビースマイル / Pigeon=ピジョン / Tampei or Tanpei=丹平製薬 / ChuChu=チュチュ / Jex=ジェクス / Combi=コンビ / bebecure or BebeCure=ベベキュア / Knol or Knoll=ベビーバキューム.
Product lines / models: "Mercy Pot"/"Melsy Pot"=メルシーポット ; "SHUPOT"/"Shupot"=シュポット ; "Mama Hanamizu Totte"=ママ鼻水トッテ ; "Sotto Totte"=ソットトッテ.
Item type words: "Electric"=電動 ; "Handy"/"Handheld"/"Cordless"=ハンディ ; "Hand Pump"/"Hand-pump"=ハンドポンプ ; "Mouth"/"by mouth"/"お口で吸う"=口で吸う ; "Nasal Aspirator"/"Nose Suction"=鼻吸い器 ; "Nasal Mucus Suction"=鼻水吸引器.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep, but ONLY if the title actually names that brand or its English form. NEVER invent or guess a brand. ママ鼻水トッテ / ソットトッテ are 丹平製薬 products: do NOT prepend ピジョン or any unrelated brand to them. For メルシーポット either シースター or ベビースマイル is fine; prefer ベビースマイル.
2. Product line / model name — NEVER drop. Keep verbatim: メルシーポット / シュポット / ママ鼻水トッテ / ソットトッテ / ベベキュア / こでなBiBi.
3. Model code — DECISIVE, always keep if the title states it: S-503 / S-504 / S-505 (メルシーポット), S-303 / S-303NP (ベビースマイル ハンディ), C-62 (コンビ). Each numbered model is a different product. Copy it verbatim; NEVER invent one.
4. Type — DECISIVE, choose ONLY from what the title literally states. These are DIFFERENT products, never substitute:
   電動 (electric, stationary device) — e.g. メルシーポット, シュポット, ベベキュア, ソットトッテ.
   ハンディ (handheld/cordless ELECTRIC) — e.g. ベビースマイル S-303 — keep ハンディ to distinguish from the stationary メルシーポット.
   ハンドポンプ (manual HAND-PUMP, squeezed by hand, NOT electric) — e.g. ソットトッテ ハンドポンプ. This is a DIFFERENT product from the electric ソットトッテ — keep ハンドポンプ, never map it to ハンディ or 電動.
   口で吸う (mouth suction, parent inhales) — e.g. ママ鼻水トッテ — a mouth-suction device is NOT electric and NOT a pump; keep this token.
   Plus the noun: 鼻吸い器 or 鼻水吸引器 (either is fine).

Do NOT include: colors (ピーチ/グリーン/ピンク/ブルー/ホワイト), counts/sets (1個/2個入/セット/パーフェクトセット/ボンジュールセット/まとめ買い), replacement-part / accessory words when the device itself is the product (ノズル/チューブ/フィルター/ボトルカバー/フロート/コネクター/充電器/部品/交換/消耗品), order codes (B0xxx/ASIN/品番), shop names, 送料無料/正規品/医師推奨/出産祝い/プレゼント/最強配送/即日配達, marketing filler (静音/パワフル/コンパクト/かんたん操作/丸洗い/赤ちゃん/ベビー用品/新生児/子供/花粉症/鼻づまり).

NOTE on accessories: if the SOURCE title is itself a replacement part (e.g. フィット鼻ノズル, ボトルカバー, フロートセット, 排水コネクター), it is an accessory NOT a device — keep brand + line + the part noun so it matches the same accessory, not the machine.

Keep the keyword TIGHT — brand + line + model code + type is enough. Over-specifying zeros the Rakuten result set.
Output Japanese keywords only, max 6 words.

Title: ${title}`

// Tuned thermometer prompt — mirrors scripts/prompts/thermometer.txt (see scripts/tuning/thermometer.md).
export const THERMOMETER_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY/HOME THERMOMETER (体温計・温度計) product.

Amazon JP titles are usually Japanese. If any part is English, normalize with these maps.
Brands: Pigeon=ピジョン / OMRON=オムロン / TANITA=タニタ / CITIZEN=シチズン / dretec=ドリテック / TERUMO=テルモ / A&D or A and D=A&D / BabySmile=ベビースマイル.
Product lines / models (keep verbatim WITH the model code — each code is a different product):
  Pigeon "Mimi Chibion"=耳チビオン (耳式) ; OMRON "Kenonkun"=けんおんくん ; dretec "Yawaraka Touch"=やわらかタッチ ; A&D "Dekopitto"=でこピッと ; BabySmile "Pit"=Pit.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese, from map) — always keep.
2. Product line name, Japanese, ONLY if the title states one — keep verbatim: 耳チビオン / けんおんくん / やわらかタッチ / でこピッと / Pit.
3. Model code — decisive, keep verbatim if present (MC-682, TO-204, TO-206, HL710H, BT-542, S-712, UT-701, UTR-701A, ET-P330MZ, C231, C232). Strip a trailing color suffix from the code (MC-682-BA → MC-682, TO-204WT → TO-204) — the bare code matches more listings.
4. Measurement type — decisive, choose ONLY from what the title literally states. A different type is a DIFFERENT product. Emit AT MOST ONE type token (a second one zeros the Rakuten search):
   耳式 (ear) — Pigeon 耳チビオン etc.
   非接触 (forehead / contactless infrared) — ALWAYS prefer 非接触; do NOT also add おでこ/かざす (they zero the search).
   予測式 (predictive) — for stick thermometers; do NOT also add わき.
   Do NOT invent a type that is not in the title. If you have a brand + model code, the type token is optional — drop it rather than risk over-specifying.

EXCLUDE ACCESSORIES — a cover/case is NOT a thermometer. If the title contains プローブカバー / カバー / 専用カバー / ケース (and no thermometer body), it is out of scope; still output the brand + line, but these are not matchable thermometers.

Do NOT include: colors (ホワイト/ブルー/ピンク/グリーン), character names (マイメロディ/クロミ/シナモロール/ちいかわ/ハチワレ/サンリオ), pack/count (1個/1本/10個入/×3/セット), order codes (ASIN/B0xxx/JAN like 4902508151320), shop names, 送料無料/正規品/医療機器認証/メール便/管理医療機器, marketing filler (早い/正確/高精度/瞬間/1秒測定/15秒/30秒/赤ちゃん/ベビー用品/おすすめ/人気/家庭用).

Keep the keyword TIGHT — brand + line + model + type is enough. Over-specifying zeros the Rakuten result set.
Output Japanese keywords only, max 6 words.

Title: ${title}`

// Tuned safety_gate prompt — mirrors scripts/prompts/safety_gate.txt (see scripts/tuning/safety_gate.md).
export const SAFETY_GATE_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this BABY SAFETY GATE / FENCE / PLAYPEN (ベビーゲート / ベビーフェンス / ベビーサークル・プレイヤード) product.

Amazon JP and Rakuten titles are both Japanese. Output Japanese ONLY.

The decisive fields are BRAND + EXACT MODEL/LINE + TYPE + MOUNT. The model/line name is the most important token after brand — NEVER drop it, NEVER generalize it, NEVER swap a similar model. Use the KATAKANA line name; do NOT add bare numeric/ASIN model codes (BD101 / 5014047001 / 093876) — they zero out the Rakuten result set. Only keep a code that is part of the line's spoken name (FLEX-2, LDK-STYLE2).

BRANDS — always keep (use the Japanese form):
- 日本育児 (Nihon Ikuji)
- リッチェル / Richell = リッチェル
- カトージ / KATOJI = カトージ
- ベビーダン / Babydan = ベビーダン
- Lascal / ラスカル = ラスカル (キディガード = KiddyGuard)
- ラッテ

MODEL / LINE — keep VERBATIM the one the title states; these are DIFFERENT SKUs, never merge or shorten:
- 日本育児: スマートゲイト / スマートゲイトII / スマートゲイト2 / スマートワイド / おくだけとおせんぼ / おくトビラ / おくだけドアーズWoody2 / ベビーズゲイトローステップ / FLEX-2 (spell it スマートゲイト with イ, never スマートゲート; keep II / 2 as written)
- リッチェル: 階段の上でも使える木のバリアフリーゲート / おくだけフェンス / パーテーションにも使えるベビーサークル
- カトージ: LDK-STYLE2 / LDK-STYLE / 木製ベビーサークル
- ベビーダン: マルチダン / ノートリップ / フレックスフィット / フレックスフィットデラックス / ハースゲート / プレミア (use the katakana line name only — do NOT append BD101/BD108 codes; keep デラックス if the title says it)
- Lascal: キディガード / キディガード・アヴァント
Keep katakana suffixes that distinguish the SKU verbatim: ミルキー / プレミアムクリア / スマートワイドWoody / クリア / デラックス / スリム.

TYPE — keep exactly the one the title states; these are DIFFERENT PRODUCTS, never swap or invent:
- ゲート (gate, an opening barrier) = ベビーゲート
- フェンス (free-standing fence) = ベビーフェンス
- サークル / プレイヤード (enclosed playpen) = ベビーサークル
A gate is NOT a fence is NOT a サークル. Match the title's primary type.

MOUNT — keep ONLY when the exact word literally appears in the title; NEVER infer or invent a mount. A バリアフリー / 階段上 gate is NOT 突っ張り — do not add 突っ張り unless the title says 突っ張り/つっぱり:
- 突っ張り / つっぱり (tension-mounted) = 突っ張り
- 置くだけ / おくだけ / 自立式 (free-standing) = 置くだけ
- ネジ固定 (screw-fixed) = ネジ固定
- オートクローズ / オートロック (auto-close)
- ロール式 (roll-up)

Output Japanese keywords in this priority order, space-separated:
1. Brand (Japanese) — always include.
2. Exact model / line (katakana; keep デラックス / クリア / Woody suffix if present) — always include, the decisive field. Do NOT add bare BD/numeric codes.
3. Type — ベビーゲート / ベビーフェンス / ベビーサークル — the one the title states.
4. Mount — only the one the title states.

Keep the keyword TIGHT — brand + model + type is usually 3-4 tokens. Over-specifying shrinks or zeroes the Rakuten result set, so do NOT add: colors (白/黒/ブラウン/ベージュ/ホワイト/グレー/ナチュラル), width/size ranges (幅62.5-106.8cm / 74～96cm / 高さ60cm) unless the width IS the SKU name, age ranges (6ヶ月~24ヶ月 / 新生児), marketing (送料無料/正規品/北欧/おしゃれ/シンプル/階段上/バリアフリー/当日出荷), order/ASIN codes (B0xxx / 7-digit numbers), shop names. There is NO count dimension — never add 個/枚/セット. Drop accessory-only items' parent line: if the product IS an 拡張パネル / ドアパネル / 追加フレーム / 拡張パーツ (single accessory part), keep that accessory word; otherwise never add it.

Output plain Japanese keywords only, no English (except model codes), no punctuation. Max 5 words.

Title: ${title}`

// Tuned playmat prompt — mirrors scripts/prompts/playmat.txt (see scripts/tuning/playmat.md).
export const PLAYMAT_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this PLAYMAT / FLOOR-MAT product (プレイマット / ジョイントマット / フロアマット / ベビーマット / ロールマット / コルクマット).

Amazon JP and Rakuten titles are both Japanese (Amazon may add an English brand). Output Japanese ONLY.

For mats the IDENTITY is usually BRAND (when one exists) + TYPE + SIZE + THICKNESS. Most mats are NO-BRAND generic — for those, TYPE + SIZE + THICKNESS is the identity. SIZE is decisive here (unlike most categories) — keep it. Drop colors, character/marketing prints, and fluff.

BRAND — keep VERBATIM when present (English and katakana both map; keep whichever the title uses, prefer the katakana if both):
- CARAZ / Caraz / カラズ = カラズ (Carazマット / カラズマット = カラズ)
- ALZIPmat / ALZiPmat = ALZIPmat
- サンデシカ / iFam / アイファム / タンスのゲン / ニコット / Of / Eparcs / ホイミ / FORkids / エムールベビー / popomi / gumode / GUMODE / enne / DoriDori / pattan / thesun / Carrebebe / フジキ
Keep a sub-line word only when it is part of the spoken product name (e.g. アーバンシリーズ, ゼロクリーン, クリーン). Drop it if it is just marketing.

TYPE — keep exactly the type the title's PRIMARY product is; these are DIFFERENT products, never swap or merge. Pick ONE:
- プレイマット — a single folding/seamless cushioned mat (折りたたみ / シームレス / 二つ折り / 四つ折り). Use プレイマット (add 折りたたみ if the title says it; add シームレス only if stated).
- ジョイントマット — interlocking square tiles (大判 / 45cm / 60cm / サイドパーツ). Use ジョイントマット.
- ロールマット — a single rolled PVC sheet (ロールマット / PVC / フリーカット). Use ロールマット.
- コルクマット — cork-surface tiles. Use コルクマット.
- フロアマット — generic floor mat when none of the above is the primary word. Use フロアマット.
A folding プレイマット is NOT a ジョイントマット is NOT a ロールマット. Many titles list several of these as cross-tags — choose the ONE that is the real product (usually the first / the one the size and fold pattern describe).

SIZE — KEEP IT, it is the decisive field for mats. Use the form the title states:
- Rectangular play/floor mats: 140×200 / 180×200 / 120×160 / 155×155 — keep as "140 200" (space-separated numbers, no × needed) or the cm form. If the title lists MANY sizes (e.g. 100 120 140 160 180 200) it is a multi-size listing — then DROP size and rely on brand+type+thickness.
- Joint-tile mats: tile size 45cm / 60cm — keep it.
- Roll mats: width × length like 110 300 / 140 500 — keep the width number (110 / 140).
- If the title gives ONLY a letter size-code (サイズG / サイズS / サイズSG / サイズXG / Sサイズ) with NO cm numbers, DROP size entirely — do NOT invent a numeric size. Keep brand+type+thickness instead.

THICKNESS — keep ONLY when a thickness number literally appears in the title; it distinguishes SKUs: 厚さ4cm / 4cm / 厚み4cm = 4cm ; 厚さ2cm / 20mm / 2cm = 2cm ; 1.5cm / 1.2cm / 15mm (roll/PVC) — keep the number. NEVER invent a thickness that is not written in the title (do NOT assume 1.5cm for a roll mat or 4cm for a folding mat).

FOLD pattern — keep only if it clearly identifies the SKU: 二つ折り / 四つ折り / 4つ折り / 4段 / 5段. These help only for folding プレイマット.

Output Japanese keywords in this priority order, space-separated:
1. Brand (from map) — only if the title clearly has one; many mats are no-brand, then skip.
2. Type — the ONE primary type (プレイマット / ジョイントマット / ロールマット / コルクマット / フロアマット).
3. Size — the single defining size (e.g. 140 200 ; or tile 45cm ; or roll width 110). Drop if it is a multi-size listing.
4. Thickness — 4cm / 2cm / 1.5cm — only the one stated.

Keep the keyword TIGHT — usually 3-4 tokens (brand + type + size + thickness, or for no-brand just type + size + thickness). Rakuten ZEROES OUT on over-specification, so do NOT add: colors (グレー/ベージュ/ホワイト/ライトベージュ/北欧), character/print names, marketing (送料無料/出産祝い/おしゃれ/抗菌/防水/防音/床暖房対応/洗える/リバーシブル/大判/厚手/コンパクト/軽量/安全認証/正規品/韓国製), order/ASIN codes (B0xxx / 7-digit), shop names, 赤ちゃん/ベビー/キッズ/子供 when a brand or size already pins it. Do NOT invent a size or thickness that is not in the title.

Output plain Japanese keywords only, no English (except brand names that are only written in English), no punctuation. Max 5 words.

Title: ${title}`

export const CATEGORY_PROMPTS: Record<Category, PromptBuilder> = {
  diapers: DIAPERS_PROMPT,
  wipes: WIPES_PROMPT,
  formula: FORMULA_PROMPT,
  bottles: BOTTLES_PROMPT,
  baby_food: BABY_FOOD_PROMPT,
  carriers: CARRIERS_PROMPT,
  strollers: STROLLERS_PROMPT,
  car_seats: CAR_SEATS_PROMPT,
  skincare: SKINCARE_PROMPT,
  bath: BATH_PROMPT,
  toothbrush: TOOTHBRUSH_PROMPT,
  toothpaste: TOOTHPASTE_PROMPT,
  bibs: BIBS_PROMPT,
  tableware: TABLEWARE_PROMPT,
  baby_chair: BABY_CHAIR_PROMPT,
  bouncer: BOUNCER_PROMPT,
  toys: TOYS_PROMPT,
  nasal_aspirator: NASAL_ASPIRATOR_PROMPT,
  thermometer: THERMOMETER_PROMPT,
  safety_gate: SAFETY_GATE_PROMPT,
  playmat: PLAYMAT_PROMPT,
}
