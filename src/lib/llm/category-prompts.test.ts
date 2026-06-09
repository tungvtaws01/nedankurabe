import { CATEGORIES, CATEGORY_PROMPTS, UNIVERSAL_PROMPT } from './category-prompts'

describe('CATEGORY_PROMPTS', () => {
  it('has a builder for every category in CATEGORIES', () => {
    for (const c of CATEGORIES) {
      expect(typeof CATEGORY_PROMPTS[c]).toBe('function')
    }
  })

  // Every category has been empirically tuned, so none should still fall back to
  // the universal prompt. This catches a category accidentally left wired to
  // UNIVERSAL_PROMPT during future edits.
  it.each([...CATEGORIES])('uses a category-specific (non-universal) prompt for %s', (c) => {
    const universal = UNIVERSAL_PROMPT('amazon', 'X')
    const built = CATEGORY_PROMPTS[c]('amazon', 'X')
    expect(built).not.toBe(universal)
  })

  it('substitutes platform and title into the built prompt', () => {
    const out = CATEGORY_PROMPTS.diapers('rakuten', 'パンパース テープ 新生児')
    expect(out).toContain('rakuten')
    expect(out).toContain('パンパース テープ 新生児')
  })
})
