// JAN-13 (EAN-13) validation and extraction. Japanese JANs start with 45 or 49.
export function isValidJan13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false
  if (!/^4[59]/.test(s)) return false
  const digits = s.split('').map(Number)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += digits[i] * (i % 2 === 0 ? 1 : 3)
  const check = (10 - (sum % 10)) % 10
  return check === digits[12]
}

// Find all valid JAN-13 codes embedded in free text (item names/captions), deduped.
export function extractJans(text: string): string[] {
  const candidates = text.match(/\d{13}/g) ?? []
  const valid = candidates.filter(isValidJan13)
  return [...new Set(valid)]
}
