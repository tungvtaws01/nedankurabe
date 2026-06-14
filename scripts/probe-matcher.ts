// Matcher-side probe: re-judge the real pairs observed in the harvest Amazon probe
// against the (tightened) semanticMatch prompt. No DB / no crawl — just the LLM judge.
// Run: OPENROUTER_API_KEY must be set. The free model is nondeterministic — runs each case twice.
import { semanticMatch } from '../src/lib/llm/openrouter'
import type { ProductResult } from '../src/lib/types'
import type { Category } from '../src/lib/llm/category-prompts'

function p(title: string, salePrice = 1000): ProductResult {
  return {
    platform: 'amazon', title, imageUrl: '', shopName: '', salePrice,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: salePrice,
    subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

interface Case { name: string; source: ProductResult; candidates: ProductResult[]; expect: 'match' | 'nomatch'; want?: string; category?: Category }

const CASES: Case[] = [
  // ---- diapers (original 6) ----
  { name: 'pampers-pants-L (same line)', expect: 'match', want: 'さらさらケア', category: 'diapers',
    source: p('パンパース さらさらパンツ スーパージャンボ Lサイズ'),
    candidates: [p('【パンツ Lサイズ】パンパース オムツ さらさらケア (9~14kg) 44枚')] },
  { name: 'natural-moony-S (same, 旧品)', expect: 'match', want: 'ナチュラルムーニー', category: 'diapers',
    source: p('ナチュラル ムーニー Sサイズ 58枚'),
    candidates: [p('【旧品】【テープ Sサイズ】ナチュラルムーニー オーガニックコットン オムツ (4~8kg)')] },
  { name: 'goon-swim GENDER (should reject)', expect: 'nomatch', category: 'diapers',
    source: p('グーン スイミングパンツ M 7~12kg 男の子用 3枚'),
    candidates: [p('【パンツ Mサイズ】グーン スイミングパンツ (7~12kg) 女の子用 3枚')] },
  { name: 'moonyman minor-count 46v54 (keep match)', expect: 'match', want: 'ムーニーマン', category: 'diapers',
    source: p('ムーニーマン 低刺激であんしん パンツ M 46枚'),
    candidates: [p('【パンツ M】 ムーニーマン 低刺激であんしん Mサイズ おむつ (5~10kg) 54枚')] },
  { name: 'mamypoko NIGHTuse (should reject)', expect: 'nomatch', category: 'diapers',
    source: p('マミーポコパンツ ビッグ 36枚 ドラえもん'),
    candidates: [p('【パンツ ビッグサイズ】マミーポコ 夜用パンツ ドラえもん オムツ (12~22kg) 28枚')] },
  { name: 'CASE-PACK vs single (should MATCH+normalize)', expect: 'match', want: 'ケース', category: 'diapers',
    source: p('パンパース さらさらケア テープ Mサイズ 64枚'),
    candidates: [p('パンパース さらさらケア テープ Mサイズ 64枚×4パック ケース品')] },

  // ---- PRECISION guards (expect nomatch) ----
  { name: 'KIRKLAND vs RICO (brand gate)', expect: 'nomatch', category: 'wipes',
    source: p('カークランド ベビーワイプ 100枚'),
    candidates: [p('RICO 純水99% おしりふき 100枚')] },
  { name: 'NO-BRAND vs branded (skincare)', expect: 'nomatch', category: 'skincare',
    source: p('ベビーローション 300ml 高保湿'),
    candidates: [p('ピジョン ベビーミルクローション 300ml')] },
  { name: 'baby_food flavor (different dish)', expect: 'nomatch', category: 'baby_food',
    source: p('和光堂 グーグーキッチン 鮭とじゃがいもの和風煮 80g'),
    candidates: [p('和光堂 グーグーキッチン 牛肉のすき焼き風ごはん 80g')] },
  { name: 'skincare SPF (50 vs 29)', expect: 'nomatch', category: 'skincare',
    source: p('アトピタ 保湿UVクリーム SPF50'),
    candidates: [p('アトピタ 保湿UVクリーム SPF29')] },
  { name: 'diaper size-adjacency (M vs L)', expect: 'nomatch', category: 'diapers',
    source: p('パンパース さらさらケア テープ Mサイズ 64枚'),
    candidates: [p('パンパース さらさらケア テープ Lサイズ 54枚')] },
  { name: 'thermometer type (ear vs forehead)', expect: 'nomatch', category: 'thermometer',
    source: p('ピジョン 耳チビオン 耳式体温計 C231'),
    candidates: [p('ピジョン 非接触体温計 おでこ')] },
  { name: 'nasal type (electric vs mouth)', expect: 'nomatch', category: 'nasal_aspirator',
    source: p('シースター ベビースマイル メルシーポット 電動鼻吸い器 S-504'),
    candidates: [p('丹平 ママ鼻水トッテ 口で吸うタイプ')] },

  // ---- RECALL (expect match): durable brands unblocked by the refactor ----
  { name: 'Babydan gate+match (EN/JP)', expect: 'match', category: 'safety_gate',
    source: p('ベビーダン マルチダン ベビーゲート'),
    candidates: [p('Babydan MultiDan baby gate マルチダン')] },
  { name: 'Katoji baby_chair (EN/JP)', expect: 'match', category: 'baby_chair',
    source: p('カトージ ベビーチェア ニューヨークベビー ハイチェア'),
    candidates: [p('KATOJI New York Baby ハイチェア')] },
  { name: 'Pigeon thermometer (same model C231)', expect: 'match', category: 'thermometer',
    source: p('ピジョン 耳チビオン C231 耳式体温計'),
    candidates: [p('Pigeon 耳チビオン 耳式 体温計 C231')] },
  { name: 'toothbrush same brand+stage', expect: 'match', category: 'toothbrush',
    source: p('ピジョン 乳歯ブラシ レッスン段階1'),
    candidates: [p('Pigeon 歯ブラシ レッスン段階1 乳歯')] },
  { name: 'bouncer same model (Bliss mesh)', expect: 'match', category: 'bouncer',
    source: p('ベビービョルン バウンサー Bliss メッシュ'),
    candidates: [p('BabyBjorn バウンサー ブリス エアー メッシュ')] },
]

async function runOnce(c: Case): Promise<boolean> {
  const idx = await semanticMatch(c.source, c.candidates, { category: c.category }).catch(() => null)
  if (c.expect === 'nomatch') return idx === null
  if (idx === null) return false
  return c.want ? (c.candidates[idx]?.title.includes(c.want) ?? false) : true
}

async function main() {
  let pass = 0
  for (const c of CASES) {
    const r1 = await runOnce(c)
    const r2 = await runOnce(c)
    const ok = r1 && r2
    if (ok) pass++
    console.log(`${ok ? 'PASS' : 'FAIL'} [${r1 ? 'Y' : 'N'}${r2 ? 'Y' : 'N'}] ${c.name} (expect ${c.expect})`)
  }
  console.log(`\n=== ${pass}/${CASES.length} cases pass (both runs) ===`)
  process.exit(0)
}
main().catch((e) => { console.error(e); process.exit(1) })
