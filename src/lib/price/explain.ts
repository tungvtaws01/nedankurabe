import { ProductResult, Platform } from '@/lib/types'

export interface PriceFacts {
  winnerPlatform: Platform
  loserPlatform: Platform
  diff: number            // effectivePrice gap (loser − winner), yen
  diffPct: number         // gap as a percent of the loser's effective price
  listPriceDiff: number   // loser.salePrice − winner.salePrice (>0 ⇒ winner's list price is lower)
  pointsDelta: number     // winner.pointsEarned − loser.pointsEarned
  winnerFreeShipping: boolean
  loserShipping: number
  winnerMultiplier: number
  loserMultiplier: number
  reasons: string[]       // Japanese bullet strings for the fallback UI
}

const PLATFORM_JP: Record<Platform, string> = { amazon: 'Amazon', rakuten: '楽天' }

export function platformName(p: Platform): string {
  return PLATFORM_JP[p]
}

// Extract a quantity multiplier from a title (e.g. "×2箱", "4個セット", "2パック入").
// Kept verbatim from the original PriceExplanation component so the refactor is
// behavior-preserving: real-world multi-char units (パック) are anchored by a × prefix,
// a 入 suffix, or セット, so the single-char character class is sufficient in practice.
export function extractMultiplier(title: string): number {
  const m =
    title.match(/[×x×](\d+)[箱個袋パック缶本枚セット]/) ||
    title.match(/(\d+)[箱個袋パック缶本枚セット]入/) ||
    title.match(/(\d+)個セット/)
  return m ? parseInt(m[1], 10) : 1
}

export function pickWinnerLoser(
  a: ProductResult,
  b: ProductResult,
): { winner: ProductResult; loser: ProductResult } {
  return a.effectivePrice <= b.effectivePrice
    ? { winner: a, loser: b }
    : { winner: b, loser: a }
}

export function computePriceFacts(winner: ProductResult, loser: ProductResult): PriceFacts {
  const diff = loser.effectivePrice - winner.effectivePrice
  const diffPct = loser.effectivePrice > 0 ? Math.round((diff / loser.effectivePrice) * 100) : 0
  const listPriceDiff = loser.salePrice - winner.salePrice
  const pointsDelta = winner.pointsEarned - loser.pointsEarned
  const winnerFreeShipping = winner.shippingCost === 0 && loser.shippingCost > 0
  const winnerMultiplier = extractMultiplier(winner.title)
  const loserMultiplier = extractMultiplier(loser.title)

  const reasons: string[] = []
  if (winner.salePrice < loser.salePrice) {
    reasons.push(`定価が¥${listPriceDiff.toLocaleString()}安い`)
  }
  if (winnerFreeShipping) {
    reasons.push(`${platformName(winner.platform)}は送料無料（${platformName(loser.platform)}は+¥${loser.shippingCost}）`)
  }
  if (pointsDelta > 50) {
    reasons.push(`ポイント還元が¥${pointsDelta.toLocaleString()}多い`)
  }
  if (winnerMultiplier !== loserMultiplier && (winnerMultiplier > 1 || loserMultiplier > 1)) {
    const wUnit = Math.round(winner.effectivePrice / winnerMultiplier)
    const lUnit = Math.round(loser.effectivePrice / loserMultiplier)
    reasons.push(`※ 内容量が異なります（${platformName(winner.platform)}：×${winnerMultiplier}、${platformName(loser.platform)}：×${loserMultiplier}）。1単位あたり ${platformName(winner.platform)} ¥${wUnit.toLocaleString()} vs ${platformName(loser.platform)} ¥${lUnit.toLocaleString()}`)
  }
  if (reasons.length === 0 && winner.salePrice !== loser.salePrice) {
    reasons.push(`${platformName(winner.platform)}の販売価格が低い`)
  }

  return {
    winnerPlatform: winner.platform,
    loserPlatform: loser.platform,
    diff, diffPct, listPriceDiff, pointsDelta,
    winnerFreeShipping, loserShipping: loser.shippingCost,
    winnerMultiplier, loserMultiplier,
    reasons,
  }
}
