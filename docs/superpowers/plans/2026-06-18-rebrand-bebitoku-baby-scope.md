# Rebrand to ベビ得 + Baby-Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the app from ねだんくらべ to **ベビ得** in the UI, add a baby-products tagline, and constrain keyword search to baby genres so off-topic queries show an on-brand empty state — without touching the domain, Rakuten API headers, or the Amazon tag.

**Architecture:** Pure UI/string changes (title, hero, tagline, localStorage key, package name) plus one behavioral change in the Rakuten search (drop the all-genres `genreId: "0"` fallback) and a matching on-brand empty-state message. Cache prefix bumped so stale all-genres results aren't served.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Jest.

**Spec:** `docs/superpowers/specs/2026-06-18-rebrand-bebitoku-baby-scope-design.md`
**Working branch:** `feat/amazon-associate-compliance`

> **Note:** `npx tsc --noEmit` is expected to be fully clean (exit 0). Tests run via `npx jest <file>`.

---

## File Structure

- `src/app/layout.tsx` — page `<title>` + `description` metadata → ベビ得.
- `src/app/page.tsx` — hero `<h1>` ねだん/くらべ → ベビ/得; subtitle → tagline + positioning.
- `package.json` — `name` → `bebitoku`.
- `src/app/results/page.tsx` — rename `nedankurabe_toggles` localStorage key → `bebitoku_toggles` (2 spots).
- `src/lib/platforms/rakuten.ts` — drop `genreId: "0"` fallback in `searchRakutenKeyword`.
- `src/lib/platforms/rakuten-genre-scope.test.ts` (new) — assert search never queries `genreId=0`.
- `src/app/api/search/route.ts` + `src/app/api/search/stream/route.ts` — bump cache prefix `kw5` → `kw6`.
- `src/components/KeywordResultsList.tsx` — on-brand empty state for zero results.
- `docs/superpowers/specs/amazon-associate-reapplication.md` — brand name → ベビ得.

---

## Task 1: Brand rename in metadata + hero

**Files:**
- Modify: `src/app/layout.tsx:13-14`
- Modify: `src/app/page.tsx:7-13`
- Modify: `package.json:2`

- [ ] **Step 1: Update the page metadata**

In `src/app/layout.tsx`, replace the `metadata` title/description:

```tsx
export const metadata: Metadata = {
  title: 'ベビ得 — ベビー用品の最安値比較',
  description: 'ベビー用品の実質価格を Amazon・楽天 でまとめて比較。かしこくおトクに。',
}
```

- [ ] **Step 2: Update the hero**

In `src/app/page.tsx`, replace the `<div className="text-center mb-10">` block contents (the `<h1>` and the two `<p>` lines) with:

```tsx
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black" style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ベビ<span className="text-[var(--red)]">得</span>
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">ベビー用品を、かしこくおトクに。</p>
        <p className="text-xs italic text-[var(--ink-soft)] mt-0.5">
          ベビー用品の実質価格を Amazon・楽天 でまとめて比較
        </p>
      </div>
```

- [ ] **Step 3: Update the package name**

In `package.json`, change line 2:

```json
  "name": "bebitoku",
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx package.json
git commit -m "feat(brand): rename ねだんくらべ -> ベビ得 in title, hero, package"
```

---

## Task 2: Rename the localStorage toggle key

**Files:**
- Modify: `src/app/results/page.tsx` (the `loadToggles` getItem and the `handleToggles` setItem)

- [ ] **Step 1: Rename both occurrences**

In `src/app/results/page.tsx`, the `loadToggles()` function reads:

```tsx
  try { return JSON.parse(localStorage.getItem('nedankurabe_toggles') ?? 'null') ?? DEFAULT_TOGGLES }
```

Change `'nedankurabe_toggles'` → `'bebitoku_toggles'`.

And `handleToggles()` writes:

```tsx
    localStorage.setItem('nedankurabe_toggles', JSON.stringify(t))
```

Change `'nedankurabe_toggles'` → `'bebitoku_toggles'`.

