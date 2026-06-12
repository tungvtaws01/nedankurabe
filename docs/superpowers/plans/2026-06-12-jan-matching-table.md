# JAN Matching Table & Harvest Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent `JAN ↔ ASIN ↔ Rakuten itemCode` matching table (baby category) harvested in batch, used as a fast path before LLM matching.

**Architecture:** Neon Postgres (3 tables) is the first durable store. Batch scripts in `scripts/harvest/` enumerate Rakuten by genre (Stage 1), match Amazon via a local Playwright browser (Stage 2), and report coverage (Stage 3). Production `find-equivalent` reads the table first and writes back LLM matches.

**Tech Stack:** TypeScript, Next.js 16, Postgres via `pg`, Playwright (local scraping), `tsx` (script runner), Jest (tests).

**Reference spec:** `docs/superpowers/specs/2026-06-12-jan-matching-table-design.md`

**Conventions:**
- Scripts use **relative imports** into `src/` (not the `@/` alias) so `tsx` runs them without path-alias config.
- App code keeps using the `@/` alias.
- Scripts connect with `DATABASE_URL_UNPOOLED`; the app read path uses pooled `DATABASE_URL`.
- All env vars are already in `.env.local` (pulled from Vercel/Neon).

---

## Task 0: Dependencies & DB connection module

**Files:**
- Modify: `package.json` (add deps + scripts)
- Create: `src/lib/db.ts`
- Test: `src/lib/db.test.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install pg
npm install -D @types/pg tsx
npx playwright install chromium
npm install -D playwright
```

- [ ] **Step 2: Add npm scripts to package.json**

Add to the `"scripts"` block:

```json
    "harvest:migrate": "tsx scripts/harvest/00-migrate.ts",
    "harvest:enumerate": "tsx scripts/harvest/01-enumerate-rakuten.ts",
    "harvest:amazon": "tsx scripts/harvest/02-match-amazon.ts",
    "harvest:report": "tsx scripts/harvest/03-report.ts"
```

- [ ] **Step 3: Write the failing test**

```typescript
// src/lib/db.test.ts
import { query, pool } from './db'

describe('db', () => {
  afterAll(async () => { await pool.end() })

  it('connects and runs a trivial query', async () => {
    const rows = await query<{ n: number }>('SELECT 1 AS n')
    expect(rows[0].n).toBe(1)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest src/lib/db.test.ts`
Expected: FAIL — `Cannot find module './db'`.

- [ ] **Step 5: Implement `src/lib/db.ts`**

