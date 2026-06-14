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

interface Case { name: string; source: ProductResult; candidates: ProductResult[]; expect: 'match' | 'nomatch'; want?: string }

const CASES: Case[] = [
  { name: 'pampers-pants-L (same line)', expect: 'match', want: 'さらさらケア',
    source: p('パンパース さらさらパンツ スーパージャンボ Lサイズ'),
    candidates: [p('【パンツ Lサイズ】パンパース オムツ さらさらケア (9~14kg) 44枚')] },
  { name: 'natural-moony-S (same, 旧品)', expect: 'match', want: 'ナチュラルムーニー',
    source: p('ナチュラル ムーニー Sサイズ 58枚'),
    candidates: [p('【旧品】【テープ Sサイズ】ナチュラルムーニー オーガニックコットン オムツ (4~8kg)')] },
  { name: 'goon-swim GENDER (should reject)', expect: 'nomatch',
    source: p('グーン スイミングパンツ M 7~12kg 男の子用 3枚'),
    candidates: [p('【パンツ Mサイズ】グーン スイミングパンツ (7~12kg) 女の子用 3枚')] },
  { name: 'moonyman minor-count 46v54 (keep match)', expect: 'match', want: 'ムーニーマン',
    source: p('ムーニーマン 低刺激であんしん パンツ M 46枚'),
    candidates: [p('【パンツ M】 ムーニーマン 低刺激であんしん Mサイズ おむつ (5~10kg) 54枚')] },
  { name: 'mamypoko NIGHTuse (should reject)', expect: 'nomatch',
    source: p('マミーポコパンツ ビッグ 36枚 ドラえもん'),
    candidates: [p('【パンツ ビッグサイズ】マミーポコ 夜用パンツ ドラえもん オムツ (12~22kg) 28枚')] },
  { name: 'CASE-PACK vs single (should MATCH+normalize)', expect: 'match', want: 'ケース',
    source: p('パンパース さらさらケア テープ Mサイズ 64枚'),
    candidates: [p('パンパース さらさらケア テープ Mサイズ 64枚×4パック ケース品')] },
]

async function runOnce(c: Case): Promise<boolean> {
  const idx = await semanticMatch(c.source, c.candidates, { category: process.env.PROBE_CATEGORY as Category | undefined }).catch(() => null)
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
