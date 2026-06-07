import { NextRequest } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { crawlAmazonSearch } from '@/lib/crawlers/amazon'
import { hasProxy } from '@/lib/crawlers/proxy-fetch'
import { refineKeyword } from '@/lib/llm/openrouter'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: 'query required' }), { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw3:${query}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      // Cache hit: send both immediately
      const cached = await getCached<{ rakutenResults: ProductResult[]; amazonResults: ProductResult[] }>(cacheKey).catch(() => null)
      if (cached && cached.rakutenResults.length > 0) {
        send({ type: 'rakuten', results: cached.rakutenResults, cached: true })
        send({ type: 'amazon', results: cached.amazonResults, cached: true })
        send({ type: 'done' })
        controller.close()
        return
      }

      // Phase 1: Rakuten API — fast (~1-2s)
      const rakutenResults = await crawlRakutenSearch(query).catch(() => [] as ProductResult[])
      send({ type: 'rakuten', results: rakutenResults })

      // Phase 2: Amazon search — slower (LLM keyword + ScraperAPI, ~8-10s)
      let amazonResults: ProductResult[] = []
      if (hasProxy()) {
        const kw = await refineKeyword(query, 'amazon').catch(() => query)
        amazonResults = await crawlAmazonSearch(kw).catch(() => [] as ProductResult[])
      }
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
