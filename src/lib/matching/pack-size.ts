// Pack-size extraction for cross-platform quantity comparison. Heuristic and
// best-effort: anything not confidently parseable returns { total: null } so callers
// degrade gracefully (no size badge, ranked last). Correctness over coverage — a
// wrong number mis-ranks, an unknown is safe.

export interface PackSize {
  dimension: 'g' | 'ml' | '枚' | null
  total: number | null
}

// Pack multipliers: "×N" or "N<container>" (but not "2缶パック" — the 缶 there is a
// pack-type descriptor, not a quantity; the (?!パック) lookahead skips that form).
const MULT_RE = /[×xX]\s*(\d+)|(\d+)\s*(?:袋|缶|箱|個|本|セット|ケース|組)(?!パック)/g

/** Extract total from a single flat string (no nested parens). */
function extractFromFlat(text: string): PackSize {
  let mult = 1
  for (const m of text.matchAll(MULT_RE)) {
    const n = parseInt(m[1] ?? m[2], 10)
    if (n > 1 && n < 1000) mult *= n
  }
  let m = text.match(/(\d+(?:\.\d+)?)\s*kg(?![a-z])/i)
  if (m) return { dimension: 'g', total: Math.round(parseFloat(m[1]) * 1000 * mult) }
  m = text.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  if (m) return { dimension: 'g', total: Math.round(parseFloat(m[1]) * mult) }
  m = text.match(/(\d+(?:\.\d+)?)\s*ml/i)
  if (m) return { dimension: 'ml', total: Math.round(parseFloat(m[1]) * mult) }
  return { dimension: null, total: null }
}

export function parsePackSize(title: string): PackSize {
  // 1. Drop baby weight RANGES (the baby's size, not the pack): 6~11kg, 6-11kg, （4-8kg）
  const noRange = title.replace(/[(（]?\s*\d+\s*[-~ー〜]\s*\d+\s*kg\s*[)）]?/gi, ' ')

  // 2. Collect innermost parenthetical segments (before stripping) — these are the
  //    breakdown parens like (780g×2パック) or (27g×60袋入) that contain both the
  //    measure and its own multiplier.
  const innerParens: string[] = []
  let tmp = noRange
  let prev = ''
  while (tmp !== prev) {
    prev = tmp
    tmp = tmp.replace(/[(（]([^()（）]*)[)）]/g, (_, inner) => {
      innerParens.push(inner)
      return ' '
    })
  }
  const outer = tmp

  // 3. Compute outer multiplier (needed for both step 4 and step 6).
  let outerMult = 1
  for (const m of outer.matchAll(MULT_RE)) {
    const n = parseInt(m[1] ?? m[2], 10)
    if (n > 1 && n < 1000) outerMult *= n
  }

  // 4. Try outer text first (handles "1560g×4個" style where the total is stated outside).
  const outerResult = extractFromFlat(outer)
  if (outerResult.dimension !== null) return outerResult

  // 5. No measure in outer — try innermost parens ONLY when the outer text has no
  //    multiplier of its own (outerMult===1).  If the outer already has a ×N, we can't
  //    safely multiply it against the measure that is itself already multiplied inside the
  //    paren (e.g. "(400g*2袋入)×3個セット" → unknown, not 400×2×3=2400).
  if (outerMult === 1) {
    for (const inner of innerParens) {
      const r = extractFromFlat(inner)
      if (r.dimension !== null) return r
    }
  }

  // 6. 枚 (diapers/wipes): largest standalone count, or smallest×mult — whichever larger.
  //    "156枚 52枚×3袋" → max(156, 52×3=156)=156; "64枚×3" → max(64, 64×3=192)=192.
  //    Use noRange so kg-weight-range stripping is applied but parens are NOT stripped
  //    (some 枚 counts appear inside parens and that's fine to count).
  const maes = [...noRange.matchAll(/(\d+)\s*枚/g)].map((x) => parseInt(x[1], 10)).filter((n) => n > 0)
  if (maes.length) return { dimension: '枚', total: Math.max(Math.max(...maes), Math.min(...maes) * outerMult) }

  return { dimension: null, total: null }
}

// Same product, comparable size? Different dimensions or missing total → unknown.
export function sizeRelation(src: PackSize, cand: PackSize): 'exact' | 'different' | 'unknown' {
  if (!src.total || !cand.total || src.dimension !== cand.dimension) return 'unknown'
  const ratio = cand.total / src.total
  return ratio >= 0.8 && ratio <= 1.25 ? 'exact' : 'different'
}

// Ordering key: 0 = identical size, larger = farther; Infinity sorts unknown last.
export function packCloseness(src: PackSize, cand: PackSize): number {
  if (!src.total || !cand.total || src.dimension !== cand.dimension) return Infinity
  return Math.abs(Math.log(cand.total / src.total))
}
