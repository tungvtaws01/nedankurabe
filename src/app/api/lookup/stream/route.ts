import { NextRequest } from 'next/server'
import { crawlRakutenProductFast, crawlRakutenProductLive, crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { crawlAmazonProduct, crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { refineKeyword, semanticMatch } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'
function parseProductUrl(url: string): { platform: 'amazon' | 'rakuten'; id: string } | null {
  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const u = new URL(normalized)
    if (u.hostname.includes('amazon.co.jp')) {
      const m = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)
      if (m) return { platform: 'amazon', id: m[1] }
    }
    if (u.hostname.includes('rakuten.co.jp')) {
      return { platform: 'rakuten', id: normalized }
    }
  } catch { /* invalid URL */ }
  return null
}

function extractItemUrl(affiliateUrl: string): string {
  try {
    const u = new URL(affiliateUrl)
    if (u.hostname.includes('afl.rakuten.co.jp')) {
      const pc = u.searchParams.get('pc')
      if (pc) return decodeURIComponent(pc)
    }
  } catch {}
  return affiliateUrl
}

function extractTitleFromAmazonUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const slug = u.pathname.split('/dp/')[0].split('/').filter(Boolean).pop()
    if (!slug) return null
    const decoded = decodeURIComponent(slug)
    const sizesWithWord = decoded.match(/[A-Z0-9]{1,3}サイズ/g) ?? []
    const jpWords = (decoded.match(/[ぁ-ゖァ-ー一-鿿㐀-䶿]+/g) ?? [])
      .filter(w => w.length >= 2 && w !== 'サイズ')
    const parts = [...sizesWithWord, ...jpWords].slice(0, 4)
    return parts.join(' ').trim() || null
  } catch { return null }
}

function applyLivePoints(
  base: ProductResult,
  live: { pointRate: number; pointsEarned: number; couponDiscount: number; shippingCost: number | null },
): ProductResult {
  const shipping = live.shippingCost !== null ? live.shippingCost : base.shippingCost
  return {
    ...base,
    pointRate: live.pointRate,
    pointsEarned: live.pointsEarned,
    couponDiscount: live.couponDiscount,
    shippingCost: shipping,
    effectivePrice: base.salePrice + shipping - live.couponDiscount - live.pointsEarned,
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { url?: string }
  if (!body.url?.trim()) {
    return new Response(JSON.stringify({ error: 'url required' }), { status: 400 })
  }
  const url = body.url.trim()
  const parsed = parseProductUrl(url)
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: 'Amazon または楽天の商品URLを入力してください。' }),
      { status: 400 },
    )
  }

  const cacheKey = makeCacheKey(`lookup5:${url}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        // Cache hit: stream full results immediately
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          send({ type: 'done' })
          controller.close()
          return
        }

        let finalResults: ProductResult[] = []

        if (parsed.platform === 'rakuten') {
          // ── Rakuten URL ──────────────────────────────────────────────────
          // Phase 1: Rakuten API lookup (~1-2s) — fast placeholder, no ScraperAPI
          send({ type: 'status', message: '楽天の商品情報を取得中…' })
          const rakutenProduct = await crawlRakutenProductFast(parsed.id).catch(() => null)
          if (!rakutenProduct) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }

          // Stream placeholder immediately — user sees the card in ~1-2s
          send({ type: 'partial', results: [rakutenProduct] })

          // Phase 2+3: Amazon search AND live-points (ScraperAPI render=true) in parallel
          let latestRakuten: ProductResult = rakutenProduct
          let basicResults: ProductResult[] = [rakutenProduct]

          await Promise.all([
            // Amazon search chain (LLM + crawl)
            (async () => {
              try {
                send({ type: 'status', message: 'Amazonで同等商品を検索中…' })
                const kw = await refineKeyword(rakutenProduct.title, 'amazon').catch(() => rakutenProduct.title)
                const candidates = await crawlAmazonSearch(kw).catch(() => [] as ProductResult[])
                const idx = await semanticMatch(rakutenProduct, candidates).catch(() => null)
                const amazonMatch = idx !== null ? candidates[idx] ?? null : null
                basicResults = [latestRakuten, ...(amazonMatch ? [amazonMatch] : [])]
                  .sort((a, b) => a.effectivePrice - b.effectivePrice)
              } catch {
                basicResults = [latestRakuten]
              }
              send({ type: 'basic', results: basicResults })
            })(),

            // Live points via ScraperAPI render=true — updates SuperDEAL/coupon
            (async () => {
              const live = await crawlRakutenProductLive(
                parsed.id,
                rakutenProduct.salePrice,
                rakutenProduct.taxRate,
              ).catch(() => null)
              if (live) {
                latestRakuten = applyLivePoints(rakutenProduct, live)
                send({ type: 'live-points', result: latestRakuten })
                basicResults = basicResults.map(r => r.platform === 'rakuten' ? latestRakuten : r)
              }
            })(),
          ])

          finalResults = basicResults

        } else {
          // ── Amazon URL ───────────────────────────────────────────────────
          send({ type: 'status', message: 'Amazonの商品ページを取得中…' })
          const amazonProduct = await crawlAmazonProduct(parsed.id, url).catch(() => null)
          const titleForSearch = amazonProduct?.title ?? extractTitleFromAmazonUrl(url)
          if (!titleForSearch) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }

          // Phase 1: show Amazon product immediately
          if (amazonProduct) send({ type: 'partial', results: [amazonProduct] })

          // Phase 2: Rakuten search
          send({ type: 'status', message: '楽天で同等商品を検索中…' })
          const rakutenKeyword = amazonProduct
            ? await refineKeyword(amazonProduct.title, 'rakuten').catch(() => amazonProduct.title)
            : titleForSearch ?? ''
          const rakutenCandidates = await crawlRakutenSearch(rakutenKeyword).catch(() => [] as ProductResult[])
          if (!amazonProduct && !rakutenCandidates.length) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }
          const matchIdx = amazonProduct
            ? await semanticMatch(amazonProduct, rakutenCandidates).catch(() => null)
            : null
          const rakutenMatch = matchIdx !== null ? rakutenCandidates[matchIdx] ?? null : null
          let results: ProductResult[] = [...(amazonProduct ? [amazonProduct] : []), ...(rakutenMatch ? [rakutenMatch] : [])]
            .sort((a, b) => a.effectivePrice - b.effectivePrice)
          send({ type: 'basic', results })

          // Phase 3: live points for Rakuten match (sequential — need URL from match)
          if (rakutenMatch) {
            const rakutenItemUrl = extractItemUrl(rakutenMatch.affiliateUrl)
            const live = await crawlRakutenProductLive(
              rakutenItemUrl,
              rakutenMatch.salePrice,
              rakutenMatch.taxRate,
            ).catch(() => null)
            if (live) {
              const updated = applyLivePoints(rakutenMatch, live)
              send({ type: 'live-points', result: updated })
              results = results.map(r => r.platform === 'rakuten' ? updated : r)
            }
          }

          finalResults = results
        }

        if (finalResults.length > 0) await setCached(cacheKey, finalResults).catch(() => {})
        send({ type: 'done' })
        controller.close()
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : 'エラーが発生しました。' })
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
