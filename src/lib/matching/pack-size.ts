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

interface RawMeasure { dimension: 'g' | 'ml'; value: number }

/** First measure in a string as a RAW value (no pack multiplier applied). kg→g. */
function rawMeasure(text: string): RawMeasure | null {
  let m = text.match(/(\d+(?:\.\d+)?)\s*kg(?![a-z])/i)
  if (m) return { dimension: 'g', value: parseFloat(m[1]) * 1000 }
  m = text.match(/(\d+(?:\.\d+)?)\s*g(?![a-z])/i)
  if (m) return { dimension: 'g', value: parseFloat(m[1]) }
  m = text.match(/(\d+(?:\.\d+)?)\s*ml/i)
  if (m) return { dimension: 'ml', value: parseFloat(m[1]) }
  return null
}

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
  // 0. Strip thousands-separator commas between digits ("1,620g" → "1620g"). Amazon titles
  //    use them; a stray comma otherwise truncates the number (1,620g would parse as 620g).
  const noCommas = title.replace(/(?<=\d)[,，](?=\d)/g, '')
  // 1. Drop baby weight RANGES (the baby's size, not the pack): 6~11kg, 6-11kg, （4-8kg）
  const noRange = noCommas.replace(/[(（]?\s*\d+\s*[-~ー〜]\s*\d+\s*kg\s*[)）]?/gi, ' ')

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

  // 5. No measure in outer. The measure and its count multipliers may be split across
  //    sibling parens — e.g. "(60袋入×4セット(1袋27g))": the 27g measure sits in one paren
  //    while the 60×4=240 count sits in another. Combine: take the single raw measure across
  //    all inner parens and multiply by the product of every count multiplier in any inner
  //    paren. Gated on outerMult===1 — if a count sits OUTSIDE the parens we can't safely
  //    combine (e.g. "(400g*2袋入)×3個セット" → unknown, not 400×2×3=2400).
  if (outerMult === 1) {
    let innerMult = 1
    for (const inner of innerParens) {
      for (const m of inner.matchAll(MULT_RE)) {
        const n = parseInt(m[1] ?? m[2], 10)
        if (n > 1 && n < 1000) innerMult *= n
      }
    }
    // Raw measures (no per-segment mult applied) across all inner parens.
    const measures = innerParens.map(rawMeasure).filter((m): m is RawMeasure => m !== null)
    const distinct = new Set(measures.map((m) => `${m.dimension}:${m.value}`))
    // Exactly one measure → safe to scale by the combined inner count. More than one
    // (total + breakdown both inside parens) is ambiguous → fall through to unknown.
    if (distinct.size === 1) {
      return { dimension: measures[0].dimension, total: Math.round(measures[0].value * innerMult) }
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
