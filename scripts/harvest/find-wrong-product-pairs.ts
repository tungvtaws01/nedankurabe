process.env.USE_UNPOOLED = '1'
import { query, pool } from '../../src/lib/db'

// One-off maintenance: find Amazon listings matched to the WRONG product (different brand /
// product line), as opposed to the same product at a different pack size. Pack-size differences
// (Amazon single vs Rakuten ケース/multipack) are legitimate and must NOT be flagged — so this
// compares brand/product-line TEXT with all size/count/marketing noise stripped out.
//
// For each active Amazon listing we take the BEST core-text overlap across its Rakuten siblings;
// a low best-overlap means even the closest sibling is a different product → suspect pairing.
// Dry-run by default, sorted most-suspect first so the cutoff can be eyeballed before --apply.
// --threshold=N (default 0.15) sets the Jaccard cutoff; --apply deactivates flagged listings.

// Noise to drop before comparing: pack/size tokens, bundle/marketing phrases, bracketed asides.
const NOISE = [
  /[【［\[][^】］\]]*[】］\]]/g,        // 【...】 bracketed asides (promos, size labels)
  /[(（][^)）]*[)）]/g,                // (...) parentheticals (often size breakdowns)
  /\d+(?:\.\d+)?\s*(?:kg|g|ml|l|枚|袋|缶|個|本|包|箱|セット|ケース|組|パック|サイズ|ヶ月|カ月|か月|ヵ月)/gi,
  /[×x×]\s*\d+/gi,                     // ×N multipliers
  /\d+/g,                             // any remaining bare numbers
  /送料無料|まとめ買い|単品|代引不可|クーポン|配布中|限定|正規品|ケース販売|梱販売|送料お得|会員様|セット/g,
]

function coreTokens(title: string): Set<string> {
  let s = title
  for (const re of NOISE) s = s.replace(re, ' ')
  const lower = s.toLowerCase()
  const out = new Set<string>()
  for (const w of lower.match(/[a-z]{2,}/g) ?? []) out.add(w)
  for (const run of lower.match(/[ぁ-ゖァ-ヶ一-鿿㐀-䶿]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i++) out.add(run.slice(i, i + 2)) // CJK bigrams
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const threshold = Number(process.argv.find((a) => a.startsWith('--threshold='))?.split('=')[1] ?? 0.15)
  const rows = await query<{
    amazon_listing_id: number; asin: string; amazon_title: string; product_id: number; rakuten_title: string
  }>(`
    SELECT la.id AS amazon_listing_id, la.platform_id AS asin, la.title AS amazon_title,
           p.id AS product_id, lr.title AS rakuten_title
      FROM listings la
      JOIN products p ON p.id = la.product_id
      JOIN listings lr ON lr.product_id = p.id AND lr.platform='rakuten' AND lr.is_active=true
     WHERE la.platform='amazon' AND la.is_active=true`)

  const byListing = new Map<number, { asin: string; amazonTitle: string; productId: number; rakuten: string[] }>()
  for (const r of rows) {
    let e = byListing.get(r.amazon_listing_id)
    if (!e) { e = { asin: r.asin, amazonTitle: r.amazon_title, productId: r.product_id, rakuten: [] }; byListing.set(r.amazon_listing_id, e) }
    e.rakuten.push(r.rakuten_title)
  }

  const scored = [...byListing.entries()].map(([id, e]) => {
    const aTok = coreTokens(e.amazonTitle)
    const best = Math.max(0, ...e.rakuten.map((t) => jaccard(aTok, coreTokens(t))))
    return { id, ...e, best }
  })
  const flagged = scored.filter((s) => s.best < threshold).sort((a, b) => a.best - b.best)

  console.log(`Active Amazon listings with a Rakuten sibling: ${byListing.size}`)
  console.log(`Suspect WRONG-PRODUCT pairs (best core-text overlap < ${threshold}): ${flagged.length}\n`)
  for (const f of flagged) {
    console.log(`[${f.best.toFixed(3)}] pid=${f.productId} ${f.asin}`)
    console.log(`  AMZN ${f.amazonTitle.slice(0, 90)}`)
    console.log(`  RAKU ${f.rakuten[0].slice(0, 90)}`)
  }

  if (!apply) { console.log(`\nDRY RUN — tune with --threshold=N, then pass --apply to deactivate the flagged Amazon listings.`); await pool.end(); return }
  const ids = flagged.map((f) => f.id)
  if (ids.length) {
    await query(`UPDATE listings SET is_active=false, verified_at=now() WHERE id = ANY($1)`, [ids])
    console.log(`\nDeactivated ${ids.length} wrong-product Amazon listings (reversible: is_active=false).`)
  }
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
