import { NextRequest } from 'next/server'
import { crawlRakutenProduct } from '@/lib/crawlers/rakuten'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { explainPriceDifference } from '@/lib/llm/openrouter'
import { pickWinnerLoser } from '@/lib/price/explain'
import { ProductResult } from '@/lib/types'

// Called when the user taps a Rakuten card from the keyword pick-list.
// Streams (SSE) so the comparison appears as soon as the Amazon match resolves
// (~5-8s) instead of blocking on the slow ScraperAPI live-points crawl (up to 40s):
//   basic        → Amazon match found; show the comparison (Rakuten still pre-live)
//   live-points  → Rakuten item page crawled; update the Rakuten card in place
//   explanation  → price-difference sentence (after both resolve, reflects live price)
//   done / error
// The two slow operations run independently (NOT Promise.all) so each emits as it
// finishes. The match uses the source title (unchanged by enrichment), so running
// them concurrently does not stack the two waits. Emits the same event shapes the
// /api/lookup/stream consumer in results/page.tsx already handles.
export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { source?: ProductResult; candidates?: ProductResult[] }
  if (!body.source) {
    return new Response(JSON.stringify({ error: 'source required' }), { status: 400 })
  }
  const { source, candidates } = body

  // Resolve the real item URL from the affiliate link for the live-points crawl.
  const itemUrl = source.affiliateUrl.includes('hb.afl.rakuten')
    ? decodeURIComponent(source.affiliateUrl.split('pc=')[1]?.split('&')[0] ?? '') || source.affiliateUrl
    : source.affiliateUrl

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }
      try {
        let enrichedSource = source
        let match: ProductResult | null = null

        // Amazon match — emits `basic` as soon as it resolves (~5-8s).
        const matchTask = (async () => {
          match = await findEquivalent(source, 'amazon', candidates ?? []).catch(() => null)
          const results = [enrichedSource, ...(match ? [match] : [])]
            .sort((a, b) => a.effectivePrice - b.effectivePrice)
          send({ type: 'basic', results })
        })()

        // Live points — slow ScraperAPI render; emits `live-points` when ready.
        const liveTask = (async () => {
          const enriched = await crawlRakutenProduct(itemUrl).catch(() => null)
          if (enriched) {
            enrichedSource = enriched
            send({ type: 'live-points', result: enriched })
          }
        })()

        await Promise.all([matchTask, liveTask])

        // Explanation reflects the live-points effective price (both have resolved).
        if (match) {
          const { winner, loser } = pickWinnerLoser(enrichedSource, match)
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
