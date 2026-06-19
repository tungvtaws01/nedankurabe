# no_match Re-evaluation & Per-Genre Prompt Tuning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build durable tooling to re-evaluate all 4,162 `no_match` products via manual browser verification (genre by genre), recover confirmed false-negatives into live DB matches, and tune `refineKeyword`/`semanticMatch` from observed failures — then execute the loop on the pilot genre (bottles).

**Architecture:** Pure, unit-tested logic lives under `src/lib/harvest/reeval/` (a JSONL ledger module + a recovery helper). Thin CLI orchestration lives under `scripts/harvest/reeval/` (seed / status / recover). The existing `scripts/harvest/02-match-amazon.ts` gains a `--retry-no-match` mode for the at-scale automated re-run. A new goldset scorer guards prompt tuning against regressions. A committed per-genre `docs/harvest/reeval/<category>.jsonl` ledger is the source of truth across the many sessions all-manual verification requires.

**Tech Stack:** TypeScript, Node 20 + tsx, Jest 29 (ts-jest), Neon Postgres (`pg`), OpenRouter (qwen) for LLM, chrome-devtools MCP for manual browser verification.

## Global Constraints

- **Amazon link-only / compliance:** store ONLY an ASIN→product mapping. Never fetch/store Amazon prices, images, ratings, or reviews. (CLAUDE.md HARD RULE.)
- **Jest ignores `/scripts/`** (`testPathIgnorePatterns`). All unit-tested code MUST live under `src/`. Scripts under `scripts/` are verified by running them.
- **Scripts run unpooled:** set `process.env.USE_UNPOOLED = '1'` as the first line of every new script (before importing `db`), matching `02-match-amazon.ts`.
- **LLM models:** `refineKeyword` (FAST) and `semanticMatch` (JUDGE) both run `qwen/qwen3-235b-a22b-2507` via `OPENROUTER_MODEL*` env vars in `.env.local`. Do not change model config.
- **Category keying:** the matcher keys on the `products.category` **slug** (`'bottles'`), not the Rakuten genre id (`205208`). The pilot unit is the slug `bottles`.
- **Ledgers committed to git** under `docs/harvest/reeval/` for cross-session/cross-machine resume.
- **Genre fallback:** never fall back to Rakuten genre `"0"`.
- **Price arithmetic:** `floor()`, never `round()` (not exercised here, but holds repo-wide).
- **Green gate:** `npm test` and `npx tsc --noEmit` must pass before any commit that touches `src/`.

---

### Task 1: Ledger module (pure logic + types)

The ledger is the backbone: every verdict is written to disk immediately so a context reset costs at most one in-flight item. This task builds the pure, file-format-agnostic operations and their types. No DB, no fs here — callers pass/receive arrays and strings.

**Files:**
- Create: `src/lib/harvest/reeval/ledger.ts`
- Test: `src/lib/harvest/reeval/ledger.test.ts`

**Interfaces:**
- Produces:
  - `type LedgerStatus = 'pending' | 'recovered' | 'confirmed_no_match' | 'captcha' | 'skipped'`
  - `type FailureMode = 'keyword_hallucination' | 'search_miss' | 'matcher_rejection' | 'true_no_match'`
  - `interface LedgerRow { product_id: number; title: string; refined_keyword: string; status: LedgerStatus; found_asin: string | null; failure_mode: FailureMode | null; notes: string; checked_at: string | null }`
  - `interface SeedRow { product_id: number; title: string; refined_keyword: string }`
  - `parseLedger(text: string): LedgerRow[]`
  - `serializeLedger(rows: LedgerRow[]): string`
  - `mergeSeed(existing: LedgerRow[], seeded: SeedRow[]): LedgerRow[]`
  - `applyVerdict(rows: LedgerRow[], productId: number, patch: { status: LedgerStatus; found_asin?: string | null; failure_mode?: FailureMode | null; notes?: string; checked_at: string }): LedgerRow[]`
  - `summarize(rows: LedgerRow[]): { total: number } & Record<LedgerStatus, number>`
  - `nextPending(rows: LedgerRow[]): LedgerRow | null`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/harvest/reeval/ledger.test.ts
import {
  parseLedger, serializeLedger, mergeSeed, applyVerdict, summarize, nextPending,
  type LedgerRow, type SeedRow,
} from './ledger'

const seed: SeedRow[] = [
  { product_id: 1, title: 'ピジョン 母乳実感 240ml', refined_keyword: 'ピジョン 母乳実感 哺乳びん 240ml' },
  { product_id: 2, title: 'コンビ テテオ 160ml', refined_keyword: 'コンビ テテオ 哺乳びん 160ml' },
]

