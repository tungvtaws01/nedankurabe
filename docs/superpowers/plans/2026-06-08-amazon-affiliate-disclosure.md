# Amazon Affiliate Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bilingual affiliate disclosure footer and a partner-tag guard to satisfy Amazon Associates review requirements.

**Architecture:** Create a single `Footer` component wired into the root layout so the disclosure appears on every page. Add a `console.warn` in `buildAmazonUrl` so untagged links are caught at runtime before they silently ship.

**Tech Stack:** Next.js 14 App Router, React, Tailwind CSS

---

### Task 1: Create the Footer component

**Files:**
- Create: `src/components/Footer.tsx`

- [ ] **Step 1: Create the file with bilingual affiliate disclosure**

```tsx
// src/components/Footer.tsx
export default function Footer() {
  return (
    <footer className="mt-12 border-t border-gray-100 py-6 px-4 text-center text-xs text-gray-400 leading-relaxed">
      <p>
        本サービスはAmazonアソシエイト・プログラムの参加者です。
        適格販売により収入を得ることがあります。
      </p>
      <p className="mt-1">
        As an Amazon Associate, I earn from qualifying purchases.
      </p>
    </footer>
  )
}
```

- [ ] **Step 2: Verify the file exists**

```bash
cat src/components/Footer.tsx
```

Expected: the file contents printed above.

---

### Task 2: Wire Footer into root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Import and add Footer to the layout**

Replace the current `layout.tsx` body with:

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import Footer from '@/components/Footer'
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
      <body className={`${noto.variable} font-sans antialiased`}>
        {children}
        <Footer />
      </body>
    </html>
  )
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/Footer.tsx src/app/layout.tsx
git commit -m "feat: add Amazon Associates affiliate disclosure footer"
```

---

### Task 3: Add partner-tag guard in amazon crawler

**Files:**
- Modify: `src/lib/crawlers/amazon.ts:23-28`

- [ ] **Step 1: Update `buildAmazonUrl` to warn when tag is missing**

Replace the existing `buildAmazonUrl` function (lines 23–28):

```ts
function buildAmazonUrl(asin: string): string {
  const tag = process.env.AMAZON_PARTNER_TAG
  if (!tag) {
    console.warn('[amazon] AMAZON_PARTNER_TAG is not set — affiliate links will be untagged')
  }
  return tag
    ? `https://www.amazon.co.jp/dp/${asin}?tag=${tag}`
    : `https://www.amazon.co.jp/dp/${asin}`
}
```

- [ ] **Step 2: Verify the build still compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/crawlers/amazon.ts
git commit -m "feat: warn when AMAZON_PARTNER_TAG env var is missing"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open the home page**

Navigate to `http://localhost:3000` and confirm the footer is visible at the bottom with both Japanese and English disclosure lines.

- [ ] **Step 3: Open the results page**

Navigate to `http://localhost:3000/results?q=おもちゃ` and confirm the footer appears below the results.

- [ ] **Step 4: Confirm no TypeScript errors in terminal**

The dev server output should show no red TS errors.
