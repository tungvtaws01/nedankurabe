import { type Category } from '../llm/category-prompts'

// Fast, free, regex-based category classifier for bucketing harvest products by genre
// (the LLM classifyCategory is per-product and costly at ~8k scale). Order matters:
// more specific genres are tested before broad ones (e.g. wipes/おしりふき before the
// broad diaper match, formula/baby-food before generic). Approximate by design — it
// only groups Stage 2 batches so each genre can be evaluated and prompt-tuned on its own.
const RULES: Array<[Category, RegExp]> = [
  ['wipes',     /おしりふき|お尻ふき|おしり拭き|お尻拭き|手口ふき|ウェットティッシュ|ウエットティッシュ|純水.*ふき/],
  ['formula',   /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク/],
  // tableware BEFORE baby_food: weaning dishes often say 離乳食 (e.g. ベビー食器 離乳食
  // セット), which baby_food would otherwise steal. The 食器/プレート/スプーン noun wins.
  ['tableware', /ベビー食器|お食事プレート|ランチプレート|ベビープレート|お食事ボウル|離乳食用.*(食器|スプーン|皿)/],
  ['baby_food', /離乳食|ベビーフード|ハイハイン|グーグーキッチン|赤ちゃん.*おやつ|ベビーおやつ|幼児.*おやつ|手づかみ|きほんのだし|ベビーだし|お米.*(パンケーキ|せんべい|パン)|ボーロ|ウエハース|赤ちゃん.*せんべい|幼児.*飲料/],
  ['bottles',   /哺乳瓶|哺乳びん|乳首|ニップル|ストローマグ|マグマグ|コップマグ|ベビーマグ|ラクマグ|レッスンマグ|スパウト|搾乳|授乳クッション/],
  ['skincare',  /ベビーローション|ベビークリーム|ベビーオイル|ベビーパウダー|保湿|日焼け止め|UVケア|UVミルク|UVクリーム|UV.*(クリーム|ジェル)|スキンケア|ヒルマイルド/],
  ['bath',      /ベビーソープ|ベビーシャンプー|沐浴|ベビーバス|入浴剤|泡ソープ|ボディソープ|全身ソープ/],
  // Dental: split brush vs paste by the type word in the title (the Rakuten genre
  // leaves mix both, so the title — not genreId — is the reliable splitter). Brush
  // first so 仕上げ歯ブラシ/電動歯ブラシ go to toothbrush, then paste/gel/wipe/tablet.
  ['toothbrush',/歯ブラシ|ハブラシ|歯刷子/],
  ['toothpaste',/歯みがき|歯磨き|ハミガキ|ジェル状歯|歯みがきジェル|歯磨きジェル/],
  ['bibs',      /スタイ|よだれかけ|お食事エプロン|食事用エプロン/],
  ['baby_chair',/ベビーチェア|ハイチェア|ローチェア|お食事チェア|バンボ|チェアベルト|テーブルチェア/],
  ['bouncer',   /バウンサー|ベビーラック|電動ラック|ベビースウィング|電動.*ゆりかご|ハイローチェア|ハイローラック/],
  // おもちゃ(?!付) so "〜おもちゃ付き" (bouncers/chairs that COME WITH a toy) is not
  // mislabeled toys — the actual product noun must be the toy itself.
  ['toys',      /おもちゃ(?!付)|乗用玩具|ベビージム|プレイジム|ガラガラ|ラトル|歯固め|オルゴールメリー|ベビーメリー|回転メリー|知育玩具|にぎにぎ|布絵本/],
  ['carriers',  /抱っこ紐|抱っこひも|抱っこ補助|ベビーキャリア|スリング|ヒップシート|おんぶ紐/],
  ['strollers', /ベビーカー|バギー/],
  ['car_seats', /チャイルドシート|ジュニアシート|カーシート|回転式シート/],
  // Diaper BRAND names go last so the wipes/formula rules above win first (e.g.
  // "パンパース おしりふき" → wipes, "ほほえみ" → formula). Most Rakuten diaper titles
  // are "brand + パンツ/テープ + size + N枚" WITHOUT the literal word おむつ, so brand
  // tokens (with full-width dash variants ー/−/-) are needed to catch them. Case-
  // insensitive for the latin brand spellings (GOON, nepia).
  ['diapers',   /おむつ|オムツ|紙おむつ|パンツタイプ|テープタイプ|トレパン|オヤスミマン|水あそびパンツ|スイミングパンツ|水遊び.*パンツ|お産用パッド|母乳パッド|パンパース|ム[ーー−\-]ニ|メリーズ|グ[ーー−\-]ン|GOON|マミ[ーー−\-]?ポコ|ゲンキ|ネピア|nepia/i],
]

export function classifyLocal(title: string): Category | 'unknown' {
  for (const [cat, re] of RULES) if (re.test(title)) return cat
  return 'unknown'
}
