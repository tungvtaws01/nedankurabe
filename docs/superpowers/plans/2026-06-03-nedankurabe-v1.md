# ねだんくらべ v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Japanese-language price comparison web app that finds the cheapest effective price for baby products across Amazon Japan and Rakuten Ichiba, with client-side toggle-driven recalculation.

**Architecture:** Next.js 14 monolith on Vercel. API Routes handle server-side platform calls (keeping API keys secret) and LLM matching. Client React handles toggle-driven price recalculation without API round-trips. Vercel KV caches results for 30 minutes.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, `@anthropic-ai/sdk` (claude-haiku-4-5-20251001), `@vercel/kv`, Amazon PA-API 5.0 (raw HTTP + AWS Signature V4), Rakuten Ichiba Item Search API (REST)

---

## File Map

```
src/
  app/
    layout.tsx                    # Root layout — Noto Sans JP + Dela Gothic One fonts, CSS vars
    globals.css                   # Tailwind base + design system CSS variables
    page.tsx                      # Home page — search input + popular tags
    results/
      page.tsx                    # Results page — fetches, renders cards + toggles
    api/
      search/route.ts             # POST /api/search  (keyword → both platforms)
      lookup/route.ts             # POST /api/lookup  (URL → source + cross-platform)
  lib/
    types.ts                      # ProductResult, UserToggles, SearchResponse, DEFAULT_TOGGLES
    price/
      normalize.ts                # Pure price formula functions (no I/O)
      normalize.test.ts
    platforms/
      amazon.ts                   # Amazon PA-API 5.0: searchAmazon, lookupAmazon, parseAmazonItem
      amazon.test.ts
      rakuten.ts                  # Rakuten Ichiba API: searchRakuten, lookupRakuten, parseRakutenItem
      rakuten.test.ts
    matching/
      llm-match.ts                # Claude Haiku semantic matching: findBestMatch
      llm-match.test.ts
    cache.ts                      # Vercel KV wrapper: makeCacheKey, getCached, setCached
    cache.test.ts
  components/
    SearchBox.tsx                 # Keyword input + URL paste detection + popular tags
    ProductCard.tsx               # Single result card: price, breakdown, buy button
    PriceBreakdown.tsx            # Itemised price table rows
    TogglePanel.tsx               # All 5 user toggles; calls onChange on every change
```

---

### Task 1: Project Bootstrap

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `.env.local.example`
- Create: `jest.config.ts`
- Create: `src/app/layout.tsx`, `src/app/globals.css`

- [ ] **Step 1: Scaffold Next.js**

```bash
cd /Users/tungvu/work/saas/product-matching
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*" --no-eslint --yes
```

Expected: `package.json`, `tsconfig.json`, `src/app/` created.

- [ ] **Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk @vercel/kv
npm install -D jest @types/jest ts-jest jest-environment-node @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 3: Configure Jest**

Create `jest.config.ts`:

```ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
}

export default config
```

Add to `package.json` scripts:

```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 4: Create `.env.local.example`**

```bash
cat > .env.local.example << 'EOF'
# Amazon PA-API 5.0
AMAZON_ACCESS_KEY=
AMAZON_SECRET_KEY=
AMAZON_PARTNER_TAG=        # Your Amazon Associates tag (e.g. yoursite-22)

# Rakuten Ichiba API
RAKUTEN_APP_ID=
RAKUTEN_AFFILIATE_ID=      # Your Rakuten Affiliate ID

# Anthropic (Claude Haiku for product matching)
ANTHROPIC_API_KEY=

# Vercel KV — auto-populated on Vercel; fill manually for local dev
KV_REST_API_URL=
KV_REST_API_TOKEN=
EOF
```

- [ ] **Step 5: Set up root layout with fonts**

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import './globals.css'

const noto = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto',
})

export const metadata: Metadata = {
  title: 'ねだんくらべ — Amazon・楽天 最安値比較',
  description: 'Amazon と楽天市場の最安値を実質価格で比較します。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${noto.variable} font-sans antialiased`}>{children}</body>
    </html>
  )
}
```

`src/app/globals.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --cream: #F7F4EF;
  --ink: #1A1A1A;
  --ink-mid: #4A4A4A;
  --ink-soft: #8A8A8A;
  --red: #D0021B;
  --win-bg: #FFFBF0;
  --win-border: #E8C840;
  --amazon: #232F3E;
  --amazon-accent: #FF9900;
  --border: #E5E0D8;
}

body {
  background: var(--cream);
  color: var(--ink);
}
```

- [ ] **Step 6: Verify dev server starts**

```bash
npm run dev
```

Expected: server at http://localhost:3000 with no errors.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: bootstrap Next.js project with fonts, Tailwind, and Jest"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
// src/lib/types.ts

export type Platform = 'amazon' | 'rakuten'

export interface ProductResult {
  platform: Platform
  title: string
  imageUrl: string
  shopName: string
  salePrice: number            // displayed price, tax included (yen)
  shippingCost: number         // 送料; 0 if free shipping
  couponDiscount: number       // yen; 0 if no coupon
  pointRate: number            // Rakuten: API pointRate (e.g. 30 = SuperDEAL 30%); Amazon: always 1
  pointsEarned: number         // pre-calculated at SPU=1x, no toggles active
  effectivePrice: number       // pre-calculated at all defaults; recalculated client-side on toggle change
  subscribeAvailable: boolean  // Amazon: Subscribe & Save eligible; Rakuten: 定期購入 eligible
  rakutenCardEligible: boolean // Rakuten Card bonus applies (true for virtually all Rakuten items)
  teikiRates: { first: number; recurring: number } | null  // Rakuten only
  affiliateUrl: string
}

export interface UserToggles {
  amazonSubscribeSave: boolean
  amazonPrimeBulk: boolean
  rakutenSPU: 1 | 3 | 5 | 10
  rakutenCard: boolean
  rakutenTeiki: 'off' | 'first' | 'recurring'
}

export const DEFAULT_TOGGLES: UserToggles = {
  amazonSubscribeSave: false,
  amazonPrimeBulk: false,
  rakutenSPU: 1,
  rakutenCard: false,
  rakutenTeiki: 'off',
}

export interface SearchResponse {
  results: ProductResult[]
  query: string
  cached: boolean
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/types.ts && git commit -m "feat: shared TypeScript types"
```

---

### Task 3: Price Normalizer

**Files:**
- Create: `src/lib/price/normalize.ts`
- Create: `src/lib/price/normalize.test.ts`

Pure logic — no I/O. Strict TDD.

- [ ] **Step 1: Write failing tests**

`src/lib/price/normalize.test.ts`:

