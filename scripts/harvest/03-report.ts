process.env.USE_UNPOOLED = '1'
import { writeFileSync } from 'fs'
import { query, pool } from '../../src/lib/db'

async function main() {
  const [counts] = await query<{
    total: number
    with_jan: number
    amazon_matched: number
    jan_with_amazon: number
    no_match: number
  }>(
    `SELECT
       (SELECT count(*) FROM products WHERE category='baby') AS total,
       (SELECT count(*) FROM products WHERE category='baby' AND jan IS NOT NULL) AS with_jan,
       (SELECT count(DISTINCT product_id) FROM listings WHERE platform='amazon' AND is_active=true) AS amazon_matched,
       (SELECT count(*) FROM products p WHERE p.category='baby' AND p.jan IS NOT NULL
          AND EXISTS (SELECT 1 FROM listings l WHERE l.product_id=p.id AND l.platform='amazon' AND l.is_active=true)) AS jan_with_amazon,
       (SELECT count(*) FROM harvest_state WHERE stage='no_match') AS no_match`)
  console.log('[report] coverage:', counts)

  // Acceptance gate: >=60% of JAN-bearing products matched to an active Amazon listing.
  const pct = counts.with_jan > 0 ? (counts.jan_with_amazon / counts.with_jan) * 100 : 0
  console.log(
    `[report] acceptance gate: jan_with_amazon / with_jan = ${counts.jan_with_amazon} / ${counts.with_jan} = ${pct.toFixed(1)}% (target >=60%)`)

  // Refinement A: separate Rakuten (enumerated seed) rows from Amazon (real match) rows.
  const bySource = await query(
    `SELECT platform, match_source, count(*) AS n FROM listings GROUP BY platform, match_source ORDER BY platform, n DESC`)
  console.log('[report] match_source by platform:', bySource)
  console.log(
    "[report] note: Rakuten 'title-sim' rows (confidence NULL) are enumerated-only — the Rakuten side is the seed, not a match. " +
    "The meaningful matching signal is the Amazon listings (jan-exact / title-sim / llm).")

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
  console.log(`[report] wrote harvest-sample.csv (${sample.length} pairs) — eyeball before enabling fast path`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
