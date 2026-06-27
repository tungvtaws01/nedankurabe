import { NextRequest } from 'next/server'
import { crawlRakutenProductFast, crawlRakutenProduct, crawlRakutenProductLive } from '@/lib/crawlers/rakuten'
import { resolveAmazonShortLink } from '@/lib/crawlers/amazon'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { resolveAmazonPaste } from '@/lib/lookup/resolve-amazon-paste'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'
import { isComparablePair, pickWinnerLoser } from '@/lib/price/explain'
import { byEffectivePrice } from '@/lib/price/normalize'
import { resolveJanRakutenUrl } from '@/lib/search/jan-url-lookup'

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
  const resolvedUrl = await resolveAmazonShortLink(url)
  const parsed = parseProductUrl(resolvedUrl)
  if (!parsed) {
    return new Response(
      JSON.stringify({ error: 'Amazon または楽天の商品URLを入力してください。' }),
      { status: 400 },
    )
  }

  const cacheKey = makeCacheKey(`lookup6:${url}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      try {
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          if (cached.length === 2 && isComparablePair(cached[0], cached[1])) {
            const { winner, loser } = pickWinnerLoser(cached[0], cached[1])
            const explanation = await explainPriceDifference(winner, loser).catch(() => null)
            if (explanation) send({ type: 'explanation', text: explanation })
          }
          send({ type: 'done' })
          controller.close()
          return
        }

        let finalResults: ProductResult[] = []

        if (parsed.platform === 'rakuten') {
          // ── Rakuten URL ──────────────────────────────────────────────────
          // JAN-slug fast-path: if the URL slug is a bare EAN-13, resolve from DB
          // (slug ≠ Rakuten itemCode, so crawlRakutenProductFast cannot handle it).
          const janResults = await resolveJanRakutenUrl(parsed.id).catch(() => null)
          if (janResults) {
            send({ type: 'basic', results: janResults })
            await setCached(cacheKey, janResults).catch(() => {})
            send({ type: 'done' })
            controller.close()
            return
          }
          send({ type: 'status', message: '楽天の商品情報を取得中…' })
          // Fast path (API by itemCode) → HTML-crawl fallback for slug URLs whose
          // public slug ≠ the Rakuten API itemCode (crawlRakutenProductFast returns null).
          const rakutenProduct =
            await crawlRakutenProductFast(parsed.id).catch(() => null) ??
            await crawlRakutenProduct(parsed.id).catch(() => null)
          if (!rakutenProduct) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }
          send({ type: 'partial', results: [rakutenProduct] })

          let latestRakuten: ProductResult = rakutenProduct
          let basicResults: ProductResult[] = [rakutenProduct]

          await Promise.all([
            (async () => {
              send({ type: 'status', message: 'Amazonの同等商品を確認中…' })
              const amazonMatch = await findEquivalent(rakutenProduct, 'amazon').catch(() => null)
              basicResults = [latestRakuten, ...(amazonMatch ? [amazonMatch] : [])].sort(byEffectivePrice)
              send({ type: 'basic', results: basicResults })
            })(),
            (async () => {
              const live = await crawlRakutenProductLive(parsed.id, rakutenProduct.salePrice, rakutenProduct.taxRate).catch(() => null)
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
          // Exact ASIN match → priced Rakuten sibling; on miss, a confidence-gated
          // DB title match surfaces the Rakuten sibling (resolveAmazonPaste). The
          // ASIN never 404s — we always show at least the link-only Amazon card.
          send({ type: 'status', message: '商品情報を確認中…' })
          const resolution = await resolveAmazonPaste(parsed.id, extractTitleFromAmazonUrl(resolvedUrl) ?? '').catch(() => null)
          const amazonCard = resolution?.amazonCard ?? buildAmazonLinkResult({ asin: parsed.id, title: '', imageUrl: '' })
          const rakuten = resolution?.rakuten ?? null
          send({ type: 'partial', results: [amazonCard] })

          let results: ProductResult[] = [amazonCard]
          if (rakuten) {
            results = [amazonCard, rakuten].sort(byEffectivePrice)
            send({ type: 'basic', results })
            const itemUrl = extractItemUrl(rakuten.affiliateUrl)
            const live = await crawlRakutenProductLive(itemUrl, rakuten.salePrice, rakuten.taxRate).catch(() => null)
            if (live) {
              const updated = applyLivePoints(rakuten, live)
              send({ type: 'live-points', result: updated })
              results = results.map(r => r.platform === 'rakuten' ? updated : r)
            }
          } else {
            send({ type: 'basic', results })
          }
          finalResults = results
        }

        if (finalResults.length > 0) await setCached(cacheKey, finalResults).catch(() => {})
        if (finalResults.length === 2 && isComparablePair(finalResults[0], finalResults[1])) {
          const { winner, loser } = pickWinnerLoser(finalResults[0], finalResults[1])
          const explanation = await explainPriceDifference(winner, loser).catch(() => null)
          if (explanation) send({ type: 'explanation', text: explanation })
        }
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
