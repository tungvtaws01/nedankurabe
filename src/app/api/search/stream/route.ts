import { NextRequest } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { searchAmazonFromDb } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { isBabyQuery } from '@/lib/search/baby-scope'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'

// Amazon results for the pick-list come from the matching DB (link-only: Rakuten
// image + tagged ASIN link, no price, no scraping).
async function amazonFromDb(query: string): Promise<ProductResult[]> {
  const sibs = await searchAmazonFromDb(query).catch(() => [])
  return sibs.map((s) => buildAmazonLinkResult({ asin: s.asin, title: s.productTitle, imageUrl: s.productImageUrl }))
}

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: 'query required' }), { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw6:${query}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const cached = await getCached<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }>(cacheKey).catch(() => null)
      if (cached && cached.rakutenResults.length > 0) {
        send({ type: 'rakuten', results: cached.rakutenResults, cached: true })
        send({ type: 'amazon', results: cached.amazonResults ?? [], cached: true })
        send({ type: 'done' })
        controller.close()
        return
      }

      // Baby-only scope: skip both platforms for off-topic queries so the UI shows
      // the baby-only empty state instead of generic Rakuten gift items.
      // Rakuten (live API) and Amazon (DB, link-only) run in parallel otherwise.
      const [rakutenResults, amazonResults] = isBabyQuery(query)
        ? await Promise.all([
            crawlRakutenSearch(query).catch(() => [] as ProductResult[]),
            amazonFromDb(query),
          ])
        : [[] as ProductResult[], [] as ProductResult[]]
      send({ type: 'rakuten', results: rakutenResults })
      send({ type: 'amazon', results: amazonResults })

      if (rakutenResults.length > 0) {
        await setCached(cacheKey, { rakutenResults, amazonResults }).catch(() => {})
      }

      send({ type: 'done' })
      controller.close()
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