```ts
import { calcAmazonEffectivePrice, calcRakutenEffectivePrice, recalcWithToggles } from './normalize'
import { DEFAULT_TOGGLES, ProductResult } from '@/lib/types'

describe('calcAmazonEffectivePrice', () => {
  it('deducts 1% points from sale price (rounded)', () => {
    // round(1791 × 0.01) = 18; 1791 - 0 - 0 - 18 = 1773
    expect(calcAmazonEffectivePrice(1791, 0, false, false)).toBe(1773)
  })

  it('deducts coupon discount', () => {
    // 1791 - 100 - 0 - 18 = 1673
    expect(calcAmazonEffectivePrice(1791, 100, false, false)).toBe(1673)
  })

  it('Subscribe & Save deducts 5% of sale price', () => {
    // subscribeDiscount = round(6780 × 0.05) = 339
    // points = round(6780 × 0.01) = 68
    // 6780 - 0 - 339 - 68 = 6373
    expect(calcAmazonEffectivePrice(6780, 0, true, false)).toBe(6373)
  })

  it('Prime bulk raises point rate to 3%', () => {
    // points = round(6780 × 0.03) = 203
    // 6780 - 0 - 0 - 203 = 6577
    expect(calcAmazonEffectivePrice(6780, 0, false, true)).toBe(6577)
  })

  it('Subscribe & Save and Prime bulk both apply', () => {
    // subscribeDiscount = 339, points = round(6780 × 0.03) = 203
    // 6780 - 0 - 339 - 203 = 6238
    expect(calcAmazonEffectivePrice(6780, 0, true, true)).toBe(6238)
  })
})

describe('calcRakutenEffectivePrice', () => {
  it('base 1% on tax-excluded price, free shipping', () => {
    // taxExcluded = floor(3980 / 1.1) = 3618
    // points = floor(3618 × 1 / 100) = 36
    // 3980 - 0 - 0 - 0 - 36 = 3944
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 1, false, 'off', null)).toBe(3944)
  })

  it('SuperDEAL 30%: floor(taxExcluded × 30 / 100)', () => {
    // taxExcluded = floor(3980 / 1.1) = 3618
    // points = floor(3618 × 30 / 100) = 1085
    // 3980 - 0 - 0 - 0 - 1085 = 2895
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'off', null)).toBe(2895)
  })

  it('shipping cost is added to effective price', () => {
    // 3980 + 490 - 0 - 0 - 36 = 4434
    expect(calcRakutenEffectivePrice(3980, 490, 0, 1, 1, false, 'off', null)).toBe(4434)
  })

  it('Rakuten Card adds +2 to point rate', () => {
    // effectivePointRate = 1 + (1-1) + 2 = 3
    // points = floor(3618 × 3 / 100) = 108
    // 3980 - 0 - 0 - 0 - 108 = 3872
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 1, true, 'off', null)).toBe(3872)
  })

  it('SPU 5x adds +4 to point rate', () => {
    // effectivePointRate = 1 + (5-1) + 0 = 5
    // points = floor(3618 × 5 / 100) = 180
    // 3980 - 180 = 3800
    expect(calcRakutenEffectivePrice(3980, 0, 0, 1, 5, false, 'off', null)).toBe(3800)
  })

  it('teiki first: 10% off, points suppressed to 0', () => {
    // subscriptionDiscount = round(3980 × 0.10) = 398
    // points = 0 (teiki suppresses points)
    // 3980 - 398 - 0 - 0 - 0 = 3582
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'first', { first: 0.10, recurring: 0.05 })).toBe(3582)
  })

  it('teiki first with Rakuten Card: card bonus still suppressed', () => {
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, true, 'first', { first: 0.10, recurring: 0.05 })).toBe(3582)
  })

  it('teiki recurring: 5% off, points suppressed', () => {
    // subscriptionDiscount = round(3980 × 0.05) = 199; 3980 - 199 = 3781
    expect(calcRakutenEffectivePrice(3980, 0, 0, 30, 1, false, 'recurring', { first: 0.10, recurring: 0.05 })).toBe(3781)
  })
})

describe('recalcWithToggles', () => {
  const base: Omit<ProductResult, 'platform' | 'salePrice' | 'effectivePrice' | 'pointRate' | 'pointsEarned'> = {
    title: 'Test', imageUrl: '', shopName: 'Shop',
    shippingCost: 0, couponDiscount: 0,
    subscribeAvailable: true, rakutenCardEligible: true, teikiRates: { first: 0.10, recurring: 0.05 },
    affiliateUrl: '',
  }

  const amazon: ProductResult = { ...base, platform: 'amazon', salePrice: 6780, pointRate: 1, pointsEarned: 68, effectivePrice: 6712 }
  const rakuten: ProductResult = { ...base, platform: 'rakuten', salePrice: 3980, pointRate: 30, pointsEarned: 1085, effectivePrice: 2895 }

  it('sorts by recalculated effectivePrice ascending', () => {
    const ranked = recalcWithToggles([amazon, rakuten], DEFAULT_TOGGLES)
    expect(ranked[0].platform).toBe('rakuten')
    expect(ranked[1].platform).toBe('amazon')
  })

  it('Subscribe & Save reduces Amazon effective price', () => {
    const ranked = recalcWithToggles([amazon, rakuten], { ...DEFAULT_TOGGLES, amazonSubscribeSave: true })
    // Amazon: 6780 - 339 - 203(1%) = 6373; still higher than Rakuten 2895
    expect(ranked[0].platform).toBe('rakuten')
    expect(ranked[1].effectivePrice).toBe(6373)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest src/lib/price/normalize.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './normalize'`

- [ ] **Step 3: Implement normalizer**

`src/lib/price/normalize.ts`:

```ts
import { ProductResult, UserToggles } from '@/lib/types'

export function calcAmazonEffectivePrice(
  salePrice: number,
  couponDiscount: number,
  subscribeSave: boolean,
  primeBulk: boolean,
): number {
  const subscribeDiscount = subscribeSave ? Math.round(salePrice * 0.05) : 0
  const primePointRate = primeBulk ? 3 : 1
  const points = Math.round(salePrice * primePointRate / 100)
  return salePrice - couponDiscount - subscribeDiscount - points
}

export function calcRakutenEffectivePrice(
  itemPrice: number,
  shippingCost: number,
  couponDiscount: number,
  pointRate: number,
  spuMultiplier: 1 | 3 | 5 | 10,
  rakutenCard: boolean,
  teiki: 'off' | 'first' | 'recurring',
  teikiRates: { first: number; recurring: number } | null,
): number {
  const teikiRate =
    teiki === 'first' ? (teikiRates?.first ?? 0.10) :
    teiki === 'recurring' ? (teikiRates?.recurring ?? 0.05) : 0
  const subscriptionDiscount = teiki !== 'off' ? Math.round(itemPrice * teikiRate) : 0
  const taxExcludedPrice = Math.floor((itemPrice - subscriptionDiscount) / 1.1)
  const cardBonus = rakutenCard ? 2 : 0
  const effectivePointRate = teiki !== 'off' ? 0 : pointRate + (spuMultiplier - 1) + cardBonus
  const pointsEarned = Math.floor(taxExcludedPrice * effectivePointRate / 100)
  return itemPrice - subscriptionDiscount - shippingCost - couponDiscount - pointsEarned
}

export function recalcWithToggles(results: ProductResult[], toggles: UserToggles): ProductResult[] {
  return results
    .map(r => {
      const effectivePrice =
        r.platform === 'amazon'
          ? calcAmazonEffectivePrice(
              r.salePrice,
              r.couponDiscount,
              toggles.amazonSubscribeSave && r.subscribeAvailable,
              toggles.amazonPrimeBulk,
            )
          : calcRakutenEffectivePrice(
              r.salePrice,
              r.shippingCost,
              r.couponDiscount,
              r.pointRate,
              toggles.rakutenSPU,
              toggles.rakutenCard && r.rakutenCardEligible,
              r.subscribeAvailable ? toggles.rakutenTeiki : 'off',
              r.teikiRates,
            )
      return { ...r, effectivePrice }
    })
    .sort((a, b) => a.effectivePrice - b.effectivePrice)
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx jest src/lib/price/normalize.test.ts --no-coverage
```

