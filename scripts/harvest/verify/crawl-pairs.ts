process.env.USE_UNPOOLED = '1'
/**
 * Phase A of the full matched-pair verification (accuracy mandate).
 * For every ACTIVE amazon+rakuten matched pair, crawl both detail pages and persist
 * everything a vision judge needs to decide "same physical product?":
 *   - Rakuten: lookupRakuten(itemCode) — FREE Ichiba API → title, caption, image, itemUrl
 *   - Amazon:  detail page via scrape.do (token rotation) → title, #landingImage, bullets
 * Downloads both main images to docs/harvest/verify/img/<id>-{a,r}.jpg and appends one
 * JSONL record per pair to docs/harvest/verify/pairs.jsonl. Fully RESUMABLE (skips ids
 * already in the JSONL) and NEVER mutates the DB.
 *
 * Run: node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/verify/crawl-pairs.ts [--limit=N]
 */
import { query, pool } from '../../../src/lib/db'
import { parse } from 'node-html-parser'
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'

const OUT_DIR = 'docs/harvest/verify'
const IMG_DIR = `${OUT_DIR}/img`
const JSONL = `${OUT_DIR}/pairs.jsonl`
const CONCURRENCY = 6
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const TOKENS = (process.env.SCRAPEDO_TOKENS ?? process.env.SCRAPEDO_TOKEN ?? '')
  .split(',').map((t) => t.trim()).filter(Boolean)
let tokIdx = 0
const tok = () => TOKENS[tokIdx % TOKENS.length]
const rotate = () => { tokIdx++ }

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept-Language': 'ja-JP,ja;q=0.9',
}
// The 20260401 ichibams endpoint 403s on a bare Referer; it needs the full origin set.
const RAKUTEN_URL = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401'
const RAKUTEN_HEADERS = {
  Referer: 'https://nedankurabe.vercel.app/',
  Origin: 'https://nedankurabe.vercel.app',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
}

/** Fetch a single Rakuten item by itemCode (free API). Returns raw Item or null. */
async function fetchRakutenItem(itemCode: string): Promise<any | null> {
  const params = new URLSearchParams({
    applicationId: process.env.RAKUTEN_APP_ID!, accessKey: process.env.RAKUTEN_ACCESS_KEY!,
    itemCode, hits: '1',
  })
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${RAKUTEN_URL}?${params}`, { headers: RAKUTEN_HEADERS, signal: AbortSignal.timeout(15000) })
      if (res.status === 429) { await sleep(1500 * (i + 1)); continue }
      if (!res.ok) return null
      const data = JSON.parse(await res.text()) as { Items?: Array<{ Item: any }> }
      return data.Items?.[0]?.Item ?? null
    } catch { await sleep(800) }
  }
  return null
}

type Pair = { id: number; category: string; asin: string; rcode: string; atitle_db: string; rtitle_db: string }

/** Fetch Amazon detail HTML via scrape.do, rotating tokens on quota/block. */
async function fetchAmazonHtml(asin: string): Promise<string | null> {
  const url = `https://www.amazon.co.jp/dp/${asin}`
  for (let attempt = 0; attempt < TOKENS.length + 1; attempt++) {
    const proxyUrl = `https://api.scrape.do?token=${tok()}&url=${encodeURIComponent(url)}&customHeaders=true`
    try {
      const res = await fetch(proxyUrl, { headers: HEADERS, signal: AbortSignal.timeout(30000) })
      if (res.status === 429 || res.status === 401 || res.status === 403) { rotate(); await sleep(800); continue }
      if (!res.ok) { await sleep(600); continue }
      const html = await res.text()
      if (html.length < 2000) { await sleep(600); continue }
      return html
    } catch { await sleep(600) }
  }
  return null
}

/** Pull a real product image URL from Amazon detail HTML (handles placeholder src). */
function amazonImage(root: ReturnType<typeof parse>): string {
  const img = root.querySelector('#landingImage, #imgBlkFront')
  if (img) {
    const dyn = img.getAttribute('data-a-dynamic-image')
    if (dyn) { try { const k = Object.keys(JSON.parse(dyn))[0]; if (k?.startsWith('http')) return k } catch {} }
    const hires = img.getAttribute('data-old-hires')
    if (hires?.startsWith('http')) return hires
    const src = img.getAttribute('src')
    if (src?.startsWith('http')) return src
  }
  const og = root.querySelector('meta[property="og:image"]')?.getAttribute('content')
  return og?.startsWith('http') ? og : ''
}
/** Shrink media-amazon image to ~320px to keep downloads small but legible. */
const amzThumb = (u: string) => u.replace(/(\/I\/[^.]+)\.(jpg|png)/i, '$1._SX320_.$2')
/** Upgrade Rakuten thumbnail (?_ex=64x64) to a legible 300x300. */
const rakThumb = (u: string) => u ? u.replace(/\?_ex=\d+x\d+/, '?_ex=300x300') : u

