import { NextRequest, NextResponse } from 'next/server'
import { findEquivalent } from '@/lib/matching/find-equivalent'
import { ProductResult } from '@/lib/types'
export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null }>> {
  const body = await req.json() as { source?: ProductResult; candidates?: ProductResult[] }
  if (!body.source) {
    return NextResponse.json({ result: null }, { status: 400 })
  }
  // Amazon card tapped → find the Rakuten equivalent via a fresh targeted search,
  // using the keyword-search pick-list (candidates) as a supplementary pool.
  const result = await findEquivalent(body.source, 'rakuten', body.candidates ?? []).catch(() => null)
  return NextResponse.json({ result })
}
