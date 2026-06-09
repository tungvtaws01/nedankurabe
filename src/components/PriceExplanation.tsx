'use client'
import { ProductResult } from '@/lib/types'
import { computePriceFacts, platformName } from '@/lib/price/explain'

interface Props {
  winner: ProductResult
  loser: ProductResult
  explanation?: string   // LLM sentence; when present it replaces the bullet list
}

export default function PriceExplanation({ winner, loser, explanation }: Props) {
  if (!winner || !loser) return null

  const facts = computePriceFacts(winner, loser)

  // Nothing meaningful to say and prices are equal → render nothing (preserves prior behavior).
  if (!explanation && facts.reasons.length === 0) return null

  return (
    <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-900 leading-relaxed">
      <p className="font-bold mb-1">
        💡 {platformName(facts.winnerPlatform)}が¥{facts.diff.toLocaleString()}安い理由
        <span className="font-normal text-blue-600 ml-1">({facts.diffPct}%OFF)</span>
      </p>
      {explanation ? (
        <p>{explanation}</p>
      ) : (
        <ul className="space-y-0.5">
          {facts.reasons.map((r, i) => (
            <li key={i} className={r.startsWith('※') ? 'text-[10px] text-blue-700 mt-1' : ''}>
              {r.startsWith('※') ? r : `・${r}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
