import { NextRequest } from 'next/server'
import { crawlRakutenSearch } from '@/lib/crawlers/rakuten'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: 'query required' }), { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw4:${query}`)
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      const cached = await getCached<{ rakutenResults: ProductResult[] }>(cacheKey).catch(() => null)
      if (cached && cached.rakutenResults.length > 0) {
        send({ type: 'rakuten', results: cached.rakutenResults, cached: true })
        send({ type: 'amazon', results: [], cached: true })
        send({ type: 'done' })
        controller.close()
        return
      }

      const rakutenResults = await crawlRakutenSearch(query).catch(() => [] as ProductResult[])
      send({ type: 'rakuten', results: rakutenResults })
      // No Amazon search. Emit an empty amazon event to keep the SSE shape the client expects.
      send({ type: 'amazon', results: [] })

      if (rakutenResults.length > 0) {
        await setCached(cacheKey, { rakutenResults }).catch(() => {})
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