(There are exactly two occurrences. Safe because there are no users yet.)

- [ ] **Step 2: Verify no stragglers**

Run: `grep -rn "nedankurabe_toggles" src`
Expected: no output (both renamed).

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` (expect exit 0)

```bash
git add src/app/results/page.tsx
git commit -m "feat(brand): rename localStorage key nedankurabe_toggles -> bebitoku_toggles"
```

---

## Task 3: Constrain Rakuten search to baby genres (drop genreId "0")

**Files:**
- Modify: `src/lib/platforms/rakuten.ts` (the `genreFallbacks` in `searchRakutenKeyword`, around lines 169-172)
- Test: `src/lib/platforms/rakuten-genre-scope.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/platforms/rakuten-genre-scope.test.ts`:

```ts
import { searchRakuten } from './rakuten'

describe('searchRakuten genre scoping', () => {
  const ORIG_FETCH = global.fetch
  let calledUrls: string[]

  beforeEach(() => {
    calledUrls = []
    process.env.RAKUTEN_APP_ID = 'test-app'
    process.env.RAKUTEN_ACCESS_KEY = 'test-key'
    // Mock fetch: always return an empty Items list so all genre attempts "miss".
    global.fetch = jest.fn(async (url: string | URL | Request) => {
      calledUrls.push(String(url))
      return { ok: true, text: async () => JSON.stringify({ Items: [] }) } as unknown as Response
    }) as unknown as typeof fetch
  })

  afterEach(() => { global.fetch = ORIG_FETCH })

  it('never queries the all-genres genreId=0, and returns [] for an off-topic keyword', async () => {
    const results = await searchRakuten('コーヒー')
    expect(results).toEqual([])
    expect(calledUrls.length).toBeGreaterThan(0)
    expect(calledUrls.some((u) => /[?&]genreId=0(&|$)/.test(u))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx jest src/lib/platforms/rakuten-genre-scope.test.ts`
Expected: FAIL — at least one fetched URL contains `genreId=0` (the current all-genres fallback).

- [ ] **Step 3: Drop the "0" fallback**

In `src/lib/platforms/rakuten.ts`, find in `searchRakutenKeyword`:

```ts
  const specificGenre = getGenreId(kw);
  const genreFallbacks = specificGenre === "100533"
    ? ["100533", "0"]
    : [specificGenre, "100533", "0"];
```

Replace with (keep the specific baby genre + `100533` baby-and-maternity; remove the all-genres `"0"`):

```ts
  const specificGenre = getGenreId(kw);
  // Baby-only scope: search the specific baby genre + 100533 (baby & maternity).
  // No "0" (all-genres) fallback — off-topic queries should return nothing so the
  // UI can show an on-brand "baby products only" empty state.
  const genreFallbacks = specificGenre === "100533"
    ? ["100533"]
    : [specificGenre, "100533"];
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx jest src/lib/platforms/rakuten-genre-scope.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/rakuten.ts src/lib/platforms/rakuten-genre-scope.test.ts
git commit -m "feat(search): scope Rakuten search to baby genres (drop all-genres fallback)"
```

---

## Task 4: Bump the search cache prefix (kw5 → kw6)

**Files:**
- Modify: `src/app/api/search/route.ts`
- Modify: `src/app/api/search/stream/route.ts`

- [ ] **Step 1: Bump both prefixes**

In `src/app/api/search/route.ts`, change:

```ts
  // kw5: prefix — busts kw4 entries that had no Amazon results.
  const cacheKey = makeCacheKey(`kw5:${query}`)
```
to:
```ts
  // kw6: prefix — busts kw5 entries created with the all-genres Rakuten fallback.
  const cacheKey = makeCacheKey(`kw6:${query}`)
```

In `src/app/api/search/stream/route.ts`, change `const cacheKey = makeCacheKey(\`kw5:${query}\`)` to `const cacheKey = makeCacheKey(\`kw6:${query}\`)`.

- [ ] **Step 2: Verify**

Run: `grep -rn "kw5:" src/app/api/search`
Expected: no output (both bumped to kw6).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/search/route.ts src/app/api/search/stream/route.ts
git commit -m "chore(search): bump cache prefix kw5 -> kw6 for baby-scoped results"
```

---

## Task 5: On-brand empty state for zero-result searches

**Files:**
- Modify: `src/components/KeywordResultsList.tsx:17-22`

- [ ] **Step 1: Replace the empty message**

In `src/components/KeywordResultsList.tsx`, find the empty block:

```tsx
      {results.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}
```

Replace it with the on-brand baby-only message:

```tsx
      {results.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)] leading-relaxed">
          ベビ得はベビー用品専門です。<br />
          おむつ・ミルク・抱っこ紐などで検索してください。<br />
          <span className="italic text-xs">ベビ得 only covers baby products — try diapers, formula, carriers, etc.</span>
        </p>
      )}
```

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: exit 0, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/KeywordResultsList.tsx
git commit -m "feat(ui): on-brand baby-only empty state for zero-result searches"
```

---

## Task 6: Swap the brand name in the Amazon appeal pack

**Files:**
- Modify: `docs/superpowers/specs/amazon-associate-reapplication.md`

- [ ] **Step 1: Replace brand references**

The appeal doc refers to the site by URL (`nedankurabe.vercel.app`, unchanged) and does not need URL edits. Update only human-facing brand wording: if the doc names the app "ねだんくらべ" anywhere, change it to "ベビ得". Run `grep -n "ねだんくらべ" docs/superpowers/specs/amazon-associate-reapplication.md` first; if there are no matches, this task is a no-op and you can skip the commit.

> Do NOT change `nedankurabe.vercel.app` (the domain is unchanged) or `nedankurabe-22` (the tag is unchanged).

- [ ] **Step 2: Commit (only if changed)**

```bash
git add docs/superpowers/specs/amazon-associate-reapplication.md
git commit -m "docs: use ベビ得 brand name in Amazon appeal pack"
```

---

## Task 7: Verify + deploy + browser smoke

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: the new `rakuten-genre-scope` test passes; no new failures. (Pre-existing failures: 3 in `crawlers/rakuten.test.ts` + `platforms/rakuten.test.ts`, which fail identically on `master` and are unrelated — confirm the count is still exactly those 3.)

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Deploy to production**

Run: `npx vercel --prod --yes --archive=tgz`
Expected: `readyState: READY`, `target: production`.

- [ ] **Step 4: Browser smoke (prod, nedankurabe.vercel.app)**

- Home page: hero shows **ベビ得** (得 in red) + tagline 「ベビー用品を、かしこくおトクに。」; browser tab title shows ベビ得.
- Search a baby term (e.g. パンパース テープ): Rakuten priced results + DB Amazon link-only results appear (unchanged behavior).
- Search an off-topic term (e.g. コーヒー): the on-brand empty state renders — 「ベビ得はベビー用品専門です…」 — and **no** generic coffee results appear.

- [ ] **Step 5: Final commit if any fixups were needed**

```bash
git add -A && git commit -m "fix: rebrand/baby-scope verification fixups"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** A. UI rename (Task 1) + localStorage key (Task 2); B. tagline/positioning (Task 1 hero); C. baby-scope (Task 3 + cache bump Task 4 + empty state Task 5); D. appeal-pack brand (Task 6). All spec sections covered.
- **NOT touched** (per spec): domain, Rakuten `Referer`/`Origin` headers, Amazon tag `nedankurabe-22`. The hero/title/key are the only `nedankurabe`/`ねだんくらべ` strings that change; the Rakuten header URL and the `-22` tag stay.
- **getGenreId for off-topic keywords:** whatever specific genre it returns, the `100533` (baby & maternity) attempt still runs; only genuinely off-topic queries (no hits in either baby genre) go empty. Genuine baby queries are unaffected.
- **Empty-state timing:** `KeywordResultsList` renders only after the first results arrive (the page shows a loading screen before `mode === 'keyword-list'`), so the empty message won't flash during initial load.
