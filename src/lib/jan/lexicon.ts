import { type Category } from '../llm/category-prompts'

// One entry per (category, token-group). Score = sum of weights of matching groups;
// the highest-scoring category above THRESHOLD wins. Order does NOT matter — specificity
// is expressed by `weight`, replacing the old first-match-wins ordering.
//
// Weight scale (empirically tuned against the 9 821-product harvest eval):
//   7 = wipes/tableware/formula: must beat each other via relative ordering
//   6 = toothbrush: must beat toothpaste(5) in brush+paste combo titles
//   5 = most specific nouns: tableware(7)>formula(6)>baby_food(5)>bibs/baby_chair(4)
//   4 = nouns that must beat their closest competitor (baby_chair>3, bibs>3, playmat>3)
//   3 = standard specific nouns
//   2 = broad/brand tokens that lose to more-specific nouns; split-off secondary entries
//   1 = car_seats: loses to strollers(3) for combo stroller+car-seat titles
export const LEXICON: ReadonlyArray<{ category: Category; tokens: RegExp; weight: number }> = [
  // wipes weight=7: beats formula(6) for combo "formula + free wipes" titles (DB label = wipes)
  { category: 'wipes', tokens: /おしりふき|お尻ふき|おしり拭き|お尻拭き|手口ふき|ウェットティッシュ|ウエットティッシュ|純水.*ふき/, weight: 7 },
  // formula weight=6 (はいはい removed: パンパース Mはいはい size also matches, causing diapers→formula FP)
  { category: 'formula', tokens: /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク|レーベンスミルク|ぴゅあ|ごくごく/, weight: 6 },
  // tableware weight=7: beats baby_food(5) when 離乳食 appears in weaning-dish titles
  { category: 'tableware', tokens: /ベビー食器|お食事プレート|ランチプレート|ベビープレート|お食事ボウル|離乳食用.*(食器|スプーン|皿)/, weight: 7 },
  // baby_food weight=5: beats bottles(4) and toys-safe(5)... handled via secondary sum
  { category: 'baby_food', tokens: /離乳食|ベビーフード|ハイハイン|グーグーキッチン|赤ちゃん.*おやつ|ベビーおやつ|幼児.*おやつ|手づかみ|きほんのだし|ベビーだし|お米.*(パンケーキ|せんべい|パン)|ボーロ|ウエハース|赤ちゃん.*せんべい|幼児.*飲料/, weight: 5 },
  // baby_food secondary: specific brand/concept tokens that push score above toys safe(5)
  { category: 'baby_food', tokens: /モグフィ|食育|離乳食.*おしゃぶり/, weight: 3 },
  // bottles weight=4: beats strollers(3) for stroller-accessory titles mentioning 哺乳瓶/マグ
  { category: 'bottles', tokens: /哺乳瓶|哺乳びん|乳首|ニップル|ストローマグ|マグマグ|コップマグ|ベビーマグ|ラクマグ|レッスンマグ|スパウト|搾乳|授乳クッション/, weight: 4 },
  // bottles secondary: nipple-care products (ピュアレーン etc.) labeled as bottles in DB
  { category: 'bottles', tokens: /乳頭保護|授乳クリーム|ランシノー|ピュアレーン|乳頭ケア/, weight: 2 },
  // skincare weight=5: beats bath(3) for combo wash+moisturise titles
  { category: 'skincare', tokens: /ベビーローション|ベビークリーム|ベビーオイル|ベビーパウダー|保湿|日焼け止め|UVケア|UVミルク|UVクリーム|UV.*(クリーム|ジェル)|スキンケア|ヒルマイルド/, weight: 5 },
  { category: 'bath', tokens: /ベビーソープ|ベビーシャンプー|沐浴|ベビーバス|入浴剤|泡ソープ|ボディソープ|全身ソープ/, weight: 3 },
  // bath secondary: bath towels and bath chairs labeled as bath in DB
  { category: 'bath', tokens: /バスタオル|ガーゼタオル|バスローブ|バスポンチョ|バスチェア|ベビーバスチェア/, weight: 3 },
  // toothbrush weight=6: beats toothpaste(5) when brush titles also mention みがき
  { category: 'toothbrush', tokens: /歯ブラシ|ハブラシ|歯刷子/, weight: 6 },
  // toothpaste weight=5: beats bibs(4) for tooth-wipe/bibs combo titles
  { category: 'toothpaste', tokens: /歯みがき|歯磨き|ハミガキ|ジェル状歯|歯みがきジェル|歯磨きジェル/, weight: 5 },
  // bibs weight=4: beats baby_chair(4)? No, both 4 → tie resolved by secondary entries
  { category: 'bibs', tokens: /スタイ|よだれかけ|お食事エプロン|食事用エプロン/, weight: 4 },
  // bibs secondary: specific bib-product tokens to break ties with carriers (スタイ付き carrier)
  { category: 'bibs', tokens: /ティージングスタイ|スタイ付き|スタイクリップ/, weight: 2 },
  // baby_chair weight=4: beats bouncer(3) and strollers(3) for combo stroller-seat titles
  { category: 'baby_chair', tokens: /ベビーチェア|ハイチェア|ローチェア|お食事チェア|バンボ|チェアベルト|テーブルチェア/, weight: 4 },
  // bouncer weight=3: loses to baby_chair(4) for combo titles; beats toys-dangerous(2)
  { category: 'bouncer', tokens: /バウンサー|ベビーラック|電動ラック|ベビースウィング|電動.*ゆりかご|ハイローチェア|ハイローラック/, weight: 3 },
  // toys: split into safe(5) and dangerous(2) tokens.
  // Safe tokens are instrument-specific and rarely appear in chair/bouncer titles.
  { category: 'toys', tokens: /乗用玩具|ベビージム|プレイジム|ガラガラ|ラトル|歯固め|オルゴールメリー|ベビーメリー|回転メリー|知育玩具|にぎにぎ|布絵本/, weight: 5 },
  // Dangerous: おもちゃ(not followed by 付) — appears in chair/bouncer accessory titles; low
  // weight so category-specific tokens at 3+ win. strollers(3)>おもちゃ(2) correctly.
  { category: 'toys', tokens: /おもちゃ(?!付)/, weight: 2 },
  // toys secondary: stroller-mounted toy products whose titles have ベビーカー + おもちゃ.
  // Two entries fire → 2+2=4 > strollers(3).
  { category: 'toys', tokens: /ベビーカーメリー|ベビーカーおもちゃ|おもちゃ.*ストラップ/, weight: 2 },
  { category: 'nasal_aspirator', tokens: /鼻吸い器|鼻水吸引|電動鼻吸|手動鼻吸|メルシーポット|ベビースマイル.*鼻|鼻吸引器/, weight: 3 },
  { category: 'thermometer', tokens: /体温計(?!カバー|ケース|入れ)|検温(?!カバー)|耳式体温|非接触.*体温/, weight: 3 },
  { category: 'safety_gate', tokens: /ベビーゲート|安全ゲート|セーフティゲート|ベビーフェンス|階段ゲート|ドアゲート|オートゲート/, weight: 3 },
  // playmat weight=4: beats toys-dangerous(2) and safety_gate(3) for combo titles
  { category: 'playmat', tokens: /プレイマット|ジョイントマット|ベビーマット|フロアマット.*ベビー|ベビー.*フロアマット|おくだけマット/, weight: 4 },
  // carriers weight=4: beats strollers(3) for carrier+stroller combo listings
  { category: 'carriers', tokens: /抱っこ紐|抱っこひも|抱っこ補助|ベビーキャリア|スリング|ヒップシート|おんぶ紐/, weight: 4 },
  { category: 'strollers', tokens: /ベビーカー|バギー/, weight: 3 },
  // car_seats weight=1: loses to strollers(3) for combo stroller+car-seat accessory titles
  { category: 'car_seats', tokens: /チャイルドシート|ジュニアシート|カーシート|回転式シート/, weight: 1 },
  // diapers weight=2: wipes(7)/formula(6) win for brand-name cross-category titles
  { category: 'diapers', tokens: /おむつ|オムツ|紙おむつ|パンツタイプ|テープタイプ|トレパン|オヤスミマン|水あそびパンツ|スイミングパンツ|水遊び.*パンツ|お産用パッド|母乳パッド|パンパース|ム[ーー−\-]ニ|メリーズ|グ[ーー−\-]ン|GOON|マミ[ーー−\-]?ポコ|ゲンキ|ネピア|nepia/i, weight: 2 },
]

export const THRESHOLD = 1