describe('mergeSeed', () => {
  it('creates a pending row per new seed item', () => {
    const rows = mergeSeed([], seed)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ product_id: 1, status: 'pending', found_asin: null, failure_mode: null, checked_at: null })
  })

  it('is idempotent and preserves already-decided rows', () => {
    let rows = mergeSeed([], seed)
    rows = applyVerdict(rows, 1, { status: 'recovered', found_asin: 'B00TEST1234', failure_mode: 'matcher_rejection', checked_at: '2026-06-19T00:00:00Z' })
    const again = mergeSeed(rows, seed) // re-seeding must not clobber decided rows
    expect(again).toHaveLength(2)
    expect(again.find((r) => r.product_id === 1)).toMatchObject({ status: 'recovered', found_asin: 'B00TEST1234' })
  })

  it('appends genuinely new seed items without touching existing ones', () => {
    const rows = mergeSeed(mergeSeed([], seed), [...seed, { product_id: 3, title: 'x', refined_keyword: 'x' }])
    expect(rows.map((r) => r.product_id)).toEqual([1, 2, 3])
  })
})

describe('applyVerdict', () => {
  it('updates the matching row and leaves others untouched', () => {
    const rows = applyVerdict(mergeSeed([], seed), 2, { status: 'confirmed_no_match', failure_mode: 'true_no_match', checked_at: '2026-06-19T00:00:00Z' })
    expect(rows.find((r) => r.product_id === 2)).toMatchObject({ status: 'confirmed_no_match', failure_mode: 'true_no_match' })
    expect(rows.find((r) => r.product_id === 1)!.status).toBe('pending')
  })

  it('throws when the product_id is absent', () => {
    expect(() => applyVerdict([], 99, { status: 'skipped', checked_at: 'now' })).toThrow(/99/)
  })
})

describe('parse/serialize', () => {
  it('round-trips', () => {
    const rows = mergeSeed([], seed)
    expect(parseLedger(serializeLedger(rows))).toEqual(rows)
  })
  it('parseLedger ignores blank lines', () => {
    expect(parseLedger('\n\n')).toEqual([])
  })
})

