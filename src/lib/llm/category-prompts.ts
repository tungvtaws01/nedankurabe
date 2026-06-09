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
] as const

export type Category = typeof CATEGORIES[number]

export type PromptBuilder = (platform: string, title: string) => string

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

// Empirically tuned diapers (おむつ) prompt — see scripts/taxonomy.md "diapers tuning"
// (validated end-to-end 10/10 via scripts/probe-keyword.ts). Body mirrors
// scripts/prompts/diapers.txt with {{platform}}→${platform} and {{title}}→${title}.
export const DIAPERS_PROMPT: PromptBuilder = (platform, title) => `Extract a search keyword for ${platform} Japan for this DIAPER (おむつ) product.

Output Japanese keywords in this exact priority order, space-separated:
1. Brand (Japanese): パンパース / メリーズ / ムーニー / ムーニーマン / グーン / マミーポコ / ゲンキ / ナチュラルムーニー
   (English to JP: Pampers=パンパース, Merries/Merys/Melys=メリーズ, Moony=ムーニー, Moonyman/Moony Man=ムーニーマン, Goo.n/Goon=グーン, Mamy Poko=マミーポコ, Genki=ゲンキ)
2. Product line / tier (Japanese) — NEVER drop, NEVER generalize. Map English to JP:
   - Pampers "Smooth Care"/"Sarasara"=さらさらケア ; "First Skin"/"Baby's First Skin"=はじめての肌へのいちばん ; "Silky Touch"=さらさらケア
   - Merries "First Premium"=ファーストプレミアム ; "Air Through"/"Sarasara Air Through"=エアスルー
   - Moony "Marshmallow Skin"=マシュマロ肌ごこち ; "Natural Moony"/"Organic Cotton"=ナチュラルムーニー
   - Goon "Super Absorbent"/"Gungun"=ぐんぐん吸収
   さらさらケア and はじめての肌へのいちばん are DIFFERENT tiers — keep whichever appears.
3. Type: テープ (tape) or パンツ (pants). Always include.
4. Size/weight — write letter sizes in FULL form with サイズ, never a bare letter:
   新生児 / Sサイズ / Mサイズ / Lサイズ / ビッグサイズ (NOT bare "S"/"M"/"L" — Rakuten shop titles use the サイズ suffix and a bare letter returns nothing).
   If there is no letter size, use the kg range as written (e.g. 5kgまで, 6-11kg).
   Use ONLY what is in the title. Do NOT invent.

Do NOT include: count (枚/枚数/袋), pack/case wording, ウルトラジャンボ/UJ/大容量/ケース品/まとめ買い, colors, Disney/character names, order codes (B0xxx/ASIN), shop names, 送料無料/限定/Amazon.co.jp.

Output plain Japanese keywords only, no English, max 6 words.

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
}
