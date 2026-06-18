# Rebrand to ベビ得 (bebitoku) + Baby-Scope — Design

**Date:** 2026-06-18
**Status:** Approved (design)
**Goal:** Rename the app from ねだんくらべ to **ベビ得** in the UI (domain unchanged), add a baby-products tagline/positioning line, and constrain search to baby products so off-topic queries return an on-brand empty state instead of generic Rakuten results.

## Why

The product targets baby products only, but the current generic name (ねだんくらべ = "price compare") doesn't signal the niche, and search currently falls back to all-genres Rakuten results for any query — making the app look generic/unfinished to an Amazon reviewer and undercutting the baby-only positioning. A niche-signaling brand plus a genuinely baby-scoped search reinforce specialization (the product's competitive edge) and present a more complete, intentional site for the Amazon Associate re-application.

## Decisions

- **Display name:** ベビ得 (kana + kanji; 得 = "smart value/savings"). Chosen for warmth + clear "baby + savings" framing.
- **Tagline:** 「ベビー用品を、かしこくおトクに。」 (EN: *Baby essentials, smartly and for less.*)
- **Homepage positioning line:** 「ベビー用品の実質価格をまとめて比較」
- **Domain unchanged:** stays `nedankurabe.vercel.app`. A brand name differing from the domain is normal and fine for the Amazon review. This deliberately avoids changing the Rakuten API `Referer`/`Origin` headers (which would require a Rakuten Developer console update and risk 403s).
- **Amazon associate tag unchanged:** `nedankurabe-22` is an invisible tracking string, not user-facing, and cannot easily change on a suspended account. No impact.

## Scope

### A. UI / metadata rename (ねだんくらべ → ベビ得)
The brand name is only displayed in two places (confirmed by grep — note the hero splits the word across a `<span>`, so search for `ねだん`, `くらべ`, and `Nedankurabe`, not the contiguous string):
- **`src/app/layout.tsx`** — the page `<title>` (`'ねだんくらべ — Amazon・楽天 最安値比較'`) → `'ベビ得 — ベビー用品の最安値比較'`, plus description/OG metadata if present.
- **`src/app/page.tsx`** — the hero `<h1>` currently renders `ねだん<span class="text-red">くらべ</span>` → `ベビ<span class="text-red">得</span>` (keep the red-accent-on-second-part pattern), and the subtitle line becomes the tagline/positioning (see B).
- **`package.json`** `name`: `nedankurabe` → `bebitoku` (cosmetic; optional but tidy).

**Confirmed NOT to contain the brand name (no change):** `Footer.tsx` and `AffiliateDisclosure.tsx` (these hold only the required "Amazonアソシエイト" disclosure, no brand string), and `SearchBox.tsx`.

**Explicitly NOT changed:** the domain; the Rakuten API `Referer`/`Origin` headers (`https://nedankurabe.vercel.app/` in `src/lib/platforms/rakuten.ts`); the Amazon tag `nedankurabe-22`; and the **`nedankurabe_toggles` localStorage key** in `results/page.tsx` (renaming it would reset every existing user's saved toggle preferences — it is invisible, so leave it).

### B. Tagline / positioning (#2)
- Add the tagline and positioning line to the homepage (`src/app/page.tsx`), styled with the existing design tokens.

### C. Baby-scope search (#1)
- In `src/lib/platforms/rakuten.ts`, remove the `genreId: "0"` (all-genres) entry from the `genreFallbacks` chain in `searchRakutenKeyword`, so search stays within baby genres (the specific genre + `100533` baby-and-maternity). Off-topic queries then return zero Rakuten results.
- In the results page keyword-list view (`src/app/results/page.tsx`), when a search yields no Rakuten **and** no Amazon results, show an on-brand empty state instead of the generic "no products found": 「ベビ得はベビー用品専門です。おむつ・ミルク・抱っこ紐などで検索してください」 (+ short English line).
- The existing Amazon DB search (`searchAmazonFromDb`) is already baby-only (the DB is baby-only), so no change there.

### D. Amazon appeal text
- Update `docs/superpowers/specs/amazon-associate-reapplication.md` to use the brand name ベビ得 (the site URL stays `nedankurabe.vercel.app`, so no URL change).

## Components touched

| File | Change |
|---|---|
| `src/app/layout.tsx` | `<title>` + description/OG → ベビ得 |
| `src/app/page.tsx` | hero `<h1>` ねだん/くらべ → ベビ/得; subtitle → tagline + positioning line |
| `package.json` | `name` → `bebitoku` (cosmetic) |
| `src/lib/platforms/rakuten.ts` | drop `genreId: "0"` fallback in `searchRakutenKeyword` |
| `src/app/results/page.tsx` | on-brand empty state for zero-result searches (do NOT touch the `nedankurabe_toggles` key) |
| `docs/.../amazon-associate-reapplication.md` | brand name → ベビ得 |

## Error handling / edge cases

- **Baby-relevant query that getGenreId can't classify:** the `100533` (baby & maternity) fallback still runs, so genuine baby queries that miss the specific-genre lookup still return results; only truly off-topic queries (no baby-genre hits) go empty.
- **Empty state vs. loading:** the on-brand empty message must show only after the search completes with zero results, not during the in-flight `crossSearching` state (reuse the existing loading/`crossSearching` guards).
- **Cached generic results:** the search cache prefix is bumped (`kw5` → `kw6`) so entries created with the all-genres fallback aren't served after deploy.

## Testing

- Unit: `searchRakutenKeyword`/`searchRakuten` no longer queries `genreId: "0"` (assert the genre list passed excludes "0"); a non-baby keyword returns `[]`.
- Manual/prod: search a baby term (returns Rakuten + DB Amazon), search an off-topic term ("コーヒー" → on-brand empty state, no generic results), confirm the brand name ベビ得 + tagline render on home, results, and footer.

## Pre-commit check

- Quick J-PlatPat (商標) sanity check on "ベビ得" — low-stakes (no domain/registration commitment), but worth a glance before it goes public.

## Out of scope

- Domain change, logo/visual redesign, Rakuten console changes, Amazon tag change, relevance ranking of DB Amazon search results.
