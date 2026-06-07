import { NextRequest } from 'next/server'
import { crawlRakutenProduct, crawlRakutenProductLive, crawlRakutenSearch } from '@/lib/crawlers/rakuten'
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

// Decode the original item URL from an affiliate link
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
        // Cache hit: stream immediately, skip live-points fetch
        const cached = await getCached<ProductResult[]>(cacheKey).catch(() => null)
        if (cached && cached.length > 0) {
          send({ type: 'basic', results: cached, cached: true })
          send({ type: 'done' })
          controller.close()
          return
        }

        let results: ProductResult[] = []
        let rakutenItemUrl: string | null = null

        if (parsed.platform === 'amazon') {
          const amazonProduct = await crawlAmazonProduct(parsed.id).catch(() => null)
          const titleForSearch = amazonProduct?.title ?? extractTitleFromAmazonUrl(url)
          if (!titleForSearch) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }
          const rakutenKeyword = amazonProduct
            ? await refineKeyword(amazonProduct.title, 'rakuten').catch(() => amazonProduct.title)
            : titleForSearch
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
          results = [...(amazonProduct ? [amazonProduct] : []), ...(rakutenMatch ? [rakutenMatch] : [])]
            .sort((a, b) => a.effectivePrice - b.effectivePrice)
          if (rakutenMatch) rakutenItemUrl = extractItemUrl(rakutenMatch.affiliateUrl)

        } else {
          const rakutenProduct = await crawlRakutenProduct(parsed.id).catch(() => null)
          if (!rakutenProduct) {
            send({ type: 'error', message: '商品が見つかりませんでした。' })
            controller.close()
            return
          }
          const amazonKeyword = await refineKeyword(rakutenProduct.title, 'amazon').catch(() => rakutenProduct.title)
          const amazonCandidates = await crawlAmazonSearch(amazonKeyword).catch(() => [] as ProductResult[])
          const matchIdx = await semanticMatch(rakutenProduct, amazonCandidates).catch(() => null)
          const amazonMatch = matchIdx !== null ? amazonCandidates[matchIdx] ?? null : null
          results = [rakutenProduct, ...(amazonMatch ? [amazonMatch] : [])]
            .sort((a, b) => a.effectivePrice - b.effectivePrice)
          rakutenItemUrl = parsed.id
        }

        // Stream basic results immediately — UI unblocks here
        send({ type: 'basic', results, cached: false })

        // Fetch live Rakuten points via JS rendering
        const rakutenItem = results.find(r => r.platform === 'rakuten')
        if (rakutenItemUrl && rakutenItem) {
          const live = await crawlRakutenProductLive(
            rakutenItemUrl,
            rakutenItem.salePrice,
            rakutenItem.taxRate,
          ).catch(() => null)

          if (live) {
            const updated: ProductResult = {
              ...rakutenItem,
              pointRate: live.pointRate,
              pointsEarned: live.pointsEarned,
              couponDiscount: live.couponDiscount,
              effectivePrice: rakutenItem.salePrice + rakutenItem.shippingCost
                - live.couponDiscount - live.pointsEarned,
            }
            send({ type: 'live-points', result: updated })
            results = results.map(r => r.platform === 'rakuten' ? updated : r)
          }
        }

        // Cache the final (live-points-enhanced) results
        if (results.length > 0) await setCached(cacheKey, results).catch(() => {})
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