```typescript
import { Pool } from 'pg'

// Scripts set USE_UNPOOLED=1 to use the long-lived direct connection.
// The app (serverless) uses the pooled DATABASE_URL.
const connectionString = process.env.USE_UNPOOLED
  ? (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
  : process.env.DATABASE_URL

export const pool = new Pool({ connectionString, max: process.env.USE_UNPOOLED ? 4 : 1 })

export async function query<T = unknown>(text: string, params?: unknown[]): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest src/lib/db.test.ts`
Expected: PASS (requires `DATABASE_URL` in `.env.local`; if Jest doesn't load it, prefix with `node --env-file=.env.local` or add dotenv to jest setup).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/db.ts src/lib/db.test.ts
git commit -m "feat: add pg-based db module and harvest deps"
```

---

## Task 1: Schema migration

**Files:**
- Create: `scripts/harvest/schema.sql`
- Create: `scripts/harvest/00-migrate.ts`

- [ ] **Step 1: Write `scripts/harvest/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS products (
  id         BIGSERIAL PRIMARY KEY,
  jan        TEXT UNIQUE,
  title      TEXT NOT NULL,
  brand      TEXT,
  category   TEXT NOT NULL,
  image_url  TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS listings (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id),
  platform     TEXT NOT NULL CHECK (platform IN ('amazon','rakuten','yahoo')),
  platform_id  TEXT NOT NULL,
  title        TEXT,
  pack_count   INT DEFAULT 1,
  match_source TEXT NOT NULL,
  confidence   REAL,
  is_active    BOOLEAN DEFAULT true,
  verified_at  TIMESTAMPTZ,
  UNIQUE (platform, platform_id)
);
CREATE INDEX IF NOT EXISTS listings_product_platform_idx ON listings (product_id, platform);

CREATE TABLE IF NOT EXISTS harvest_state (
  product_id BIGINT PRIMARY KEY REFERENCES products(id),
  stage      TEXT NOT NULL,
  last_error TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 2: Write `scripts/harvest/00-migrate.ts`**

```typescript
import { readFileSync } from 'fs'
import { join } from 'path'
process.env.USE_UNPOOLED = '1'
import { pool } from '../../src/lib/db'

async function main() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
  console.log('[migrate] schema applied')
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Run the migration**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/00-migrate.ts`
Expected: prints `[migrate] schema applied`, no error.

- [ ] **Step 4: Verify tables exist**

Run: `node --env-file=.env.local node_modules/.bin/tsx -e "import('./src/lib/db').then(async m=>{console.log(await m.query(\"SELECT tablename FROM pg_tables WHERE schemaname='public'\")); process.exit(0)})"`
Expected: lists `products`, `listings`, `harvest_state`.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/schema.sql scripts/harvest/00-migrate.ts
git commit -m "feat: harvest schema migration (products, listings, harvest_state)"
```

---

## Task 2: JAN-13 validation & extraction (pure, TDD)

**Files:**
- Create: `src/lib/jan/jan.ts`
- Test: `src/lib/jan/jan.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/jan/jan.test.ts
import { isValidJan13, extractJans } from './jan'

describe('isValidJan13', () => {
  it('accepts a valid JAN-13 (check digit correct)', () => {
    expect(isValidJan13('4902430911573')).toBe(true) // P&G Pampers
  })
  it('rejects wrong check digit', () => {
    expect(isValidJan13('4902430911574')).toBe(false)
  })
  it('rejects non-13-digit or non-45/49 prefix', () => {
    expect(isValidJan13('490243091157')).toBe(false)  // 12 digits
    expect(isValidJan13('1234567890123')).toBe(false) // valid-shaped but wrong prefix
  })
})

describe('extractJans', () => {
  it('pulls valid JANs out of marketing text, dedupes', () => {
    const text = '【送料無料】おむつ JAN:4902430911573 まとめ買い 4902430911573'
    expect(extractJans(text)).toEqual(['4902430911573'])
  })
  it('ignores 13-digit runs that fail the check digit', () => {
    expect(extractJans('code 4902430911574 here')).toEqual([])
  })
  it('returns [] when none present', () => {
    expect(extractJans('ベビー用品 お買い得')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/jan/jan.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/jan/jan.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/jan/jan.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jan/jan.ts src/lib/jan/jan.test.ts
git commit -m "feat: JAN-13 validation and extraction"
```

---

## Task 3: pack_count parser (pure, TDD)

**Files:**
- Create: `src/lib/jan/pack-count.ts`
- Test: `src/lib/jan/pack-count.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/jan/pack-count.test.ts
import { parsePackCount } from './pack-count'

describe('parsePackCount', () => {
  it('reads ×N case-pack notations', () => {
    expect(parsePackCount('おむつ 66枚×4パック ケース')).toBe(4)
    expect(parsePackCount('粉ミルク 800g 2缶セット')).toBe(2)
    expect(parsePackCount('おしりふき 80枚×16個')).toBe(16)
  })
  it('defaults to 1 when no multiplier present', () => {
    expect(parsePackCount('抱っこ紐 エルゴ OMNI Breeze')).toBe(1)
    expect(parsePackCount('粉ミルク 800g')).toBe(1)
  })
  it('does not treat per-unit content (枚/g) as pack count', () => {
    expect(parsePackCount('おむつ Mサイズ 64枚')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/jan/pack-count.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/jan/pack-count.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/jan/pack-count.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/jan/pack-count.ts src/lib/jan/pack-count.test.ts
git commit -m "feat: pack_count parser (identical-unit multiplier)"
```

---

## Task 4: Harvest repository (DB writes/reads, integration TDD)

**Files:**
- Create: `src/lib/harvest/repo.ts`
- Test: `src/lib/harvest/repo.test.ts`

These tests hit the real database and clean up after themselves using a sentinel
category `__test__`.

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/harvest/repo.test.ts
process.env.USE_UNPOOLED = '1'
import { pool } from '../db'
import { upsertProduct, upsertListing, setHarvestState, findListingByPlatformId } from './repo'

const CAT = '__test__'

afterAll(async () => {
  await pool.query(
    `DELETE FROM harvest_state WHERE product_id IN (SELECT id FROM products WHERE category=$1)`, [CAT])
  await pool.query(
    `DELETE FROM listings WHERE product_id IN (SELECT id FROM products WHERE category=$1)`, [CAT])
  await pool.query(`DELETE FROM products WHERE category=$1`, [CAT])
  await pool.end()
})

it('upserts a product and is idempotent on JAN', async () => {
  const id1 = await upsertProduct({ jan: '4902430911573', title: 'A', brand: 'P&G', category: CAT, imageUrl: '' })
  const id2 = await upsertProduct({ jan: '4902430911573', title: 'A2', brand: 'P&G', category: CAT, imageUrl: '' })
  expect(id1).toBe(id2)
})

it('upserts a listing and finds it by platform_id', async () => {
  const productId = await upsertProduct({ jan: null, title: 'B', brand: null, category: CAT, imageUrl: '' })
  await upsertListing({
    productId, platform: 'amazon', platformId: 'B0TEST123', title: 'B amazon',
    packCount: 4, matchSource: 'title-sim', confidence: 0.9,
  })
  const found = await findListingByPlatformId('B0TEST123')
  expect(found?.product_id).toBe(productId)
  expect(found?.pack_count).toBe(4)
})

it('records harvest state', async () => {
  const productId = await upsertProduct({ jan: null, title: 'C', brand: null, category: CAT, imageUrl: '' })
  await setHarvestState(productId, 'enumerated')
  const rows = await pool.query(`SELECT stage FROM harvest_state WHERE product_id=$1`, [productId])
  expect(rows.rows[0].stage).toBe('enumerated')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --env-file=.env.local node_modules/.bin/jest src/lib/harvest/repo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/harvest/repo.ts`**

```typescript
import { query } from '../db'

export interface ProductInput {
  jan: string | null
  title: string
  brand: string | null
  category: string
  imageUrl: string
}

export interface ListingInput {
  productId: number
  platform: 'amazon' | 'rakuten' | 'yahoo'
  platformId: string
  title: string
  packCount: number
  matchSource: 'jan-exact' | 'title-sim' | 'llm'
  confidence: number | null
}

export interface ListingRow {
  id: number
  product_id: number
  platform: string
  platform_id: string
  pack_count: number
  match_source: string
  confidence: number | null
  is_active: boolean
}

// Insert or update a product. When jan is provided, dedupe on it; otherwise always insert.
export async function upsertProduct(p: ProductInput): Promise<number> {
  if (p.jan) {
    const rows = await query<{ id: number }>(
      `INSERT INTO products (jan, title, brand, category, image_url)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (jan) DO UPDATE SET title=EXCLUDED.title, brand=EXCLUDED.brand,
         image_url=EXCLUDED.image_url, updated_at=now()
       RETURNING id`,
      [p.jan, p.title, p.brand, p.category, p.imageUrl],
    )
    return rows[0].id
  }
  const rows = await query<{ id: number }>(
    `INSERT INTO products (jan, title, brand, category, image_url)
     VALUES (NULL,$1,$2,$3,$4) RETURNING id`,
    [p.title, p.brand, p.category, p.imageUrl],
  )
  return rows[0].id
}

export async function upsertListing(l: ListingInput): Promise<void> {
  await query(
    `INSERT INTO listings (product_id, platform, platform_id, title, pack_count, match_source, confidence, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now())
     ON CONFLICT (platform, platform_id) DO UPDATE SET
       product_id=EXCLUDED.product_id, title=EXCLUDED.title, pack_count=EXCLUDED.pack_count,
       match_source=EXCLUDED.match_source, confidence=EXCLUDED.confidence,
       is_active=true, verified_at=now()`,
    [l.productId, l.platform, l.platformId, l.title, l.packCount, l.matchSource, l.confidence],
  )
}

export async function setHarvestState(productId: number, stage: string, lastError?: string): Promise<void> {
  await query(
    `INSERT INTO harvest_state (product_id, stage, last_error)
     VALUES ($1,$2,$3)
     ON CONFLICT (product_id) DO UPDATE SET stage=EXCLUDED.stage, last_error=EXCLUDED.last_error, updated_at=now()`,
    [productId, stage, lastError ?? null],
  )
}

export async function findListingByPlatformId(platformId: string): Promise<ListingRow | null> {
  const rows = await query<ListingRow>(
    `SELECT * FROM listings WHERE platform_id=$1 AND is_active=true LIMIT 1`, [platformId])
  return rows[0] ?? null
}

// Active sibling listings on the other platform for a product.
export async function findSiblingListings(productId: number, platform: 'amazon' | 'rakuten'): Promise<ListingRow[]> {
  return query<ListingRow>(
    `SELECT * FROM listings WHERE product_id=$1 AND platform=$2 AND is_active=true`, [productId, platform])
}

// Products at a given harvest stage (for stage-to-stage progression).
export async function productsAtStage(stage: string, limit: number): Promise<{ id: number; jan: string | null; title: string }[]> {
  return query(
    `SELECT p.id, p.jan, p.title FROM products p
     JOIN harvest_state h ON h.product_id=p.id WHERE h.stage=$1 LIMIT $2`, [stage, limit])
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --env-file=.env.local node_modules/.bin/jest src/lib/harvest/repo.test.ts`
Expected: PASS (3 tests), test rows cleaned up.

- [ ] **Step 5: Commit**

```bash
git add src/lib/harvest/repo.ts src/lib/harvest/repo.test.ts
git commit -m "feat: harvest repository (upsert product/listing, state, lookups)"
```

---

## Task 5: Stage 1 — enumerate Rakuten by genre

**Files:**
- Modify: `src/lib/platforms/rakuten.ts` (add `searchRakutenGenrePage`)
- Create: `scripts/harvest/01-enumerate-rakuten.ts`
- Create: `scripts/harvest/genres.ts`

- [ ] **Step 1: Add a genre-page fetch helper to `src/lib/platforms/rakuten.ts`**

Append this exported function (it returns RAW items so the harvester can read
`itemCode`, `janCode`, `itemCaption` — fields `parseRakutenItem` drops):

```typescript
export interface RawRakutenItem {
  itemCode: string
  itemName: string
  itemCaption?: string
  itemPrice: number
  shopName?: string
  genreId?: string
  smallImageUrls?: { imageUrl: string }[]
}

// One page (max 30 hits) of a genre listing. Page is 1-based; Rakuten caps page at 100.
export async function searchRakutenGenrePage(genreId: string, page: number): Promise<RawRakutenItem[]> {
  const appId = process.env.RAKUTEN_APP_ID!
  const accessKey = process.env.RAKUTEN_ACCESS_KEY!
  const params = new URLSearchParams({
    applicationId: appId, accessKey, genreId,
    hits: '30', page: String(page), sort: 'standard',
  })
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Referer: 'https://nedankurabe.vercel.app' },
  })
  if (!res.ok) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = JSON.parse(await res.text()) as { Items: Array<{ Item: any }> }
  return (data.Items ?? []).map(({ Item }) => Item as RawRakutenItem)
}
```

- [ ] **Step 2: Create `scripts/harvest/genres.ts`**

```typescript
// Baby-category Rakuten genre IDs to enumerate (mirrors GENRE_MAP in rakuten.ts).
export const BABY_GENRE_IDS: string[] = [
  '205197', // おむつ
  '205194', // おしりふき
  '205208', // 哺乳びん・授乳用品
  '401171', // 粉ミルク
  '568293', // 液体ミルク
  '213980', // 離乳食・ベビーフード
  '207753', // ストローマグ
  '207750', // ベビー食器
  '407002', // スタイ・お食事エプロン
  '200833', // ベビーカー
  '566089', // 抱っこひも・スリング
  '566088', // チャイルドシート
  '551691', // 歯ブラシ・虫歯ケア
  '205205', // ベビーローション・オイル
  '401166', // 日焼け止め
  '201591', // ベビー向けおもちゃ
  '213968', // バウンサー
  '566882', // ベビーチェア
]
```

- [ ] **Step 3: Create `scripts/harvest/01-enumerate-rakuten.ts`**

```typescript
process.env.USE_UNPOOLED = '1'
import { searchRakutenGenrePage, isTrialOrSamplePack, cleanRakutenTitle } from '../../src/lib/platforms/rakuten'
import { extractJans } from '../../src/lib/jan/jan'
import { upsertProduct, upsertListing, setHarvestState } from '../../src/lib/harvest/repo'
import { pool } from '../../src/lib/db'
import { BABY_GENRE_IDS } from './genres'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MAX_PAGE = 20 // 30 hits × 20 = up to 600 items/genre; raise later if needed

async function main() {
  let total = 0, withJan = 0
  for (const genreId of BABY_GENRE_IDS) {
    for (let page = 1; page <= MAX_PAGE; page++) {
      const items = await searchRakutenGenrePage(genreId, page)
      await sleep(1100) // respect 1 req/s
      if (!items.length) break
      for (const it of items) {
        if (isTrialOrSamplePack(it.itemName ?? '')) continue
        const jans = extractJans(`${it.itemName ?? ''} ${it.itemCaption ?? ''}`)
        const jan = jans[0] ?? null
        try {
          const productId = await upsertProduct({
            jan, title: cleanRakutenTitle(it.itemName ?? ''),
            brand: null, category: 'baby',
            imageUrl: it.smallImageUrls?.[0]?.imageUrl ?? '',
          })
          await upsertListing({
            productId, platform: 'rakuten', platformId: it.itemCode,
            title: it.itemName ?? '', packCount: 1,
            matchSource: jan ? 'jan-exact' : 'title-sim', confidence: jan ? 1.0 : null,
          })
          await setHarvestState(productId, 'enumerated')
          total++; if (jan) withJan++
        } catch (e) {
          console.error('[enumerate] error', it.itemCode, (e as Error).message)
        }
      }
      console.log(`[enumerate] genre ${genreId} page ${page}: total=${total} withJan=${withJan}`)
    }
  }
  console.log(`[enumerate] DONE total=${total} withJan=${withJan} (${total ? Math.round(100*withJan/total) : 0}% have JAN)`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Run Stage 1**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/01-enumerate-rakuten.ts`
Expected: per-genre progress logs; final line reports the **% of products that have a JAN** — this is the Risk-1 coverage measurement. If that % is very low (<30%), pause and reconsider before Stage 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/rakuten.ts scripts/harvest/genres.ts scripts/harvest/01-enumerate-rakuten.ts
git commit -m "feat: Stage 1 harvest — enumerate Rakuten baby genres, extract JAN"
```

---

## Task 6: Stage 2 — match Amazon via local Playwright browser

**Files:**
- Create: `scripts/harvest/lib/amazon-browser.ts`
- Create: `scripts/harvest/02-match-amazon.ts`

- [ ] **Step 1: Create `scripts/harvest/lib/amazon-browser.ts`**

```typescript
import { chromium, Browser, Page } from 'playwright'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export class AmazonBrowser {
  private browser!: Browser
  private page!: Page

  async start() {
    this.browser = await chromium.launch({ headless: true })
    const ctx = await this.browser.newContext({ userAgent: UA, locale: 'ja-JP' })
    this.page = await ctx.newPage()
  }
  async stop() { await this.browser?.close() }

  // Returns search-results HTML, or null if a CAPTCHA / robot check is detected.
  async searchHtml(keyword: string): Promise<string | null> {
    const url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(keyword)}&i=baby`
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    const html = await this.page.content()
    if (/api-services-support@amazon\.com|画像に表示されている文字|enter the characters/i.test(html)) {
      return null // CAPTCHA wall
    }
    return html
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const jitter = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))
```

- [ ] **Step 2: Create `scripts/harvest/02-match-amazon.ts`**

This reuses the existing HTML parser by importing `parseAmazonSearchHtml` — first export it.

In `src/lib/crawlers/amazon.ts`, refactor `crawlAmazonSearch` to split parsing out, and export the parser:

```typescript
// Add near crawlAmazonSearch in src/lib/crawlers/amazon.ts
export function parseAmazonSearchHtml(html: string): ProductResult[] {
  const root = parse(html)
  const cards = root.querySelectorAll('[data-asin][data-component-type="s-search-result"]')
  const results: ProductResult[] = []
  for (const card of cards.slice(0, 10)) {
    const asin = card.getAttribute('data-asin') ?? ''
    if (!asin) continue
    const title = card.querySelector('h2 a span, h2 span')?.text.trim() ?? ''
    if (!title) continue
    const priceText = card.querySelector('.a-price-whole')?.text ?? '0'
    const salePrice = parsePrice(priceText)
    if (!salePrice) continue
    const pointText = card.querySelectorAll('.a-size-base.a-color-price').map(el => el.text).join(' ')
    const pointsEarned = parsePoints(pointText)
    const imageUrl = card.querySelector('img.s-image')?.getAttribute('src') ?? ''
    const descText = card.querySelectorAll('.a-size-base-plus, .a-size-base.a-color-secondary')
      .map(el => el.text.trim()).filter(t => t.length > 3 && t.length < 120).join(' ')
    const description = descText.slice(0, 200) || undefined
    results.push({ ...buildResult(title, salePrice, pointsEarned, asin, imageUrl), description })
  }
  return results
}
```

Then have `crawlAmazonSearch` call `parseAmazonSearchHtml(html)` to stay DRY.

Now the Stage 2 script:

```typescript
process.env.USE_UNPOOLED = '1'
import { AmazonBrowser, sleep, jitter } from './lib/amazon-browser'
import { parseAmazonSearchHtml } from '../../src/lib/crawlers/amazon'
import { rankBySimilarity } from '../../src/lib/matching/rank'
import { semanticMatch } from '../../src/lib/llm/openrouter'
import { parsePackCount } from '../../src/lib/jan/pack-count'
import { upsertListing, setHarvestState, productsAtStage, findSiblingListings } from '../../src/lib/harvest/repo'
import { query, pool } from '../../src/lib/db'
import type { ProductResult } from '../../src/lib/types'

// Build a minimal ProductResult from a Rakuten listing row to feed semanticMatch as the "source".
async function rakutenSourceFor(productId: number): Promise<ProductResult | null> {
  const rows = await query<{ title: string; salePrice: number }>(
    `SELECT title, 0 AS "salePrice" FROM listings WHERE product_id=$1 AND platform='rakuten' AND is_active=true LIMIT 1`,
    [productId])
  if (!rows[0]) return null
  return { platform: 'rakuten', title: rows[0].title, imageUrl: '', shopName: '', salePrice: rows[0].salePrice,
    shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 0,
    subscribeAvailable: false, rakutenCardEligible: true, teikiRates: null, taxRate: 1.1, affiliateUrl: '' }
}

async function main() {
  const batch = await productsAtStage('enumerated', 100000)
  const browser = new AmazonBrowser()
  await browser.start()
  let matched = 0, noMatch = 0, captchaPauses = 0
  for (const p of batch) {
    const keyword = p.jan ?? p.title
    try {
      let html = await browser.searchHtml(keyword)
      if (html === null) {
        captchaPauses++
        console.warn(`[amazon] CAPTCHA — pausing 45min (pause #${captchaPauses})`)
        await sleep(45 * 60 * 1000)
        html = await browser.searchHtml(keyword)
        if (html === null) { await setHarvestState(p.id, 'error', 'captcha'); continue }
      }
      const candidates = parseAmazonSearchHtml(html)
      await sleep(jitter(8000, 15000))
      if (!candidates.length) { await setHarvestState(p.id, 'no_match'); noMatch++; continue }

      const source = await rakutenSourceFor(p.id)
      let chosen: ProductResult[] = []
      if (candidates.length === 1) {
        chosen = candidates
      } else if (source) {
        const ranked = rankBySimilarity(source, candidates)
        const idx = await semanticMatch(source, ranked).catch(() => null)
        if (idx !== null && ranked[idx]) chosen = [ranked[idx]]
      }
      if (!chosen.length) { await setHarvestState(p.id, 'no_match'); noMatch++; continue }

      for (const c of chosen) {
        const asin = c.affiliateUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? c.affiliateUrl.match(/([A-Z0-9]{10})/)?.[1]
        if (!asin) continue
        await upsertListing({
          productId: p.id, platform: 'amazon', platformId: asin, title: c.title,
          packCount: parsePackCount(c.title),
          matchSource: candidates.length === 1 ? 'title-sim' : 'llm',
          confidence: candidates.length === 1 ? 0.7 : 0.85,
        })
      }
      await setHarvestState(p.id, 'amazon_done'); matched++
      console.log(`[amazon] ${matched} matched / ${noMatch} no_match (id=${p.id})`)
    } catch (e) {
      await setHarvestState(p.id, 'error', (e as Error).message)
    }
  }
  await browser.stop()
  console.log(`[amazon] DONE matched=${matched} no_match=${noMatch} captchaPauses=${captchaPauses}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Smoke-test on a 100-product slice (the cost/CAPTCHA probe)**

Temporarily change `productsAtStage('enumerated', 100000)` → `100`, run:
`node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/02-match-amazon.ts`
Expected: progress logs; observe CAPTCHA frequency and match rate. Then restore the limit.

- [ ] **Step 4: Commit**

```bash
git add src/lib/crawlers/amazon.ts scripts/harvest/lib/amazon-browser.ts scripts/harvest/02-match-amazon.ts
git commit -m "feat: Stage 2 harvest — match Amazon via local Playwright + LLM judge"
```

- [ ] **Step 5: Run the full Stage 2 (long-running)**

Run with sleep prevention:
`caffeinate -i node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/02-match-amazon.ts`
Expected: runs ~1–2 days; resumable (re-running picks up remaining `enumerated` rows). Best run over an isolated IP (4G tether / JP VPS).

---

## Task 7: Stage 3 — coverage report + CSV sample

**Files:**
- Create: `scripts/harvest/03-report.ts`

- [ ] **Step 1: Create `scripts/harvest/03-report.ts`**

```typescript
process.env.USE_UNPOOLED = '1'
import { writeFileSync } from 'fs'
import { query, pool } from '../../src/lib/db'

async function main() {
  const [counts] = await query<{ total: number; with_jan: number; amazon_matched: number; no_match: number }>(
    `SELECT
       (SELECT count(*) FROM products WHERE category='baby') AS total,
       (SELECT count(*) FROM products WHERE category='baby' AND jan IS NOT NULL) AS with_jan,
       (SELECT count(DISTINCT product_id) FROM listings WHERE platform='amazon' AND is_active=true) AS amazon_matched,
       (SELECT count(*) FROM harvest_state WHERE stage='no_match') AS no_match`)
  console.log('[report] coverage:', counts)

  const bySource = await query(`SELECT match_source, count(*) FROM listings GROUP BY match_source ORDER BY 2 DESC`)
  console.log('[report] match_source:', bySource)

  // Random sample of matched pairs (Rakuten + Amazon for the same product) for manual eye-check.
  const sample = await query<{ jan: string | null; rakuten_title: string; amazon_title: string }>(
    `SELECT p.jan,
       (SELECT title FROM listings WHERE product_id=p.id AND platform='rakuten' LIMIT 1) AS rakuten_title,
       (SELECT title FROM listings WHERE product_id=p.id AND platform='amazon' LIMIT 1) AS amazon_title
     FROM products p
     WHERE EXISTS (SELECT 1 FROM listings WHERE product_id=p.id AND platform='amazon')
       AND EXISTS (SELECT 1 FROM listings WHERE product_id=p.id AND platform='rakuten')
     ORDER BY random() LIMIT 50`)
  const csv = ['jan,rakuten_title,amazon_title',
    ...sample.map(r => `"${r.jan ?? ''}","${(r.rakuten_title ?? '').replace(/"/g, '""')}","${(r.amazon_title ?? '').replace(/"/g, '""')}"`)
  ].join('\n')
  writeFileSync('harvest-sample.csv', csv)
  console.log('[report] wrote harvest-sample.csv (50 pairs) — eyeball before enabling fast path')
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the report**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/03-report.ts`
Expected: coverage numbers; `harvest-sample.csv` written. **Acceptance gate:** ≥60% of JAN-bearing products matched to Amazon, and manual review of the 50-pair CSV shows ≥95% correct.

- [ ] **Step 3: Commit**

```bash
git add scripts/harvest/03-report.ts
git commit -m "feat: Stage 3 harvest — coverage report and sample CSV"
```

---

## Task 8: Production read-path integration (TDD)

**Files:**
- Modify: `src/lib/matching/find-equivalent.ts`
- Test: `src/lib/matching/find-equivalent.table.test.ts`

- [ ] **Step 1: Write the failing test (mock the repo)**

```typescript
// src/lib/matching/find-equivalent.table.test.ts
import { findEquivalent } from './find-equivalent'
import type { ProductResult } from '@/lib/types'

jest.mock('@/lib/harvest/repo', () => ({
  findListingByPlatformId: jest.fn(),
  findSiblingListings: jest.fn(),
}))
jest.mock('@/lib/platforms/rakuten', () => ({ lookupRakuten: jest.fn() }))
import { findListingByPlatformId, findSiblingListings } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'

const src: ProductResult = {
  platform: 'amazon', title: 'Pampers M', imageUrl: '', shopName: '', salePrice: 1000,
  shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 0, effectivePrice: 1000,
  subscribeAvailable: false, rakutenCardEligible: false, teikiRates: null, taxRate: 1.1,
  affiliateUrl: 'https://www.amazon.co.jp/dp/B0ABC12345',
}

it('returns the table sibling without calling the LLM when source ASIN is known', async () => {
  ;(findListingByPlatformId as jest.Mock).mockResolvedValue({ id: 1, product_id: 42, platform: 'amazon' })
  ;(findSiblingListings as jest.Mock).mockResolvedValue([{ platform_id: 'shop:999', product_id: 42 }])
  ;(lookupRakuten as jest.Mock).mockResolvedValue({ ...src, platform: 'rakuten', affiliateUrl: 'r' })

  const result = await findEquivalent(src, 'rakuten')
  expect(result?.platform).toBe('rakuten')
  expect(findSiblingListings).toHaveBeenCalledWith(42, 'rakuten')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/matching/find-equivalent.table.test.ts`
Expected: FAIL — fast path not implemented; LLM path is taken.

- [ ] **Step 3: Add the fast path + write-back to `find-equivalent.ts`**

Add imports at top:

```typescript
import { findListingByPlatformId, findSiblingListings, upsertProduct, upsertListing } from '@/lib/harvest/repo'
import { lookupRakuten } from '@/lib/platforms/rakuten'
```

(`crawlAmazonProduct` is imported lazily inside `hydrateListing` to avoid a circular import.)

Extract the source platform id, then branch at the top of `findEquivalent` (before `searchTargeted`):

```typescript
  // --- Fast path: matching table lookup by source platform_id ---
  const srcId = sourcePlatformId(source)
  if (srcId) {
    const row = await findListingByPlatformId(srcId).catch(() => null)
    if (row) {
      const siblings = await findSiblingListings(row.product_id, targetPlatform).catch(() => [])
      for (const sib of siblings) {
        const hydrated = await hydrateListing(sib.platform_id, targetPlatform).catch(() => null)
        if (hydrated) return hydrated
      }
    }
  }
  // --- (existing LLM flow follows) ---
```

At the end, before `return`, write back a confirmed LLM match:

```typescript
  const matchResult = idx !== null ? ranked[idx] ?? null : null
  if (matchResult && srcId) {
    await writeBack(source, srcId, matchResult).catch(() => {})
  }
  return matchResult
```

Add helpers in the same file:

```typescript
function sourcePlatformId(p: ProductResult): string | null {
  if (p.platform === 'amazon') return p.affiliateUrl.match(/\/dp\/([A-Z0-9]{10})/)?.[1] ?? null
  // Rakuten affiliate URLs wrap the item URL; itemCode is "shop:itemId"
  const m = decodeURIComponent(p.affiliateUrl).match(/item\.rakuten\.co\.jp\/([^/]+)\/([^/?]+)/)
  return m ? `${m[1]}:${m[2]}` : null
}

async function hydrateListing(platformId: string, platform: 'amazon' | 'rakuten'): Promise<ProductResult | null> {
  if (platform === 'rakuten') return lookupRakuten(platformId)
  // amazon: platformId is an ASIN
  const { crawlAmazonProduct } = await import('@/lib/crawlers/amazon')
  return crawlAmazonProduct(platformId)
}

async function writeBack(source: ProductResult, srcId: string, match: ProductResult): Promise<void> {
  const productId = await upsertProduct({
    jan: null, title: source.title, brand: null, category: 'baby', imageUrl: source.imageUrl,
  })
  const matchId = sourcePlatformId(match)
  await upsertListing({ productId, platform: source.platform, platformId: srcId, title: source.title,
    packCount: 1, matchSource: 'llm', confidence: 0.8 })
  if (matchId) {
    await upsertListing({ productId, platform: match.platform, platformId: matchId, title: match.title,
      packCount: 1, matchSource: 'llm', confidence: 0.8 })
  }
}
```

(Note: `idx`/`ranked` already exist in the function; keep the existing computation and reuse them for the return + write-back.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/matching/find-equivalent.table.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `npx jest`
Expected: all green (existing tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/lib/matching/find-equivalent.ts src/lib/matching/find-equivalent.table.test.ts
git commit -m "feat: matching-table fast path + LLM write-back in find-equivalent"
```

---

## Task 9: Refresh mode (maintenance)

**Files:**
- Modify: `scripts/harvest/02-match-amazon.ts` (accept `--refresh`)

- [ ] **Step 1: Add a `--refresh` branch**

At the top of `main()` in `02-match-amazon.ts`, select rows differently when refreshing:

```typescript
  const refresh = process.argv.includes('--refresh')
  const batch = refresh
    ? await query<{ id: number; jan: string | null; title: string }>(
        `SELECT p.id, p.jan, p.title FROM products p
         JOIN listings l ON l.product_id=p.id AND l.platform='amazon'
         WHERE l.verified_at < now() - interval '7 days'
         ORDER BY l.verified_at ASC LIMIT 2000`)
    : await productsAtStage('enumerated', 100000)
```

- [ ] **Step 2: Verify it compiles and dry-runs**

Run: `node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/02-match-amazon.ts --refresh`
Expected: processes only stale Amazon listings (likely none immediately after a fresh harvest — prints DONE with 0).

- [ ] **Step 3: Commit**

```bash
git add scripts/harvest/02-match-amazon.ts
git commit -m "feat: --refresh mode to re-verify stale Amazon listings"
```

---

## Done criteria

- `npx jest` green (db, jan, pack-count, repo, find-equivalent table path).
- Stage 1 reports JAN coverage; Stage 2 completes (resumable); Stage 3 acceptance gate met
  (≥60% Amazon match on JAN-bearing products; ≥95% correct in the 50-pair CSV).
- Production lookups for harvested products skip the LLM (verify via logs / timing) and
  unknown products still work via the LLM path, writing back into the table.