function parseAmazonDetail(html: string): { title: string; image: string; desc: string } {
  const root = parse(html)
  const title = (root.querySelector('#productTitle, #title')?.text ?? '').replace(/\s+/g, ' ').trim()
  const image = amazonImage(root)
  const bullets = root.querySelectorAll('#feature-bullets li span.a-list-item')
    .slice(0, 4).map((el) => el.text.trim()).filter((t) => t.length > 5)
  return { title, image, desc: bullets.join(' • ').slice(0, 280) }
}

async function download(url: string, path: string): Promise<boolean> {
  if (!url) return false
  try {
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) })
    if (!res.ok) return false
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 500) return false
    writeFileSync(path, buf)
    return true
  } catch { return false }
}

async function handlePair(p: Pair): Promise<Record<string, unknown>> {
  const rec: Record<string, unknown> = {
    id: p.id, category: p.category, asin: p.asin, rcode: p.rcode,
    atitle_db: p.atitle_db, rtitle_db: p.rtitle_db,
  }
  // Rakuten (free API)
  try {
    const item = await fetchRakutenItem(p.rcode)
    if (item) {
      rec.rtitle_live = (item.itemName ?? '').replace(/\s+/g, ' ').trim()
      rec.rdesc = (item.itemCaption ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)
      rec.rurl = item.itemUrl ?? ''
      const rraw: string = item.mediumImageUrls?.[0]?.imageUrl ?? item.smallImageUrls?.[0]?.imageUrl ?? ''
      const rimg = rakThumb(rraw)
      rec.rimg_url = rimg
      if (await download(rimg, `${IMG_DIR}/${p.id}-r.jpg`)) rec.rimg = `${IMG_DIR}/${p.id}-r.jpg`
    } else rec.rakuten_status = 'not_found'
  } catch (e) { rec.rakuten_status = 'error:' + (e as Error).message.slice(0, 40) }
  // Amazon (scrape.do)
  const html = await fetchAmazonHtml(p.asin)
  if (html) {
    const a = parseAmazonDetail(html)
    rec.atitle_live = a.title
    rec.adesc = a.desc
    rec.aimg_url = a.image
    if (a.image && (await download(amzThumb(a.image), `${IMG_DIR}/${p.id}-a.jpg`))) rec.aimg = `${IMG_DIR}/${p.id}-a.jpg`
    else if (a.image && (await download(a.image, `${IMG_DIR}/${p.id}-a.jpg`))) rec.aimg = `${IMG_DIR}/${p.id}-a.jpg`
  } else rec.amazon_status = 'fetch_failed'
  return rec
}

async function main() {
  mkdirSync(IMG_DIR, { recursive: true })
  if (!TOKENS.length) { console.error('No SCRAPEDO_TOKENS'); process.exit(1) }
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0)

  const done = new Set<number>()
  if (existsSync(JSONL)) {
    for (const line of readFileSync(JSONL, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try { done.add(JSON.parse(line).id) } catch {}
    }
  }
  console.log(`[crawl] ${TOKENS.length} tokens; ${done.size} pairs already done`)

  const rows = await query<Pair>(`
    SELECT p.id, p.category,
      MAX(CASE WHEN l.platform='amazon'  THEN l.platform_id END) AS asin,
      MAX(CASE WHEN l.platform='rakuten' THEN l.platform_id END) AS rcode,
      MAX(CASE WHEN l.platform='amazon'  THEN l.title END) AS atitle_db,
      MAX(CASE WHEN l.platform='rakuten' THEN l.title END) AS rtitle_db
    FROM products p JOIN harvest_state hs ON hs.product_id=p.id AND hs.stage='amazon_done'
    JOIN listings l ON l.product_id=p.id AND l.is_active=true
    GROUP BY p.id, p.category
    HAVING MAX(CASE WHEN l.platform='amazon' THEN l.platform_id END) IS NOT NULL
       AND MAX(CASE WHEN l.platform='rakuten' THEN l.platform_id END) IS NOT NULL
    ORDER BY p.id`)
  let todo = rows.filter((r) => !done.has(r.id))
  if (limit) todo = todo.slice(0, limit)
  console.log(`[crawl] ${rows.length} total pairs, ${todo.length} to crawl`)

  let n = 0, aOk = 0, rOk = 0, imgBoth = 0
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    const recs = await Promise.all(batch.map(handlePair))
    for (const rec of recs) {
      appendFileSync(JSONL, JSON.stringify(rec) + '\n')
      n++
      if (rec.aimg) aOk++
      if (rec.rimg) rOk++
      if (rec.aimg && rec.rimg) imgBoth++
    }
    if (n % 30 === 0 || i + CONCURRENCY >= todo.length) {
      console.log(`[crawl] ${n}/${todo.length} | aImg=${aOk} rImg=${rOk} bothImg=${imgBoth} | tok#${tokIdx % TOKENS.length}`)
    }
  }
  console.log(`[crawl] DONE ${n} pairs. aImg=${aOk} rImg=${rOk} bothImg=${imgBoth} -> ${JSONL}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
