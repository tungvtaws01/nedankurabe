import { CATEGORIES } from './category-prompts'
import { MATCH_RULES, GENERAL_RULES, composeMatchPrompt } from './match-rules'

describe('MATCH_RULES', () => {
  it('has a rule string for every category in CATEGORIES', () => {
    for (const c of CATEGORIES) {
      expect(typeof MATCH_RULES[c]).toBe('string')
      expect(MATCH_RULES[c].length).toBeGreaterThan(0)
    }
  })
})

describe('composeMatchPrompt', () => {
  it('includes BASE rules and the genre rule when a category is given', () => {
    const out = composeMatchPrompt('thermometer')
    expect(out).toContain('JSON')
    expect(out).toContain(MATCH_RULES.thermometer)
  })
  it('falls back to GENERAL_RULES when no category is given', () => {
    const out = composeMatchPrompt(undefined)
    expect(out).toContain(GENERAL_RULES)
  })
})
