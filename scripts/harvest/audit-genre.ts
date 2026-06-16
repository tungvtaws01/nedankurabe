process.env.USE_UNPOOLED = '1'
/**
 * Item-level post-harvest audit (FREE — no crawl). For a genre it:
 *  (1) samples no_match products, re-runs refineKeyword, and asks an LLM whether the
 *      keyword faithfully preserves brand/line/type/size (catches KEYWORD-HALLUC);
 *      a code token-list flags obvious POLLUTION (industrial/non-baby items).
 *  (2) samples matched (amazon_done) pairs and asks an LLM "same product?" using the
 *      already-stored Rakuten + Amazon titles (catches FALSE-POSITIVE) — no crawl.
 *
 * Run: node --env-file=.env.local node_modules/.bin/tsx scripts/harvest/audit-genre.ts \
 *        --category=bottles [--nomatch=25] [--matched=12]
 */
import { query, pool } from '../../src/lib/db'
import { refineKeyword } from '../../src/lib/llm/openrouter'
import { writeFileSync } from 'fs'
import type { Category } from '../../src/lib/llm/category-prompts'

// Obvious non-baby pollution tokens seen leaking into categories (ESCO/MonotaRO industrial,
// office furniture, drafting tools). Keep conservative — only clear-cut non-baby items.
const POLLUTION = /エスコ|ESCO|EA[0-9]|NOK |オイルシール|トラスコ|TRUSCO|岡本製図|製図器|ドリルビス|ドリルビット|ヘックスビット|ドライバービット|フローバル|異径ユニオン|カプラ|チェア\b|オフィス|スライドケース|丸スライド/i

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function llmJson(prompt: string, tries = 4): Promise<any> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL ?? 'openai/gpt-oss-120b:free',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 2048, temperature: 0,
        }),
      })
      if (res.status === 429) { await sleep(3000 * (i + 1)); continue }
      if (!res.ok) { await sleep(1500); continue }
      const txt = (await res.json()).choices?.[0]?.message?.content ?? ''
      const m = txt.match(/\{[\s\S]*\}/)
      if (m) return JSON.parse(m[0])
    } catch { await sleep(1500) }
  }
  return null
}

const FAITHFUL = (src: string, kw: string) => `You audit a search keyword extracted from a Japanese baby-product title.
SOURCE is the original product title. KEYWORD is what an extractor produced to find the SAME product on another store.
Flag a problem ONLY if the keyword would find a DIFFERENT product — i.e. it CHANGED, INVENTED, or DROPPED a DISTINCTIVE token: brand, product-LINE name (e.g. 母乳相談室 vs 母乳実感 are different lines), item TYPE (e.g. 哺乳びん bottle vs さく乳器 breast-pump are different), or SIZE/capacity.
Dropping marketing fluff (送料無料, colors, 個数/セット, 出産祝い, 医療機関) is CORRECT — never flag that.
Output JSON only: {"faithful": true|false, "issue": "<short reason, or empty>"}
SOURCE: ${src}
KEYWORD: ${kw}`

const SAMEPROD = (r: string, a: string) => `Decide if these two Japanese product listings are the SAME physical product (same brand, product line, type, and size/capacity). Pack-count differences are OK. Different product LINE or item TYPE or SIZE = NOT same.
Output JSON only: {"same": true|false, "issue": "<short reason if not same, else empty>"}
RAKUTEN: ${r}
AMAZON: ${a}`

async function main() {
  const cat = process.argv.find((a) => a.startsWith('--category='))?.split('=')[1] as Category
  if (!cat) throw new Error('--category=<genre> required')
  const nN = parseInt(process.argv.find((a) => a.startsWith('--nomatch='))?.split('=')[1] ?? '25', 10)
  const nM = parseInt(process.argv.find((a) => a.startsWith('--matched='))?.split('=')[1] ?? '12', 10)

  // (1) no_match sample
  const noMatch = await query<{ id: number; title: string }>(`
    SELECT p.id, (SELECT l.title FROM listings l WHERE l.product_id=p.id AND l.platform='rakuten' AND l.is_active=true LIMIT 1) AS title
    FROM products p JOIN harvest_state hs ON hs.product_id=p.id
    WHERE p.category=$1 AND hs.stage='no_match' ORDER BY random() LIMIT $2`, [cat, nN])

  const esc = (s: unknown) => '"' + String(s ?? '').replace(/"/g, '""') + '"'
  const rows: string[] = ['kind,product_id,verdict,issue,source_title,extra']
  const tally = { POLLUTION: 0, KEYWORD_HALLUC: 0, OK_NOMATCH: 0, FALSE_POSITIVE: 0, OK_MATCH: 0 }

  console.log(`\n[audit ${cat}] no_match sample: ${noMatch.length}`)
  for (const r of noMatch) {
    if (!r.title) continue
    if (POLLUTION.test(r.title)) {
      tally.POLLUTION++
      rows.push(['nomatch', r.id, 'POLLUTION', '', esc(r.title), ''].join(','))
      console.log(`  POLLUTION [${r.id}] ${r.title.slice(0, 50)}`)
      continue
    }
    const kw = await refineKeyword(r.title, 'amazon', cat).catch(() => '')
    await sleep(400)
    const j = await llmJson(FAITHFUL(r.title, kw))
    const bad = j && j.faithful === false
    if (bad) { tally.KEYWORD_HALLUC++ } else { tally.OK_NOMATCH++ }
    rows.push(['nomatch', r.id, bad ? 'KEYWORD_HALLUC' : 'OK_NOMATCH', esc(j?.issue ?? ''), esc(r.title), esc('kw='+kw)].join(','))
    if (bad) console.log(`  KEYWORD_HALLUC [${r.id}] "${r.title.slice(0,40)}" -> "${kw}" :: ${j?.issue}`)
    await sleep(400)
  }

  // (2) matched sample
  const matched = await query<{ id: number; rtitle: string; atitle: string }>(`
    SELECT p.id,
      (SELECT l.title FROM listings l WHERE l.product_id=p.id AND l.platform='rakuten' AND l.is_active=true LIMIT 1) AS rtitle,
      (SELECT l.title FROM listings l WHERE l.product_id=p.id AND l.platform='amazon'  AND l.is_active=true LIMIT 1) AS atitle
    FROM products p JOIN harvest_state hs ON hs.product_id=p.id
    WHERE p.category=$1 AND hs.stage='amazon_done' ORDER BY random() LIMIT $2`, [cat, nM])

  console.log(`[audit ${cat}] matched sample: ${matched.length}`)
  for (const r of matched) {
    if (!r.rtitle || !r.atitle) continue
    const j = await llmJson(SAMEPROD(r.rtitle, r.atitle))
    const bad = j && j.same === false
    if (bad) { tally.FALSE_POSITIVE++ } else { tally.OK_MATCH++ }
    rows.push(['matched', r.id, bad ? 'FALSE_POSITIVE' : 'OK_MATCH', esc(j?.issue ?? ''), esc(r.rtitle), esc('amazon='+r.atitle)].join(','))
    if (bad) console.log(`  FALSE_POSITIVE [${r.id}] R="${r.rtitle.slice(0,35)}" vs A="${r.atitle.slice(0,35)}" :: ${j?.issue}`)
    await sleep(500)
  }

  const out = `docs/harvest/audit-${cat}.csv`
  writeFileSync(out, rows.join('\n') + '\n')
  console.log(`\n[audit ${cat}] TALLY`, JSON.stringify(tally))
  console.log(`[audit ${cat}] wrote ${out}`)
  await pool.end()
}
main().catch((e) => { console.error(e); process.exit(1) })
