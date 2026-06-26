process.env.USE_UNPOOLED = '1'
import { readFileSync } from 'fs'
import { rankBySimilarity, similarity } from '../../src/lib/matching/rank'
import { semanticMatch } from '../../src/lib/llm/openrouter'
import { ProductResult } from '../../src/lib/types'

const SAMPLE = Number(process.env.SAMPLE ?? 150) // rows to evaluate (LLM cost control)
const DISTRACTORS = 4

interface Row { atitle: string; rtitle: string; label: string; category: string }

function result(title: string): ProductResult {
  return {
    platform: 'amazon', title, imageUrl: '', shopName: '', salePrice: 0,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0,
    effectivePrice: 0, subscribeAvailable: false, rakutenCardEligible: false,
    teikiRates: null, taxRate: 1.1, affiliateUrl: '',
  }
}

async function main() {
  const all = readFileSync('docs/harvest/verify/goldset.jsonl', 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l) as Row)
    .filter((r) => r.label === 'KEEP' || r.label === 'REMOVE')

  // Deterministic sample: every Nth row.
  const step = Math.max(1, Math.floor(all.length / SAMPLE))
  const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLE)

  const records: { score: number; correct: boolean; predicted: boolean; label: string }[] = []
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i]
    const pool = all.filter((r) => r.category === row.category && r.atitle !== row.atitle)
    const distractors = pool
      .filter((_, j) => j % Math.max(1, Math.floor(pool.length / DISTRACTORS)) === 0)
      .slice(0, DISTRACTORS)
    const candidateRows = [row, ...distractors]
    const ranked = rankBySimilarity(result(row.rtitle), candidateRows.map((c) => result(c.atitle)))
    const idx = await semanticMatch(result(row.rtitle), ranked).catch(() => null)
    if (idx === null) { records.push({ score: 0, correct: false, predicted: false, label: row.label }); continue }
    const chosen = ranked[idx]
    const score = similarity(row.rtitle, chosen.title)
    records.push({ score, correct: chosen.title === row.atitle, predicted: true, label: row.label })
    if (i % 10 === 0) console.error(`...${i}/${sample.length}`)
  }

  console.log('T\tprecision\trecall\tTP\tFP\tkeepN')
  const keepN = records.filter((r) => r.label === 'KEEP').length
  for (const T of [0, 0.05, 0.08, 0.10, 0.12, 0.15, 0.18, 0.20, 0.25, 0.30]) {
    const pos = records.filter((r) => r.predicted && r.score >= T)
    const tp = pos.filter((r) => r.correct && r.label === 'KEEP').length
    const fp = pos.length - tp
    const precision = pos.length ? tp / pos.length : 1
    const recall = keepN ? tp / keepN : 0
    console.log(`${T}\t${precision.toFixed(3)}\t${recall.toFixed(3)}\t${tp}\t${fp}\t${keepN}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
