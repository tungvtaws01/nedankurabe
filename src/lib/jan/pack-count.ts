// Parse the "number of identical retail units" (the ×N multiplier) from a title.
// NOT per-unit content (枚, g) — that is product identity handled by JAN.
// Returns 1 when no clear multiplier is found.
export function parsePackCount(title: string): number {
  // ×N / xN / *N immediately followed by a pack-unit word, or N缶/N個/Nパックセット
  const patterns: RegExp[] = [
    /[×x*]\s*(\d{1,2})\s*(?:パック|個|缶|箱|セット|袋|本|ケース)/i,
    /(\d{1,2})\s*(?:缶|個|箱|パック|袋|本)\s*セット/,
  ]
  for (const re of patterns) {
    const m = title.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n >= 2 && n <= 99) return n
    }
  }
  return 1
}
