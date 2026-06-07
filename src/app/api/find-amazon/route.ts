import { NextRequest, NextResponse } from 'next/server'
import { semanticMatch } from '@/lib/llm/openrouter'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null }>> {
  const body = await req.json() as { source?: ProductResult; candidates?: ProductResult[] }
  if (!body.source || !body.candidates?.length) {
    return NextResponse.json({ result: null }, { status: 400 })
  }
  const idx = await semanticMatch(body.source, body.candidates).catch(() => 0)
  const result = idx !== null ? body.candidates[idx] ?? null : null
  return NextResponse.json({ result })
}
