import { type Category } from '../llm/category-prompts'

// Fast, free, regex-based category classifier for bucketing harvest products by genre
// (the LLM classifyCategory is per-product and costly at ~8k scale). Order matters:
// more specific genres are tested before broad ones (e.g. wipes/おしりふき before the
// broad diaper match, formula/baby-food before generic). Approximate by design — it
// only groups Stage 2 batches so each genre can be evaluated and prompt-tuned on its own.
const RULES: Array<[Category, RegExp]> = [
  ['wipes',     /おしりふき|お尻ふき|おしり拭き|お尻拭き|手口ふき|ウェットティッシュ|ウエットティッシュ|純水.*ふき/],
  ['formula',   /粉ミルク|液体ミルク|フォローアップ|らくらくキューブ|らくらくミルク|ほほえみ|はぐくみ|E赤ちゃん|アイクレオ|すこやかM1|ぐんぐん|ステップ.*缶|乳児用.*ミルク/],
  ['baby_food', /離乳食|ベビーフード|ハイハイン|グーグーキッチン|赤ちゃん.*おやつ|ベビーおやつ|幼児.*おやつ|手づかみ|きほんのだし|ベビーだし|お米.*(パンケーキ|せんべい|パン)|ボーロ|ウエハース|赤ちゃん.*せんべい|幼児.*飲料/],
  ['bottles',   /哺乳瓶|哺乳びん|乳首|ニップル|ストローマグ|マグマグ|コップマグ|ベビーマグ|ラクマグ|レッスンマグ|スパウト|搾乳|授乳クッション/],
  ['skincare',  /ベビーローション|ベビークリーム|ベビーオイル|ベビーパウダー|保湿|日焼け止め|UVケア|UVミルク|UVクリーム|UV.*(クリーム|ジェル)|スキンケア|ヒルマイルド/],
  ['bath',      /ベビーソープ|ベビーシャンプー|沐浴|ベビーバス|入浴剤|泡ソープ|ボディソープ|全身ソープ/],
  ['carriers',  /抱っこ紐|抱っこひも|抱っこ補助|ベビーキャリア|スリング|ヒップシート|おんぶ紐/],
  ['strollers', /ベビーカー|バギー/],
  ['car_seats', /チャイルドシート|ジュニアシート|カーシート|回転式シート/],
  ['diapers',   /おむつ|オムツ|紙おむつ|パンツタイプ|テープタイプ|トレパン|オヤスミマン|水あそびパンツ|スイミングパンツ|水遊び.*パンツ|お産用パッド|母乳パッド/],
]

export function classifyLocal(title: string): Category | 'unknown' {
  for (const [cat, re] of RULES) if (re.test(title)) return cat
  return 'unknown'
}