describe('summarize & nextPending', () => {
  it('counts by status', () => {
    let rows = mergeSeed([], seed)
    rows = applyVerdict(rows, 1, { status: 'recovered', checked_at: 'now' })
    expect(summarize(rows)).toMatchObject({ total: 2, pending: 1, recovered: 1 })
  })
  it('nextPending returns the first pending or null', () => {
    let rows = mergeSeed([], seed)
    expect(nextPending(rows)!.product_id).toBe(1)
    rows = applyVerdict(rows, 1, { status: 'skipped', checked_at: 'now' })
    expect(nextPending(rows)!.product_id).toBe(2)
    rows = applyVerdict(rows, 2, { status: 'skipped', checked_at: 'now' })
    expect(nextPending(rows)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/harvest/reeval/ledger.test.ts`
Expected: FAIL — `Cannot find module './ledger'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/harvest/reeval/ledger.ts
export type LedgerStatus = 'pending' | 'recovered' | 'confirmed_no_match' | 'captcha' | 'skipped'
export type FailureMode = 'keyword_hallucination' | 'search_miss' | 'matcher_rejection' | 'true_no_match'

export interface LedgerRow {
  product_id: number
  title: string
  refined_keyword: string
  status: LedgerStatus
  found_asin: string | null
  failure_mode: FailureMode | null
  notes: string
  checked_at: string | null
}

export interface SeedRow {
  product_id: number
  title: string
  refined_keyword: string
}

const ALL_STATUSES: LedgerStatus[] = ['pending', 'recovered', 'confirmed_no_match', 'captcha', 'skipped']

export function parseLedger(text: string): LedgerRow[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l) as LedgerRow)
}

export function serializeLedger(rows: LedgerRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
}

// Idempotent: existing rows (decided or not) are kept verbatim; only genuinely new
// seed product_ids are appended as fresh pending rows. Re-seeding never clobbers work.
export function mergeSeed(existing: LedgerRow[], seeded: SeedRow[]): LedgerRow[] {
  const have = new Set(existing.map((r) => r.product_id))
  const added: LedgerRow[] = seeded
    .filter((s) => !have.has(s.product_id))
    .map((s) => ({
      product_id: s.product_id, title: s.title, refined_keyword: s.refined_keyword,
      status: 'pending', found_asin: null, failure_mode: null, notes: '', checked_at: null,
    }))
  return [...existing, ...added]
}

export function applyVerdict(
  rows: LedgerRow[],
  productId: number,
  patch: { status: LedgerStatus; found_asin?: string | null; failure_mode?: FailureMode | null; notes?: string; checked_at: string },
): LedgerRow[] {
  let found = false
  const next = rows.map((r) => {
    if (r.product_id !== productId) return r
    found = true
    return {
      ...r,
      status: patch.status,
      found_asin: patch.found_asin !== undefined ? patch.found_asin : r.found_asin,
      failure_mode: patch.failure_mode !== undefined ? patch.failure_mode : r.failure_mode,
      notes: patch.notes !== undefined ? patch.notes : r.notes,
      checked_at: patch.checked_at,
    }
  })
  if (!found) throw new Error(`applyVerdict: product_id ${productId} not found in ledger`)
  return next
}

export function summarize(rows: LedgerRow[]): { total: number } & Record<LedgerStatus, number> {
  const out = { total: rows.length } as { total: number } & Record<LedgerStatus, number>
  for (const s of ALL_STATUSES) out[s] = 0
  for (const r of rows) out[r.status]++
  return out
}

export function nextPending(rows: LedgerRow[]): LedgerRow | null {
  return rows.find((r) => r.status === 'pending') ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/harvest/reeval/ledger.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/harvest/reeval/ledger.ts src/lib/harvest/reeval/ledger.test.ts
git commit -m "feat(reeval): durable JSONL ledger module for no_match re-evaluation"
```

---

### Task 2: Recovery logic + widen `matchSource` union

When manual verification confirms a real Amazon equivalent, the DB is updated immediately (write-through). This task adds the recovery helper and a revert function, and widens the `matchSource` type to allow the new `'manual'` tag. The DB column `match_source TEXT NOT NULL` has no CHECK constraint, so no SQL migration is needed.

**Files:**
- Modify: `src/lib/harvest/repo.ts:11-20` (`ListingInput.matchSource` union)
- Create: `src/lib/harvest/reeval/recover.ts`
- Test: `src/lib/harvest/reeval/recover.test.ts`

**Interfaces:**
- Consumes: `upsertListing`, `setHarvestState` from `src/lib/harvest/repo`; `query` from `src/lib/db`; `parsePackCount` from `src/lib/jan/pack-count`.
- Produces:
  - `recordRecovery(productId: number, asin: string, amazonTitle: string): Promise<void>`
  - `revertManualRecoveries(): Promise<number>` (returns count of listings deactivated)

- [ ] **Step 1: Widen the `matchSource` union**

In `src/lib/harvest/repo.ts`, change the `ListingInput.matchSource` field:

```ts
  matchSource: 'jan-exact' | 'title-sim' | 'llm' | 'manual'
```

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/harvest/reeval/recover.test.ts
import { recordRecovery, revertManualRecoveries } from './recover'
import * as repo from '../repo'
import * as db from '../../db'

jest.mock('../repo')
jest.mock('../../db')

const upsertListing = repo.upsertListing as jest.MockedFunction<typeof repo.upsertListing>
const setHarvestState = repo.setHarvestState as jest.MockedFunction<typeof repo.setHarvestState>
const query = db.query as jest.MockedFunction<typeof db.query>

beforeEach(() => jest.clearAllMocks())

describe('recordRecovery', () => {
  it('inserts a manual amazon listing then flips the product to amazon_done', async () => {
    await recordRecovery(42, 'B00ABCDE12', 'ピジョン 母乳実感 哺乳びん 240ml 2本セット')
    expect(upsertListing).toHaveBeenCalledWith(expect.objectContaining({
      productId: 42, platform: 'amazon', platformId: 'B00ABCDE12',
      matchSource: 'manual', confidence: 1.0,
    }))
    // pack count parsed from the title (2本セット -> 2)
    expect(upsertListing.mock.calls[0][0].packCount).toBe(2)
    expect(setHarvestState).toHaveBeenCalledWith(42, 'amazon_done')
    // ordering: listing written before state flip
    expect(upsertListing.mock.invocationCallOrder[0]).toBeLessThan(setHarvestState.mock.invocationCallOrder[0])
  })
})

describe('revertManualRecoveries', () => {
  it('deactivates manual listings, resets their products to no_match, returns the count', async () => {
    query.mockResolvedValueOnce([{ product_id: 1 }, { product_id: 2 }] as never)
    query.mockResolvedValueOnce([] as never)
    const n = await revertManualRecoveries()
    expect(n).toBe(2)
    expect(query.mock.calls[0][0]).toMatch(/UPDATE listings[\s\S]*is_active\s*=\s*false[\s\S]*match_source\s*=\s*'manual'/i)
    expect(query.mock.calls[1][0]).toMatch(/harvest_state[\s\S]*'no_match'/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/harvest/reeval/recover.test.ts`
Expected: FAIL — `Cannot find module './recover'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// src/lib/harvest/reeval/recover.ts
import { upsertListing, setHarvestState } from '../repo'
import { query } from '../../db'
import { parsePackCount } from '../../jan/pack-count'

// Write-through recovery: a human confirmed `asin` is the true Amazon equivalent of
// product `productId`. Stores ONLY the ASIN->product mapping (no Amazon price/image),
// tagged match_source='manual' so it is auditable and reversible. Then flips the
// product out of no_match. Listing is written before the state flip so a crash between
// the two leaves a recoverable listing rather than a lying state.
export async function recordRecovery(productId: number, asin: string, amazonTitle: string): Promise<void> {
  await upsertListing({
    productId, platform: 'amazon', platformId: asin, title: amazonTitle,
    packCount: parsePackCount(amazonTitle), matchSource: 'manual', confidence: 1.0,
  })
  await setHarvestState(productId, 'amazon_done')
}

// Full reversal of every manual recovery: deactivate the manual listings and put their
// products back to no_match. Returns the number of products reverted.
export async function revertManualRecoveries(): Promise<number> {
  const reverted = await query<{ product_id: number }>(
    `UPDATE listings SET is_active = false
      WHERE match_source = 'manual' AND is_active = true
      RETURNING product_id`,
  )
  const ids = reverted.map((r) => r.product_id)
  if (ids.length) {
    await query(
      `UPDATE harvest_state SET stage = 'no_match', updated_at = now()
        WHERE product_id = ANY($1::bigint[])`,
      [ids],
    )
  }
  return ids.length
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/lib/harvest/reeval/recover.test.ts && npx tsc --noEmit`
Expected: PASS, and tsc clean (confirms `matchSource: 'manual'` is now type-valid).

- [ ] **Step 6: Commit**

```bash
git add src/lib/harvest/repo.ts src/lib/harvest/reeval/recover.ts src/lib/harvest/reeval/recover.test.ts
git commit -m "feat(reeval): write-through manual recovery + revert; allow match_source='manual'"
```

---

### Task 3: Seed CLI — `reeval:seed <category>`

Pulls a category's `no_match` products from the DB, runs `refineKeyword` (qwen) on each to capture the pipeline's keyword, and merges them into the committed ledger. Idempotent: re-running after partial verification never loses decided rows.

**Files:**
- Create: `scripts/harvest/reeval/seed.ts`
- Modify: `package.json:14` (add `reeval:seed` after `harvest:report`)
- Data (generated): `docs/harvest/reeval/bottles.jsonl`

**Interfaces:**
- Consumes: `query`, `pool` from `src/lib/db`; `refineKeyword` from `src/lib/llm/openrouter`; `mergeSeed`, `parseLedger`, `serializeLedger`, `summarize`, `type SeedRow` from `src/lib/harvest/reeval/ledger`; `Category` from `src/lib/llm/category-prompts`.

- [ ] **Step 1: Write the script**

```ts
// scripts/harvest/reeval/seed.ts
process.env.USE_UNPOOLED = '1'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { query, pool } from '../../../src/lib/db'
import { refineKeyword } from '../../../src/lib/llm/openrouter'
import { mergeSeed, parseLedger, serializeLedger, summarize, type SeedRow } from '../../../src/lib/harvest/reeval/ledger'
import type { Category } from '../../../src/lib/llm/category-prompts'

function ledgerPath(category: string): string {
  return path.join(process.cwd(), 'docs/harvest/reeval', `${category}.jsonl`)
}

async function main() {
  const category = process.argv[2]
  if (!category) { console.error('usage: reeval:seed <category-slug>   e.g. reeval:seed bottles'); process.exit(1) }

  const rows = await query<{ id: number; title: string }>(
    `SELECT p.id, p.title FROM products p
       JOIN harvest_state hs ON hs.product_id = p.id
      WHERE hs.stage = 'no_match' AND p.category = $1
      ORDER BY p.id`,
    [category],
  )
  console.log(`[seed] ${category}: ${rows.length} no_match products`)

  const seeded: SeedRow[] = []
  for (const r of rows) {
    const refined = await refineKeyword(r.title, 'amazon', category as Category).catch(() => r.title)
    seeded.push({ product_id: r.id, title: r.title, refined_keyword: refined })
    if (seeded.length % 25 === 0) console.log(`[seed] refined ${seeded.length}/${rows.length}`)
  }

  const file = ledgerPath(category)
  mkdirSync(path.dirname(file), { recursive: true })
  const existing = existsSync(file) ? parseLedger(readFileSync(file, 'utf8')) : []
  const merged = mergeSeed(existing, seeded)
  writeFileSync(file, serializeLedger(merged))
  console.log(`[seed] wrote ${file}`, summarize(merged))
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add after the `harvest:report` line:

```json
    "reeval:seed": "USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/reeval/seed.ts",
```

- [ ] **Step 3: Run it for the pilot genre**

Run: `npm run reeval:seed bottles`
Expected: logs `[seed] bottles: N no_match products`, then `[seed] wrote .../bottles.jsonl { total: N, pending: N, ... }`. A `docs/harvest/reeval/bottles.jsonl` file now exists with one `pending` row per item.

- [ ] **Step 4: Verify idempotency**

Run: `npm run reeval:seed bottles` again.
Expected: same `total`, `pending` unchanged (no duplicate rows). Confirm with `wc -l docs/harvest/reeval/bottles.jsonl` (line count stable across both runs).

- [ ] **Step 5: Commit (tool + seeded ledger)**

```bash
git add package.json scripts/harvest/reeval/seed.ts docs/harvest/reeval/bottles.jsonl
git commit -m "feat(reeval): seed CLI + committed bottles no_match ledger"
```

---

### Task 4: Status CLI — `reeval:status`

Reads every `docs/harvest/reeval/*.jsonl` ledger and prints a per-genre progress table, so any session instantly knows what is decided and what remains.

**Files:**
- Create: `scripts/harvest/reeval/status.ts`
- Modify: `package.json` (add `reeval:status`)

**Interfaces:**
- Consumes: `parseLedger`, `summarize` from `src/lib/harvest/reeval/ledger`.

- [ ] **Step 1: Write the script**

```ts
// scripts/harvest/reeval/status.ts
import { readFileSync, readdirSync, existsSync } from 'fs'
import path from 'path'
import { parseLedger, summarize } from '../../../src/lib/harvest/reeval/ledger'

function main() {
  const dir = path.join(process.cwd(), 'docs/harvest/reeval')
  if (!existsSync(dir)) { console.log('no ledgers yet (docs/harvest/reeval missing)'); return }
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
  if (!files.length) { console.log('no ledgers yet'); return }

  let gTotal = 0, gPending = 0, gRecovered = 0, gNoMatch = 0
  console.log('genre            total  pending  recovered  no_match  captcha  skipped')
  for (const f of files) {
    const s = summarize(parseLedger(readFileSync(path.join(dir, f), 'utf8')))
    const name = f.replace(/\.jsonl$/, '').padEnd(15)
    console.log(`${name}  ${String(s.total).padStart(5)}  ${String(s.pending).padStart(7)}  ${String(s.recovered).padStart(9)}  ${String(s.confirmed_no_match).padStart(8)}  ${String(s.captcha).padStart(7)}  ${String(s.skipped).padStart(7)}`)
    gTotal += s.total; gPending += s.pending; gRecovered += s.recovered; gNoMatch += s.confirmed_no_match
  }
  console.log(`\nTOTAL: ${gTotal}  pending=${gPending}  recovered=${gRecovered}  confirmed_no_match=${gNoMatch}`)
}
main()
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add:

```json
    "reeval:status": "node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/reeval/status.ts",
```

- [ ] **Step 3: Run it**

Run: `npm run reeval:status`
Expected: a table with a `bottles` row showing `total=N pending=N` (all pending, since none verified yet) and a `TOTAL` line.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/harvest/reeval/status.ts
git commit -m "feat(reeval): status CLI for per-genre ledger progress"
```

---

### Task 5: Recover CLI — `reeval:recover`

A single command the verification loop calls when it confirms a match: writes the live DB recovery AND updates the ledger row, atomically from the operator's view.

**Files:**
- Create: `scripts/harvest/reeval/recover.ts`
- Modify: `package.json` (add `reeval:recover`)

**Interfaces:**
- Consumes: `recordRecovery` from `src/lib/harvest/reeval/recover`; `pool` from `src/lib/db`; `parseLedger`, `serializeLedger`, `applyVerdict` from `src/lib/harvest/reeval/ledger`.

- [ ] **Step 1: Write the script**

```ts
// scripts/harvest/reeval/recover.ts
process.env.USE_UNPOOLED = '1'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { recordRecovery } from '../../../src/lib/harvest/reeval/recover'
import { pool } from '../../../src/lib/db'
import { parseLedger, serializeLedger, applyVerdict } from '../../../src/lib/harvest/reeval/ledger'

// usage: reeval:recover <category> <productId> <asin> "<amazon title>"
async function main() {
  const [category, productIdRaw, asin, ...titleParts] = process.argv.slice(2)
  const amazonTitle = titleParts.join(' ')
  if (!category || !productIdRaw || !asin || !amazonTitle) {
    console.error('usage: reeval:recover <category> <productId> <asin> "<amazon title>"'); process.exit(1)
  }
  const productId = parseInt(productIdRaw, 10)

  await recordRecovery(productId, asin, amazonTitle)

  const file = path.join(process.cwd(), 'docs/harvest/reeval', `${category}.jsonl`)
  const rows = applyVerdict(parseLedger(readFileSync(file, 'utf8')), productId, {
    status: 'recovered', found_asin: asin, failure_mode: 'matcher_rejection',
    checked_at: new Date().toISOString(),
  })
  writeFileSync(file, serializeLedger(rows))
  console.log(`[recover] product ${productId} -> ${asin} (manual). Ledger updated.`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

Note: `failure_mode: 'matcher_rejection'` is the default reason a manual-found match was missed; the operator overrides it in the ledger (or via a follow-up edit) when the true cause was `keyword_hallucination`/`search_miss`. The distinction drives tuning (Task 8), not recovery.

- [ ] **Step 2: Add the npm script**

In `package.json`, add:

```json
    "reeval:recover": "USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/reeval/recover.ts",
```

- [ ] **Step 3: Smoke-test against the DB (then revert)**

Pick a real `pending` product id + a known-valid ASIN from the bottles ledger and run:

Run: `npm run reeval:recover bottles <productId> <asin> "test title"`
Expected: `[recover] product <productId> -> <asin> (manual). Ledger updated.`
Verify: `npm run reeval:status` shows `recovered=1` for bottles; the ledger row's `status` is `recovered`.
Then revert the smoke test so real verification starts clean — deactivate the manual listing/state and restore the committed all-pending ledger:

```bash
USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx -e "import('./src/lib/harvest/reeval/recover').then(m=>m.revertManualRecoveries()).then(n=>console.log('reverted',n)).then(()=>process.exit(0))"
git checkout docs/harvest/reeval/bottles.jsonl
```

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/harvest/reeval/recover.ts
git commit -m "feat(reeval): recover CLI (live DB recovery + ledger update)"
```

---

### Task 6: `--retry-no-match` re-run mode in `02-match-amazon.ts`

After a genre is tuned, the automated matcher re-runs over its remaining `no_match` items with the improved prompts to recover matches at scale. Currently `--category` only scopes `stage='enumerated'`; add a flag to scope `stage='no_match'` instead.

**Files:**
- Modify: `scripts/harvest/02-match-amazon.ts:48-73`

**Interfaces:**
- Consumes: existing `query` + `isTrialOrSamplePack` already imported in the file.

- [ ] **Step 1: Add the flag and parametrize the stage**

In `scripts/harvest/02-match-amazon.ts`, after the `catArg`/`category` lines (around line 48-49), add:

```ts
  // --retry-no-match re-runs the matcher over products previously marked no_match
  // (instead of enumerated). Used after per-genre prompt tuning to recover at scale.
  const retryNoMatch = process.argv.includes('--retry-no-match')
```

Then change the `else if (category)` branch's query to use the chosen stage. Replace the existing block:

```ts
  } else if (category) {
    const stage = retryNoMatch ? 'no_match' : 'enumerated'
    const rows = await query<{ id: number; jan: string | null; title: string }>(
      `SELECT p.id, p.jan, p.title FROM products p
       JOIN harvest_state hs ON hs.product_id = p.id
       WHERE hs.stage = $1 AND p.category = $2
       ORDER BY p.id LIMIT $3`, [stage, category, limit])
    batch = rows.filter((p) => !isTrialOrSamplePack(p.title))
    console.log(`[amazon] category=${category} stage=${stage}: ${batch.length} products`)
  } else {
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Bounded dry run (1 item)**

Run: `npm run harvest:amazon -- --category=bottles --retry-no-match --limit=1`
Expected: log line `[amazon] category=bottles stage=no_match: 1 products`, then either a match or `no_match` for that single item, then `DONE`. (Confirms the flag selects no_match items and the run completes.)

- [ ] **Step 4: Commit**

```bash
git add scripts/harvest/02-match-amazon.ts
git commit -m "feat(harvest): --retry-no-match mode for per-genre at-scale re-run"
```

---

### Task 7: Goldset regression scorer

Tuning prompts must not regress existing good matches. This scorer runs `semanticMatch` over a category's labeled goldset pairs and reports KEEP recall + REMOVE rejection accuracy — the before/after guard for every prompt change.

**Files:**
- Create: `scripts/harvest/verify/score-goldset.ts`
- Modify: `package.json` (add `reeval:goldset`)

**Interfaces:**
- Consumes: `semanticMatch` from `src/lib/llm/openrouter`; `pool` from `src/lib/db`; `ProductResult` from `src/lib/types`; `Category` from `src/lib/llm/category-prompts`. Reads `docs/harvest/verify/goldset.jsonl` (keys: `category`, `atitle`, `rtitle`, `label` ∈ KEEP|REMOVE|UNSURE).

- [ ] **Step 1: Write the script**

```ts
// scripts/harvest/verify/score-goldset.ts
process.env.USE_UNPOOLED = '1'
import { readFileSync } from 'fs'
import path from 'path'
import { semanticMatch } from '../../../src/lib/llm/openrouter'
import { pool } from '../../../src/lib/db'
import type { ProductResult } from '../../../src/lib/types'
import type { Category } from '../../../src/lib/llm/category-prompts'

interface Gold { category: string; atitle: string; rtitle: string; label: 'KEEP' | 'REMOVE' | 'UNSURE' }

function pr(title: string): ProductResult {
  return { platform: 'amazon', title, imageUrl: '', shopName: '', salePrice: 1000,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
    subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1, affiliateUrl: '' }
}

async function main() {
  const catArg = process.argv.find((a) => a.startsWith('--category='))
  const category = catArg ? catArg.split('=')[1] : null
  const lines = readFileSync(path.join(process.cwd(), 'docs/harvest/verify/goldset.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Gold)
  const pairs = lines.filter((g) => (!category || g.category === category) && g.label !== 'UNSURE')

  let keepTotal = 0, keepHit = 0, removeTotal = 0, removeHit = 0
  for (const g of pairs) {
    const idx = await semanticMatch(pr(g.rtitle), [pr(g.atitle)], { category: g.category as Category }).catch(() => null)
    const predictedMatch = idx === 0
    if (g.label === 'KEEP') { keepTotal++; if (predictedMatch) keepHit++ }
    else { removeTotal++; if (!predictedMatch) removeHit++ }
  }
  const pct = (n: number, d: number) => d ? ((100 * n) / d).toFixed(1) + '%' : 'n/a'
  console.log(`[goldset] category=${category ?? 'ALL'} pairs=${pairs.length}`)
  console.log(`  KEEP recall    : ${keepHit}/${keepTotal} (${pct(keepHit, keepTotal)})  <- true matches kept`)
  console.log(`  REMOVE reject  : ${removeHit}/${removeTotal} (${pct(removeHit, removeTotal)})  <- false matches rejected`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add:

```json
    "reeval:goldset": "USE_UNPOOLED=1 node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/verify/score-goldset.ts",
```

- [ ] **Step 3: Capture the bottles baseline**

Run: `npm run reeval:goldset -- --category=bottles | tee docs/harvest/reeval/bottles-goldset-baseline.txt`
Expected: prints KEEP recall + REMOVE reject over the 246 bottles pairs. This file is the pre-tuning baseline the tuning task compares against.

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/harvest/verify/score-goldset.ts docs/harvest/reeval/bottles-goldset-baseline.txt
git commit -m "feat(reeval): goldset regression scorer + bottles baseline"
```

---

### Task 8: Runbook document

The all-manual verification + tuning loop spans many sessions; the runbook is the durable procedure each session follows. This is documentation — no tests.

**Files:**
- Create: `docs/harvest/reeval/RUNBOOK.md`

- [ ] **Step 1: Write the runbook**

Create `docs/harvest/reeval/RUNBOOK.md` with exactly this content:

````markdown
# no_match Re-evaluation Runbook

Per-genre loop. Genre unit = `products.category` slug (e.g. `bottles`, Rakuten genre 205208).
Spec: `docs/superpowers/specs/2026-06-19-no-match-reevaluation-design.md`.

## Per-genre loop

1. **Seed** the ledger: `npm run reeval:seed <category>` (idempotent; safe to re-run).
2. **Verify** each `pending` item (manual, chrome-devtools). Repeat until none pending.
3. **Tune** `refineKeyword` + `semanticMatch` from the ledger's `failure_mode` tally.
4. **Guard:** `npm run reeval:goldset -- --category=<category>` — must not drop vs baseline.
5. **Re-run** at scale: `npm run harvest:amazon -- --category=<category> --retry-no-match`.
6. **Report:** `npm run reeval:status` + `npm run harvest:report` (before/after recovery count).

## Verification micro-procedure (per pending item)

Pick the next pending item: read the ledger, take the first `status:"pending"` row
(`title`, `refined_keyword`, `product_id`).

**Q1 — Does a true Amazon equivalent exist?**
- In chrome-devtools, navigate to `https://www.amazon.co.jp/s?k=<good human keyword>`
  built from the title (brand + line + type + size). `take_snapshot` the results.
- Judge equivalence by brand / product line / type / per-unit size (same criteria as
  `semanticMatch`). Load product images only if titles are ambiguous.
- **If a real equivalent exists** → grab its ASIN (`/dp/ASIN`) and exact Amazon title, then:
  `npm run reeval:recover <category> <product_id> <ASIN> "<amazon title>"`
  (writes the live DB match, `match_source='manual'`, and sets the ledger row to `recovered`).
- **If no equivalent exists** → edit the ledger row directly: set
  `"status":"confirmed_no_match"`, `"failure_mode":"true_no_match"`, `"checked_at":"<ISO>"`.

**Q2 — If it existed, why did the pipeline miss it?** (drives tuning)
Compare the truth against `refined_keyword` and set `failure_mode` on the recovered row:
| failure_mode | signal | fixes |
|---|---|---|
| `keyword_hallucination` | `refined_keyword` invented/swapped a brand/line/spec not in `title` | refineKeyword |
| `search_miss` | keyword faithful but too narrow/broad → wrong pool | refineKeyword |
| `matcher_rejection` | correct candidate WOULD be in the pool; judge would reject | semanticMatch |
| `true_no_match` | nothing equivalent on Amazon | nothing |

Record a one-line `notes` with the concrete observation (e.g. "qwen output 母乳実感 but
title says 母乳相談室").

**CAPTCHA:** if Amazon challenges, set the in-flight row `"status":"captcha"`, stop, tell the
user to solve/wait, resume next session (the ledger has lost nothing).

## Tuning from the tally

- **refineKeyword** (`keyword_hallucination` + `search_miss`): use the `tune-category` skill.
  Edit the category builder in `src/lib/llm/category-prompts.ts` (or `ANTI_HALLUCINATION`
  for cross-category). Re-probe failing items with `scripts/probe-keyword.ts`.
- **semanticMatch** (`matcher_rejection`): add the missing equivalence to
  `src/lib/llm/brand-aliases.ts` (`BRAND_ALIASES`, the deterministic brand gate) and/or
  sharpen the category line in `src/lib/llm/match-rules.ts`. Add each rejected pair as a
  case to `scripts/probe-matcher.ts` and run it.
- **Always:** `npm test` + `npx tsc --noEmit` green; `reeval:goldset` not regressed.

## Reverting recoveries

All manual matches are reversible: `revertManualRecoveries()` in
`src/lib/harvest/reeval/recover.ts` deactivates every `match_source='manual'` listing and
resets those products to `no_match`.
````

- [ ] **Step 2: Commit**

```bash
git add docs/harvest/reeval/RUNBOOK.md
git commit -m "docs(reeval): per-genre verification + tuning runbook"
```

---

### Task 9: Execute the pilot loop on bottles

Operational, multi-session task — proves the whole loop end-to-end before scaling to other genres. Not TDD; completion is criteria-gated.

**Files:**
- Modify (data): `docs/harvest/reeval/bottles.jsonl` (verdicts accumulate)
- Modify (tuning): `src/lib/llm/category-prompts.ts` (BOTTLES_PROMPT), `src/lib/llm/brand-aliases.ts`, `src/lib/llm/match-rules.ts`, `scripts/probe-matcher.ts` — only as the tally dictates

- [ ] **Step 1: Verify every bottles item** following the RUNBOOK micro-procedure until `npm run reeval:status` shows `pending=0` for bottles (`captcha` rows resolved on resume). Commit the ledger periodically: `git add docs/harvest/reeval/bottles.jsonl && git commit -m "data(reeval): bottles verification progress"`.

- [ ] **Step 2: Tally failure modes** — read `docs/harvest/reeval/bottles.jsonl`, count `failure_mode` values across decided rows. This determines which prompt(s) to tune.

- [ ] **Step 3: Tune refineKeyword** (only if `keyword_hallucination`/`search_miss` present) per RUNBOOK + the `tune-category` skill. Verify: `npx jest` probe passes for the failing items; `npm test` + `npx tsc --noEmit` green. Commit.

- [ ] **Step 4: Tune semanticMatch** (only if `matcher_rejection` present) per RUNBOOK (`brand-aliases.ts` / `match-rules.ts` + `probe-matcher.ts` cases). Verify: `npm test` + `npx tsc --noEmit` green. Commit.

- [ ] **Step 5: Regression guard** — `npm run reeval:goldset -- --category=bottles`. KEEP recall and REMOVE reject must be ≥ the baseline in `docs/harvest/reeval/bottles-goldset-baseline.txt`. If either dropped, revisit the tuning. (No commit if regressed.)

- [ ] **Step 6: At-scale re-run** — `npm run harvest:amazon -- --category=bottles --retry-no-match`. This applies the tuned prompts to all remaining bottles `no_match` items.

- [ ] **Step 7: Report recovery** — `npm run reeval:status` and `npm run harvest:report`. Record the before/after bottles `no_match` count (manual recoveries + automated re-run recoveries). Commit the final ledger.

- [ ] **Step 8: Finish the branch** — invoke `superpowers:finishing-a-development-branch` to decide merge/PR. Confirm `npm test` (~245+ tests) and `npx tsc --noEmit` are green first.

**Success criteria (pilot):**
- Every bottles `no_match` item has a recorded ledger verdict (`pending=0`).
- Confirmed recoveries are live in the DB (`match_source='manual'` and/or re-run `llm`).
- `refineKeyword`/`semanticMatch` tuned as the tally dictated; `reeval:goldset` not regressed.
- `npm test` + `npx tsc --noEmit` green.
- Before/after bottles recovery count reported. Loop proven → ready to repeat for the next genre.

---

## Self-review notes

- **Spec coverage:** durable ledger (Task 1), live DB recovery + reversibility + `match_source='manual'` (Task 2), seed/status/recover CLIs (Tasks 3-5), at-scale `--retry-no-match` re-run (Task 6), goldset regression guard (Task 7), verification + tuning procedure (Task 8 runbook), pilot-first sequencing on bottles (Task 9). All spec sections map to a task.
- **Jest `/scripts/` ignore** honored: every `.test.ts` is under `src/`.
- **Type consistency:** `LedgerRow`/`LedgerStatus`/`FailureMode`/`SeedRow` defined in Task 1 are used verbatim in Tasks 3/5; `recordRecovery`/`revertManualRecoveries` signatures from Task 2 are consumed in Task 5; `matchSource: 'manual'` (Task 2) matches the value written by `recordRecovery`.
- **No Amazon data stored:** recovery writes only ASIN + Amazon title text (the matching DB already stores titles); no price/image/rating. Compliant with CLAUDE.md.
