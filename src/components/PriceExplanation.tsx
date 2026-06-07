'use client'
import { ProductResult } from '@/lib/types'

interface Props {
  winner: ProductResult
  loser: ProductResult
}

function platformName(p: ProductResult['platform']) {
  return p === 'amazon' ? 'Amazon' : '楽天'
}

// Extract quantity multiplier from title (e.g. "×2箱", "4個セット", "2パック")
function extractMultiplier(title: string): number {
  const m =
    title.match(/[×x×](\d+)[箱個袋パック缶本枚セット]/) ||
    title.match(/(\d+)[箱個袋パック缶本枚セット]入/) ||
    title.match(/(\d+)個セット/)
  return m ? parseInt(m[1], 10) : 1
}

export default function PriceExplanation({ winner, loser }: Props) {
  if (!winner || !loser) return null

  const diff = loser.effectivePrice - winner.effectivePrice
  const diffPct = Math.round((diff / loser.effectivePrice) * 100)
  const reasons: string[] = []

  // 1. List price difference
  if (winner.salePrice < loser.salePrice) {
    const pd = loser.salePrice - winner.salePrice
    reasons.push(`定価が¥${pd.toLocaleString()}安い`)
  }

  // 2. Shipping
  if (winner.shippingCost === 0 && loser.shippingCost > 0) {
    reasons.push(`${platformName(winner.platform)}は送料無料（${platformName(loser.platform)}は+¥${loser.shippingCost}）`)
  }

  // 3. Points earned
  const winPts = winner.pointsEarned
  const losePts = loser.pointsEarned
  if (winPts > losePts + 50) {
    reasons.push(`ポイント還元が¥${(winPts - losePts).toLocaleString()}多い`)
  }

  // 4. Quantity difference note
  const wMult = extractMultiplier(winner.title)
  const lMult = extractMultiplier(loser.title)
  if (wMult !== lMult && (wMult > 1 || lMult > 1)) {
    const wUnit = Math.round(winner.effectivePrice / wMult)
    const lUnit = Math.round(loser.effectivePrice / lMult)
    reasons.push(`※ 内容量が異なります（${platformName(winner.platform)}：×${wMult}、${platformName(loser.platform)}：×${lMult}）。1単位あたり ${platformName(winner.platform)} ¥${wUnit.toLocaleString()} vs ${platformName(loser.platform)} ¥${lUnit.toLocaleString()}`)
  }

  if (reasons.length === 0) {
    if (winner.salePrice !== loser.salePrice) {
      reasons.push(`${platformName(winner.platform)}の販売価格が低い`)
    } else {
      return null
    }
  }

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-900 leading-relaxed">
      <p className="font-bold mb-1">
        💡 {platformName(winner.platform)}が¥{diff.toLocaleString()}安い理由
        <span className="font-normal text-blue-600 ml-1">({diffPct}%OFF)</span>
      </p>
      <ul className="space-y-0.5">
        {reasons.map((r, i) => (
          <li key={i} className={r.startsWith('※') ? 'text-[10px] text-blue-700 mt-1' : ''}>
            {r.startsWith('※') ? r : `・${r}`}
          </li>
        ))}
      </ul>
    </div>
  )
}