Expected: PASS — all 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/price/ && git commit -m "feat: price normalizer with Amazon + Rakuten formulas and toggle support"
```

---

### Task 4: Cache Layer

**Files:**
- Create: `src/lib/cache.ts`
- Create: `src/lib/cache.test.ts`

- [ ] **Step 1: Write failing tests**

`src/lib/cache.test.ts`:

```ts
import { makeCacheKey, getCached, setCached } from './cache'

jest.mock('@vercel/kv', () => ({
  kv: { get: jest.fn(), set: jest.fn() },
}))
import { kv } from '@vercel/kv'

describe('makeCacheKey', () => {
  it('returns 64-char hex for any input', () => {
    expect(makeCacheKey('パンパース')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('normalises to same key for same input regardless of case/whitespace', () => {
    expect(makeCacheKey('Pampers  S')).toBe(makeCacheKey('pampers s'))
  })

  it('different inputs produce different keys', () => {
    expect(makeCacheKey('pampers')).not.toBe(makeCacheKey('merries'))
  })
})

describe('getCached', () => {
  it('returns parsed value when present', async () => {
    const data = [{ platform: 'amazon' }];
    (kv.get as jest.Mock).mockResolvedValueOnce(JSON.stringify(data))
    expect(await getCached('key')).toEqual(data)
  })

  it('returns null when absent', async () => {
    (kv.get as jest.Mock).mockResolvedValueOnce(null)
    expect(await getCached('missing')).toBeNull()
  })
})

describe('setCached', () => {
  it('serialises and sets with 1800s TTL', async () => {
    const data = [{ platform: 'rakuten' }]
    await setCached('key', data)
    expect(kv.set).toHaveBeenCalledWith('key', JSON.stringify(data), { ex: 1800 })
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest src/lib/cache.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './cache'`

- [ ] **Step 3: Implement cache**

`src/lib/cache.ts`:

```ts
import { createHash } from 'crypto'
import { kv } from '@vercel/kv'

const TTL = 1800

export function makeCacheKey(input: string): string {
  const normalized = input.toLowerCase().replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(normalized).digest('hex')
}

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await kv.get<string>(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function setCached<T>(key: string, value: T): Promise<void> {
  await kv.set(key, JSON.stringify(value), { ex: TTL })
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx jest src/lib/cache.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/cache.test.ts && git commit -m "feat: Vercel KV cache layer with sha256 key normalisation"
```

---

### Task 5: Amazon PA-API Adapter

**Files:**
- Create: `src/lib/platforms/amazon.ts`
- Create: `src/lib/platforms/amazon.test.ts`

Amazon PA-API 5.0 uses AWS Signature V4 (HMAC-SHA256).

- [ ] **Step 1: Write failing tests**

`src/lib/platforms/amazon.test.ts`:

```ts
import { parseAmazonItem } from './amazon'

const MOCK_ITEM = {
  ASIN: 'B0CCJ3KBN3',
  ItemInfo: { Title: { DisplayValue: 'パンパース テープ S 54枚' } },
  Images: { Primary: { Medium: { URL: 'https://example.com/img.jpg' } } },
  Offers: {
    Listings: [{
      Price: { Amount: 1791 },
      DeliveryInfo: { IsFreeShippingEligible: true },
      MerchantInfo: { Name: 'Amazon.co.jp' },
      ProgramEligibility: { IsAmazonFulfilled: true },
    }],
  },
}

describe('parseAmazonItem', () => {
  it('extracts platform, title, salePrice', () => {
    const r = parseAmazonItem(MOCK_ITEM, 'mytag-22')
    expect(r.platform).toBe('amazon')
    expect(r.title).toBe('パンパース テープ S 54枚')
    expect(r.salePrice).toBe(1791)
  })

  it('shippingCost is 0 when IsFreeShippingEligible', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').shippingCost).toBe(0)
  })

  it('shippingCost is 490 when not free', () => {
    const item = { ...MOCK_ITEM, Offers: { Listings: [{ ...MOCK_ITEM.Offers.Listings[0], DeliveryInfo: { IsFreeShippingEligible: false } }] } }
    expect(parseAmazonItem(item, 'tag').shippingCost).toBe(490)
  })

  it('pointRate is always 1', () => {
    expect(parseAmazonItem(MOCK_ITEM, 'tag').pointRate).toBe(1)
  })

  it('pointsEarned = round(salePrice × 0.01)', () => {
    // round(1791 × 0.01) = 18
    expect(parseAmazonItem(MOCK_ITEM, 'tag').pointsEarned).toBe(18)
  })

  it('effectivePrice = salePrice - points at defaults', () => {
    // 1791 - 18 = 1773
    expect(parseAmazonItem(MOCK_ITEM, 'tag').effectivePrice).toBe(1773)
  })

  it('affiliateUrl contains ASIN and partner tag', () => {
    const url = parseAmazonItem(MOCK_ITEM, 'mytag-22').affiliateUrl
    expect(url).toContain('B0CCJ3KBN3')
    expect(url).toContain('mytag-22')
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest src/lib/platforms/amazon.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './amazon'`

- [ ] **Step 3: Implement Amazon adapter**

`src/lib/platforms/amazon.ts`:

```ts
import { createHmac, createHash } from 'crypto'
import { ProductResult } from '@/lib/types'
import { calcAmazonEffectivePrice } from '@/lib/price/normalize'

const HOST = 'webservices.amazon.co.jp'
const REGION = 'us-west-2'
const SERVICE = 'ProductAdvertisingAPI'

function sign(key: Buffer, msg: string): Buffer {
  return createHmac('sha256', key).update(msg).digest()
}

function getSigningKey(secret: string, date: string): Buffer {
  return sign(sign(sign(sign(Buffer.from('AWS4' + secret), date), REGION), SERVICE), 'aws4_request')
}

function buildAuthHeaders(path: string, payload: string, target: string): Record<string, string> {
  const accessKey = process.env.AMAZON_ACCESS_KEY!
  const secretKey = process.env.AMAZON_SECRET_KEY!
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = createHash('sha256').update(payload).digest('hex')

  const canonicalHeaders =
    `content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\n` +
    `host:${HOST}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target'
  const canonicalReq = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')

  const credScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope,
    createHash('sha256').update(canonicalReq).digest('hex')].join('\n')

  const sig = createHmac('sha256', getSigningKey(secretKey, dateStamp)).update(stringToSign).digest('hex')

  return {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
  }
}

async function paCall(path: string, target: string, body: object): Promise<unknown> {
  const payload = JSON.stringify(body)
  const headers = buildAuthHeaders(path, payload, target)
  const res = await fetch(`https://${HOST}${path}`, { method: 'POST', headers, body: payload })
  if (!res.ok) throw new Error(`Amazon PA-API ${res.status}: ${await res.text()}`)
  return res.json()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAmazonItem(item: any, partnerTag: string): ProductResult {
  const salePrice: number = item.Offers?.Listings?.[0]?.Price?.Amount ?? 0
  const isFree: boolean = item.Offers?.Listings?.[0]?.DeliveryInfo?.IsFreeShippingEligible ?? true
  const merchantName: string = item.Offers?.Listings?.[0]?.MerchantInfo?.Name ?? 'Amazon.co.jp'
  const isAmazonFulfilled: boolean = item.Offers?.Listings?.[0]?.ProgramEligibility?.IsAmazonFulfilled ?? false
  const asin: string = item.ASIN ?? ''
  const pointsEarned = Math.round(salePrice * 0.01)

  return {
    platform: 'amazon',
    title: item.ItemInfo?.Title?.DisplayValue ?? '',
    imageUrl: item.Images?.Primary?.Medium?.URL ?? '',
    shopName: merchantName,
    salePrice,
    shippingCost: isFree ? 0 : 490,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned,
    effectivePrice: calcAmazonEffectivePrice(salePrice, 0, false, false),
    subscribeAvailable: isAmazonFulfilled,
    rakutenCardEligible: false,
    teikiRates: null,
    affiliateUrl: `https://www.amazon.co.jp/dp/${asin}?tag=${partnerTag}`,
  }
}

const RESOURCES = [
  'Images.Primary.Medium', 'ItemInfo.Title',
  'Offers.Listings.Price', 'Offers.Listings.DeliveryInfo.IsFreeShippingEligible',
  'Offers.Listings.MerchantInfo', 'Offers.Listings.ProgramEligibility.IsAmazonFulfilled',
]

export async function searchAmazon(keyword: string): Promise<ProductResult[]> {
  const tag = process.env.AMAZON_PARTNER_TAG!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await paCall('/paapi5/searchitems', 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems', {
    Keywords: keyword, Resources: RESOURCES, SearchIndex: 'All',
    PartnerTag: tag, PartnerType: 'Associates', Marketplace: 'www.amazon.co.jp',
  }) as any
  return (data.SearchResult?.Items ?? []).slice(0, 5).map((i: unknown) => parseAmazonItem(i, tag))
}

export async function lookupAmazon(asin: string): Promise<ProductResult | null> {
  const tag = process.env.AMAZON_PARTNER_TAG!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await paCall('/paapi5/getitems', 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems', {
    ItemIds: [asin], Resources: RESOURCES,
    PartnerTag: tag, PartnerType: 'Associates', Marketplace: 'www.amazon.co.jp',
  }) as any
  const items = data.ItemsResult?.Items ?? []
  return items.length ? parseAmazonItem(items[0], tag) : null
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx jest src/lib/platforms/amazon.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/amazon.ts src/lib/platforms/amazon.test.ts && git commit -m "feat: Amazon PA-API 5.0 adapter with AWS Signature V4"
```

---

### Task 6: Rakuten Ichiba API Adapter

**Files:**
- Create: `src/lib/platforms/rakuten.ts`
- Create: `src/lib/platforms/rakuten.test.ts`

- [ ] **Step 1: Write failing tests**

`src/lib/platforms/rakuten.test.ts`:

```ts
import { parseRakutenItem } from './rakuten'

const MOCK = {
  itemName: 'パンパース オムツ はじめての肌へのいちばん テープ S 108枚',
  itemPrice: 3980,
  postageFlag: 0,    // 0 = free shipping
  pointRate: 30,
  couponFlag: 0,
  smallImageUrls: [{ imageUrl: 'https://example.com/img.jpg' }],
  shopName: '楽天24 ベビー館',
  itemCode: 'rakuten24:4987176206206',
  itemUrl: 'https://item.rakuten.co.jp/rakuten24/4987176206206/',
}

describe('parseRakutenItem', () => {
  it('extracts platform and title', () => {
    const r = parseRakutenItem(MOCK, 'aff-id')
    expect(r.platform).toBe('rakuten')
    expect(r.title).toBe('パンパース オムツ はじめての肌へのいちばん テープ S 108枚')
  })

  it('shippingCost is 0 when postageFlag=0', () => {
    expect(parseRakutenItem(MOCK, 'id').shippingCost).toBe(0)
  })

  it('shippingCost is 490 when postageFlag=1', () => {
    expect(parseRakutenItem({ ...MOCK, postageFlag: 1 }, 'id').shippingCost).toBe(490)
  })

  it('pointRate matches API field', () => {
    expect(parseRakutenItem(MOCK, 'id').pointRate).toBe(30)
  })

  it('pointsEarned = floor(taxExcluded × pointRate / 100)', () => {
    // floor(3980/1.1)=3618; floor(3618×30/100)=1085
    expect(parseRakutenItem(MOCK, 'id').pointsEarned).toBe(1085)
  })

  it('effectivePrice = salePrice - points at defaults', () => {
    // 3980 - 1085 = 2895
    expect(parseRakutenItem(MOCK, 'id').effectivePrice).toBe(2895)
  })

  it('rakutenCardEligible is true', () => {
    expect(parseRakutenItem(MOCK, 'id').rakutenCardEligible).toBe(true)
  })

  it('affiliateUrl wraps itemUrl with affiliate redirect when affiliateId provided', () => {
    const url = parseRakutenItem(MOCK, 'aff123').affiliateUrl
    expect(url).toContain('aff123')
    expect(url).toContain(encodeURIComponent('https://item.rakuten.co.jp'))
  })

  it('affiliateUrl falls back to itemUrl when no affiliateId', () => {
    const url = parseRakutenItem(MOCK, '').affiliateUrl
    expect(url).toBe(MOCK.itemUrl)
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest src/lib/platforms/rakuten.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './rakuten'`

- [ ] **Step 3: Implement Rakuten adapter**

`src/lib/platforms/rakuten.ts`:

```ts
import { ProductResult } from '@/lib/types'
import { calcRakutenEffectivePrice } from '@/lib/price/normalize'

const SEARCH_URL = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseRakutenItem(item: any, affiliateId: string): ProductResult {
  const price: number = item.itemPrice
  const shippingCost: number = item.postageFlag === 0 ? 0 : 490
  const pointRate: number = item.pointRate ?? 1
  const imageUrl: string = item.smallImageUrls?.[0]?.imageUrl ?? ''
  const itemUrl: string = item.itemUrl ?? ''

  const taxExcludedPrice = Math.floor(price / 1.1)
  const pointsEarned = Math.floor(taxExcludedPrice * pointRate / 100)
  const effectivePrice = calcRakutenEffectivePrice(price, shippingCost, 0, pointRate, 1, false, 'off', null)
  const affiliateUrl = affiliateId
    ? `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
    : itemUrl

  return {
    platform: 'rakuten',
    title: item.itemName ?? '',
    imageUrl,
    shopName: item.shopName ?? '',
    salePrice: price,
    shippingCost,
    couponDiscount: 0,
    pointRate,
    pointsEarned,
    effectivePrice,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    affiliateUrl,
  }
}

export async function searchRakuten(keyword: string): Promise<ProductResult[]> {
  const appId = process.env.RAKUTEN_APP_ID!
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? ''
  const params = new URLSearchParams({ applicationId: appId, keyword, hits: '5', sort: '+itemPrice' })
  const res = await fetch(`${SEARCH_URL}?${params}`)
  if (!res.ok) throw new Error(`Rakuten API ${res.status}`)
  const data = await res.json() as { Items: Array<{ Item: unknown }> }
  return (data.Items ?? []).map(({ Item }) => parseRakutenItem(Item, affiliateId))
}

export async function lookupRakuten(itemCode: string): Promise<ProductResult | null> {
  const appId = process.env.RAKUTEN_APP_ID!
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? ''
  const params = new URLSearchParams({ applicationId: appId, itemCode, hits: '1' })
  const res = await fetch(`${SEARCH_URL}?${params}`)
  if (!res.ok) return null
  const data = await res.json() as { Items: Array<{ Item: unknown }> }
  if (!data.Items?.length) return null
  return parseRakutenItem(data.Items[0].Item, affiliateId)
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx jest src/lib/platforms/rakuten.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platforms/rakuten.ts src/lib/platforms/rakuten.test.ts && git commit -m "feat: Rakuten Ichiba API adapter with point rate parsing"
```

---

### Task 7: LLM Product Matching

**Files:**
- Create: `src/lib/matching/llm-match.ts`
- Create: `src/lib/matching/llm-match.test.ts`

- [ ] **Step 1: Write failing tests**

`src/lib/matching/llm-match.test.ts`:

```ts
jest.mock('@anthropic-ai/sdk')
import Anthropic from '@anthropic-ai/sdk'
import { findBestMatch } from './llm-match'
import { ProductResult } from '@/lib/types'

const base: ProductResult = {
  platform: 'amazon', title: 'パンパース テープ S 82枚', imageUrl: '', shopName: 'Amazon',
  salePrice: 2178, shippingCost: 0, couponDiscount: 0, pointRate: 1, pointsEarned: 22,
  effectivePrice: 2156, subscribeAvailable: false, rakutenCardEligible: false,
  teikiRates: null, affiliateUrl: '',
}

const candidates: ProductResult[] = [
  { ...base, platform: 'rakuten', title: 'パンパース はじめての肌へのいちばん テープ S 82枚', salePrice: 1980, effectivePrice: 1860, affiliateUrl: 'https://r1' },
  { ...base, platform: 'rakuten', title: 'GOO.N テープ S 72枚', salePrice: 1200, effectivePrice: 1100, affiliateUrl: 'https://r2' },
]

function mockCreate(responseText: string) {
  const mockMessages = { create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: responseText }] }) }
  ;(Anthropic as jest.MockedClass<typeof Anthropic>).mockImplementation(() => ({ messages: mockMessages } as unknown as Anthropic))
}

describe('findBestMatch', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns candidate at index returned by Claude', async () => {
    mockCreate(JSON.stringify({ index: 0, confidence: 'high' }))
    const result = await findBestMatch(base, candidates)
    expect(result?.affiliateUrl).toBe('https://r1')
  })

  it('returns null when Claude returns index -1', async () => {
    mockCreate(JSON.stringify({ index: -1, confidence: 'low' }))
    expect(await findBestMatch(base, candidates)).toBeNull()
  })

  it('prefixes title with [似た商品] when confidence is low', async () => {
    mockCreate(JSON.stringify({ index: 0, confidence: 'low' }))
    const result = await findBestMatch(base, candidates)
    expect(result?.title).toMatch(/^似た商品/)
  })

  it('returns null for empty candidates list', async () => {
    expect(await findBestMatch(base, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect failure**

```bash
npx jest src/lib/matching/llm-match.test.ts --no-coverage
```

Expected: FAIL — `Cannot find module './llm-match'`

- [ ] **Step 3: Implement LLM matcher**

`src/lib/matching/llm-match.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { ProductResult } from '@/lib/types'

const SYSTEM = `You are a product matching assistant for a Japanese price comparison service.
Given a source product and numbered candidates from another platform, identify which candidate is the SAME product — same brand, type, size, and quantity.
Respond with JSON only: {"index": <0-based index or -1 if no match>, "confidence": "high" | "low"}
"high" = brand + type + size + quantity all match. "low" = likely same product but some attributes differ.`

export async function findBestMatch(
  source: ProductResult,
  candidates: ProductResult[],
): Promise<ProductResult | null> {
  if (!candidates.length) return null

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const userMsg =
    `Source (${source.platform}): ${source.title} — ¥${source.salePrice}\n\n` +
    `Candidates:\n${candidates.map((c, i) => `[${i}] ${c.title} — ¥${c.salePrice}`).join('\n')}\n\n` +
    `Which index is the same product? -1 if none match.`

  const res = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 64,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  })

  try {
    const text = res.content.find(b => b.type === 'text')?.text ?? ''
    const { index, confidence } = JSON.parse(text) as { index: number; confidence: 'high' | 'low' }
    if (index === -1 || !candidates[index]) return null
    const match = candidates[index]
    return confidence === 'low' ? { ...match, title: `似た商品: ${match.title}` } : match
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run — expect pass**

```bash
npx jest src/lib/matching/llm-match.test.ts --no-coverage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/matching/ && git commit -m "feat: LLM product matching via Claude Haiku"
```

---

### Task 8: API Routes

**Files:**
- Create: `src/app/api/search/route.ts`
- Create: `src/app/api/lookup/route.ts`

- [ ] **Step 1: Implement `/api/search`**

`src/app/api/search/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { searchAmazon } from '@/lib/platforms/amazon'
import { searchRakuten } from '@/lib/platforms/rakuten'
import { findBestMatch } from '@/lib/matching/llm-match'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return NextResponse.json({ error: 'query required' }, { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(query)

  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query, cached: true } satisfies SearchResponse)
  }

  const [amazonItems, rakutenItems] = await Promise.all([
    searchAmazon(query).catch(() => [] as ProductResult[]),
    searchRakuten(query).catch(() => [] as ProductResult[]),
  ])

  const amazonBest = amazonItems[0] ?? null
  const rakutenBest = rakutenItems[0] ?? null
  let results: ProductResult[] = []

  if (amazonBest && rakutenItems.length) {
    const matched = await findBestMatch(amazonBest, rakutenItems).catch(() => rakutenBest)
    results = [amazonBest, matched ?? rakutenBest].sort((a, b) => a.effectivePrice - b.effectivePrice)
  } else if (amazonBest) {
    results = [amazonBest]
  } else if (rakutenBest) {
    results = [rakutenBest]
  }

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query, cached: false } satisfies SearchResponse)
}
```

- [ ] **Step 2: Implement `/api/lookup`**

`src/app/api/lookup/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { lookupAmazon, searchAmazon } from '@/lib/platforms/amazon'
import { lookupRakuten, searchRakuten } from '@/lib/platforms/rakuten'
import { findBestMatch } from '@/lib/matching/llm-match'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult, SearchResponse } from '@/lib/types'

function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/)
      if (m) return { platform: 'rakuten', id: `${m[1]}:${m[2]}` }
    }
  } catch { /* invalid URL */ }
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) {
    return NextResponse.json({ error: 'url required' }, { status: 400 })
  }
  const url = body.url.trim()
  const parsed = parseProductUrl(url)
  if (!parsed) {
    return NextResponse.json({ error: 'Amazon または楽天の商品URLを入力してください。' }, { status: 400 })
  }

  const cacheKey = makeCacheKey(url)
  const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
  if (cached) {
    return NextResponse.json({ results: cached, query: url, cached: true } satisfies SearchResponse)
  }

  let source: ProductResult | null = null
  let crossItems: ProductResult[] = []

  if (parsed.platform === 'amazon') {
    source = await lookupAmazon(parsed.id).catch(() => null)
    if (source) crossItems = await searchRakuten(source.title).catch(() => [])
  } else {
    source = await lookupRakuten(parsed.id).catch(() => null)
    if (source) crossItems = await searchAmazon(source.title).catch(() => [])
  }

  if (!source) {
    return NextResponse.json({ error: '商品が見つかりませんでした。' }, { status: 404 })
  }

  const crossMatch = crossItems.length
    ? await findBestMatch(source, crossItems).catch(() => crossItems[0] ?? null)
    : null

  const results = [source, ...(crossMatch ? [crossMatch] : [])]
    .sort((a, b) => a.effectivePrice - b.effectivePrice)

  await setCached(cacheKey, results).catch(() => {})
  return NextResponse.json({ results, query: url, cached: false } satisfies SearchResponse)
}
```

- [ ] **Step 3: Verify routes respond**

```bash
npm run dev &
sleep 4
curl -s -X POST http://localhost:3000/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":""}' | python3 -m json.tool
```

Expected: `{"error":"query required"}` with status 400.

```bash
curl -s -X POST http://localhost:3000/api/lookup \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.google.com"}' | python3 -m json.tool
```

Expected: `{"error":"Amazon または楽天の商品URLを入力してください。"}` with status 400.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ && git commit -m "feat: /api/search and /api/lookup routes with caching and LLM matching"
```

---

### Task 9: Home Page

**Files:**
- Create: `src/components/SearchBox.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Implement SearchBox**

`src/components/SearchBox.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const POPULAR = ['パンパース テープ', '明治ほほえみ', 'エルゴ抱っこ紐', 'おしりふき', 'ベビーカー']
const URL_RE = /^https?:\/\/(www\.amazon\.co\.jp|item\.rakuten\.co\.jp)/

export default function SearchBox() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function navigate(value: string) {
    const v = value.trim()
    if (!v) return
    setLoading(true)
    if (URL_RE.test(v)) {
      router.push(`/results?url=${encodeURIComponent(v)}`)
    } else {
      router.push(`/results?q=${encodeURIComponent(v)}`)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-[var(--border)]">
        <p className="text-xs text-[var(--ink-soft)] mb-2">
          🔍 商品名で検索 <span className="italic">Search by product name</span>
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && navigate(input)}
            placeholder="例：パンパース テープ Sサイズ"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--cream)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]"
          />
          <button
            onClick={() => navigate(input)}
            disabled={loading || !input.trim()}
            className="bg-[var(--ink)] text-white rounded-xl px-4 py-2.5 text-sm font-bold whitespace-nowrap disabled:opacity-40"
          >
            {loading ? '...' : '最安値を調べる'}
          </button>
        </div>
        <div className="text-center text-xs text-[var(--ink-soft)] my-2">— または / or —</div>
        <div className="border border-dashed border-[var(--border)] rounded-xl p-3 text-center text-xs text-[var(--ink-mid)]">
          🔗 Amazon・楽天の商品URLを貼り付けると自動で比較します
          <span className="block italic text-[10px] text-[var(--ink-soft)] mt-0.5">
            Paste a product URL from Amazon or Rakuten to compare automatically
          </span>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs text-[var(--ink-soft)] mb-2">
          よく検索されています <span className="italic">Popular searches</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map(tag => (
            <button key={tag} onClick={() => navigate(tag)}
              className="bg-white border border-[var(--border)] rounded-full px-3 py-1 text-xs text-[var(--ink-mid)] hover:bg-[var(--cream)]">
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <div className="flex-1 bg-[var(--amazon)] text-[var(--amazon-accent)] rounded-lg py-2 text-center text-xs font-bold">Amazon JP</div>
        <div className="flex-1 bg-[var(--red)] text-white rounded-lg py-2 text-center text-xs font-bold">楽天市場 Rakuten</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement home page**

`src/app/page.tsx`:

```tsx
import SearchBox from '@/components/SearchBox'

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black" style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ねだん<span className="text-[var(--red)]">くらべ</span>
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">Amazon・楽天 最安値かんたん比較</p>
        <p className="text-xs italic text-[var(--ink-soft)] mt-0.5">
          Easy cheapest price comparison across Amazon &amp; Rakuten
        </p>
      </div>
      <SearchBox />
    </main>
  )
}
```

- [ ] **Step 3: Open browser and verify home page**

```bash
npm run dev
```

Open http://localhost:3000 — logo, search field, popular tag buttons, and platform badges should all render.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/components/SearchBox.tsx && git commit -m "feat: home page with search box, popular tags, platform badges"
```

---

### Task 10: Results Page — Components

**Files:**
- Create: `src/components/PriceBreakdown.tsx`
- Create: `src/components/ProductCard.tsx`
- Create: `src/components/TogglePanel.tsx`

- [ ] **Step 1: Implement PriceBreakdown**

`src/components/PriceBreakdown.tsx`:

```tsx
interface Row { labelJP: string; labelEN: string; value: string; negative?: boolean }
interface Props { rows: Row[]; total: number }

export default function PriceBreakdown({ rows, total }: Props) {
  return (
    <div className="bg-white/60 rounded-xl px-3 py-2 text-xs mb-3 space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex justify-between items-baseline">
          <span className="text-[var(--ink-soft)]">
            {row.labelJP} <span className="italic text-[9px]">{row.labelEN}</span>
          </span>
          <span className={`font-semibold ${row.negative ? 'text-[var(--red)]' : 'text-[var(--ink-mid)]'}`}>
            {row.value}
          </span>
        </div>
      ))}
      <div className="flex justify-between items-baseline border-t border-black/10 pt-1">
        <span className="font-bold text-[var(--ink-soft)]">
          実質価格 <span className="italic font-normal text-[9px]">Effective price</span>
        </span>
        <span className="font-bold text-[var(--red)]">¥{total.toLocaleString()}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Implement ProductCard**

`src/components/ProductCard.tsx`:

```tsx
import { ProductResult, UserToggles } from '@/lib/types'
import PriceBreakdown from './PriceBreakdown'

function buildRows(r: ProductResult, t: UserToggles) {
  const rows = [{ labelJP: '定価', labelEN: 'List price', value: `¥${r.salePrice.toLocaleString()}` }]

  if (r.platform === 'amazon') {
    if (t.amazonSubscribeSave && r.subscribeAvailable) {
      const d = Math.round(r.salePrice * 0.05)
      rows.push({ labelJP: '定期おトク便', labelEN: 'Subscribe & Save', value: `－¥${d.toLocaleString()}`, negative: true })
    }
    if (r.couponDiscount > 0) {
      rows.push({ labelJP: 'クーポン', labelEN: 'Coupon', value: `－¥${r.couponDiscount.toLocaleString()}`, negative: true })
    }
    const rate = t.amazonPrimeBulk ? 3 : 1
    const pts = Math.round(r.salePrice * rate / 100)
    rows.push({ labelJP: `Amazonポイント(${rate}%)`, labelEN: 'Amazon Points', value: `－¥${pts.toLocaleString()}`, negative: true })
  } else {
    if (r.shippingCost > 0) {
      rows.push({ labelJP: '送料', labelEN: 'Shipping', value: `＋¥${r.shippingCost.toLocaleString()}` })
    }
    if (r.couponDiscount > 0) {
      rows.push({ labelJP: 'クーポン', labelEN: 'Coupon', value: `－¥${r.couponDiscount.toLocaleString()}`, negative: true })
    }
    const cardBonus = t.rakutenCard ? 2 : 0
    const effectiveRate = r.pointRate + (t.rakutenSPU - 1) + cardBonus
    const pts = Math.floor(Math.floor(r.salePrice / 1.1) * effectiveRate / 100)
    rows.push({ labelJP: `ポイント還元(${effectiveRate}%)`, labelEN: 'Points earned', value: `－¥${pts.toLocaleString()}`, negative: true })
  }
  return rows
}

export default function ProductCard({ result, isWinner, toggles }: { result: ProductResult; isWinner: boolean; toggles: UserToggles }) {
  const isAmazon = result.platform === 'amazon'
  return (
    <div className={`rounded-2xl p-4 mb-3 ${isWinner ? 'bg-[var(--win-bg)] border-2 border-[var(--win-border)]' : 'bg-white border-2 border-[var(--border)]'}`}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {isWinner && (
          <span className="bg-[var(--win-border)] text-yellow-900 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            🏆 最安値 <span className="italic font-normal">Cheapest</span>
          </span>
        )}
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${isAmazon ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]' : 'bg-[var(--red)] text-white'}`}>
          {isAmazon ? 'Amazon' : '楽天 Rakuten'}
        </span>
      </div>

      <p className="text-xs font-bold leading-snug mb-0.5 line-clamp-2">{result.title}</p>
      <p className="text-[10px] text-[var(--ink-soft)] mb-3">{result.shopName}</p>

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-black text-[var(--red)]" style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ¥{result.effectivePrice.toLocaleString()}
        </span>
        <span className="text-[10px] text-[var(--ink-soft)]">実質価格 <span className="italic">Effective price</span></span>
      </div>

      <PriceBreakdown rows={buildRows(result, toggles)} total={result.effectivePrice} />

      <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer"
        className={`block w-full text-center py-3 rounded-xl text-xs font-bold ${isAmazon ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]' : 'bg-[var(--red)] text-white'}`}>
        {isAmazon ? 'Amazonで購入する' : '楽天で購入する'} →
        <span className="italic ml-1 opacity-70 font-normal">{isAmazon ? 'Buy on Amazon' : 'Buy on Rakuten'}</span>
      </a>
    </div>
  )
}
```

- [ ] **Step 3: Implement TogglePanel**

`src/components/TogglePanel.tsx`:

```tsx
'use client'
import { UserToggles } from '@/lib/types'

interface Props {
  toggles: UserToggles
  onChange: (t: UserToggles) => void
  amazonSubscribeAvailable: boolean
  rakutenSubscribeAvailable: boolean
}

export default function TogglePanel({ toggles, onChange, amazonSubscribeAvailable, rakutenSubscribeAvailable }: Props) {
  const set = (patch: Partial<UserToggles>) => onChange({ ...toggles, ...patch })

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-3 mb-4 text-xs space-y-3">
      {/* Amazon toggles */}
      <div>
        <p className="font-bold text-[10px] uppercase tracking-wide text-[var(--ink-soft)] mb-1.5">Amazon</p>
        {amazonSubscribeAvailable && (
          <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
            <input type="checkbox" checked={toggles.amazonSubscribeSave} onChange={e => set({ amazonSubscribeSave: e.target.checked })} className="rounded" />
            <span>定期おトク便 <span className="italic text-[var(--ink-soft)]">Subscribe & Save ~5% off</span></span>
          </label>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={toggles.amazonPrimeBulk} onChange={e => set({ amazonPrimeBulk: e.target.checked })} className="rounded" />
          <span>Primeまとめ買い <span className="italic text-[var(--ink-soft)]">+2% points (5+ items)</span></span>
        </label>
      </div>

      {/* Rakuten toggles */}
      <div>
        <p className="font-bold text-[10px] uppercase tracking-wide text-[var(--ink-soft)] mb-1.5">楽天 Rakuten</p>
        <div className="flex items-center gap-2 mb-1.5">
          <span>ポイント倍率 <span className="italic text-[var(--ink-soft)]">SPU level</span></span>
          <div className="flex gap-1 ml-auto">
            {([1, 3, 5, 10] as const).map(v => (
              <button key={v} onClick={() => set({ rakutenSPU: v })}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${toggles.rakutenSPU === v ? 'bg-[var(--ink)] text-white border-[var(--ink)]' : 'bg-white text-[var(--ink-soft)] border-[var(--border)]'}`}>
                {v}x
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
          <input type="checkbox" checked={toggles.rakutenCard} onChange={e => set({ rakutenCard: e.target.checked })} className="rounded" />
          <span>楽天カードで支払う <span className="italic text-[var(--ink-soft)]">Pay with Rakuten Card (+2%)</span></span>
        </label>
        {rakutenSubscribeAvailable && (
          <div className="flex items-center gap-2">
            <span>定期購入 <span className="italic text-[var(--ink-soft)]">Subscription</span></span>
            <select value={toggles.rakutenTeiki} onChange={e => set({ rakutenTeiki: e.target.value as UserToggles['rakutenTeiki'] })}
              className="ml-auto text-[10px] border border-[var(--border)] rounded px-1 py-0.5 bg-white">
              <option value="off">off</option>
              <option value="first">初回 −10% (first order)</option>
              <option value="recurring">2回目以降 −5% (recurring)</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ && git commit -m "feat: PriceBreakdown, ProductCard, TogglePanel components"
```

---

### Task 11: Results Page Orchestration

**Files:**
- Create: `src/app/results/page.tsx`

- [ ] **Step 1: Implement Results page**

`src/app/results/page.tsx`:

```tsx
'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { ProductResult, UserToggles, DEFAULT_TOGGLES, SearchResponse } from '@/lib/types'
import { recalcWithToggles } from '@/lib/price/normalize'
import ProductCard from '@/components/ProductCard'
import TogglePanel from '@/components/TogglePanel'

function loadToggles(): UserToggles {
  if (typeof window === 'undefined') return DEFAULT_TOGGLES
  try { return JSON.parse(localStorage.getItem('nedankurabe_toggles') ?? 'null') ?? DEFAULT_TOGGLES }
  catch { return DEFAULT_TOGGLES }
}

function ResultsContent() {
  const params = useSearchParams()
  const router = useRouter()
  const query = params.get('q')
  const url = params.get('url')

  const [rawResults, setRawResults] = useState<ProductResult[]>([])
  const [toggles, setToggles] = useState<UserToggles>(DEFAULT_TOGGLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setToggles(loadToggles()) }, [])

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null)
      try {
        const [endpoint, body] = url
          ? ['/api/lookup', { url }]
          : ['/api/search', { query }]
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const data = await res.json() as SearchResponse & { error?: string }
        if (!res.ok) { setError(data.error ?? '検索中にエラーが発生しました。'); return }
        setRawResults(data.results ?? [])
      } catch { setError('検索中にエラーが発生しました。もう一度お試しください。') }
      finally { setLoading(false) }
    }
    if (query || url) load()
  }, [query, url])

  function handleToggles(t: UserToggles) {
    setToggles(t)
    localStorage.setItem('nedankurabe_toggles', JSON.stringify(t))
  }

  const ranked = recalcWithToggles(rawResults, toggles)

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--border)]">
        <button onClick={() => router.push('/')}
          className="w-8 h-8 bg-white border border-[var(--border)] rounded-lg flex items-center justify-center text-sm shrink-0">←</button>
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--ink-soft)]">検索ワード <span className="italic">Search</span></p>
          <p className="text-sm font-bold truncate">{query ?? url}</p>
        </div>
      </div>

      {loading && <p className="text-center py-20 text-sm text-[var(--ink-soft)]">検索中… <span className="italic">Searching...</span></p>}
      {error && <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>}

      {!loading && !error && ranked.length > 0 && (
        <>
          <TogglePanel
            toggles={toggles}
            onChange={handleToggles}
            amazonSubscribeAvailable={rawResults.some(r => r.platform === 'amazon' && r.subscribeAvailable)}
            rakutenSubscribeAvailable={rawResults.some(r => r.platform === 'rakuten' && r.subscribeAvailable)}
          />
          {ranked.map((r, i) => <ProductCard key={r.affiliateUrl} result={r} isWinner={i === 0} toggles={toggles} />)}
          <p className="text-center text-[9px] text-[var(--ink-soft)] mt-4 leading-relaxed">
            ※ 価格・ポイントは取得時点のものです<br />
            <span className="italic">Prices and points are as of retrieval time. Verify on each site before purchasing.</span>
          </p>
        </>
      )}

      {!loading && !error && ranked.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}
    </main>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="text-center py-20 text-sm text-[var(--ink-soft)]">読み込み中…</p>}>
      <ResultsContent />
    </Suspense>
  )
}
```

- [ ] **Step 2: Full smoke test**

```bash
npm run dev
```

1. Open http://localhost:3000 — home page renders.
2. Type a keyword and press Enter — navigates to `/results?q=...`.
3. Toggle panel renders. Clicking SPU buttons changes selection.
4. Back button returns to home.

- [ ] **Step 3: Commit**

```bash
git add src/app/results/ && git commit -m "feat: results page with toggle-driven client-side price recalculation"
```

---

### Task 12: Final Integration and Deploy Config

**Files:**
- Create: `vercel.json`
- Update: `.gitignore`

- [ ] **Step 1: Add Vercel config**

`vercel.json`:

```json
{
  "functions": {
    "src/app/api/search/route.ts": { "maxDuration": 30 },
    "src/app/api/lookup/route.ts": { "maxDuration": 30 }
  }
}
```

- [ ] **Step 2: Ensure secrets are gitignored**

```bash
grep -q '.env.local' .gitignore || echo '.env.local' >> .gitignore
grep -q '.env*.local' .gitignore || echo '.env*.local' >> .gitignore
```

- [ ] **Step 3: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass (price normalizer, cache, Amazon adapter, Rakuten adapter, LLM matcher).

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Production build**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 6: Final commit**

```bash
git add vercel.json .gitignore && git commit -m "feat: Vercel deployment config, gitignore, final build verified"
```

---

## Environment Variable Checklist (before first deploy)

Set these in Vercel Dashboard → Settings → Environment Variables:

| Variable | Where to get it |
|---|---|
| `AMAZON_ACCESS_KEY` | AWS Console → IAM → PA-API credentials |
| `AMAZON_SECRET_KEY` | Same as above |
| `AMAZON_PARTNER_TAG` | Amazon Associates Japan dashboard (e.g. `yoursite-22`) |
| `RAKUTEN_APP_ID` | Rakuten Developer API Management |
| `RAKUTEN_AFFILIATE_ID` | Rakuten Affiliate dashboard |
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `KV_REST_API_URL` | Auto-set by Vercel KV integration |
| `KV_REST_API_TOKEN` | Auto-set by Vercel KV integration |
