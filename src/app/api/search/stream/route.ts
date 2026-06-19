import { NextRequest } from 'next/server'
import { runBabySearch } from '@/lib/search/run-search'
import { getCached, setCached, makeCacheKey } from '@/lib/cache'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json() as { query?: string }
  if (!body.query?.trim()) {
    return new Response(JSON.stringify({ error: 'query required' }), { status: 400 })
  }
  const query = body.query.trim()
  const cacheKey = makeCacheKey(`kw7:${query}`)
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

      // Always search — Rakuten results are genre-filtered at the platform layer, so
      // off-topic queries return empty and the UI shows the baby-only empty state.
      // Amazon is DB link-only; never scraped.
      const { rakutenResults, amazonResults } = await runBabySearch(query)
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
