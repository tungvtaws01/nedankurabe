import { NextRequest, NextResponse } from 'next/server'
import { searchAmazon } from '@/lib/platforms/amazon'
import { ProductResult } from '@/lib/types'

export async function POST(req: NextRequest): Promise<NextResponse<{ result: ProductResult | null }>> {
  const body = await req.json() as { title?: string }
  if (!body.title?.trim()) {
    return NextResponse.json({ result: null }, { status: 400 })
  }
  const result = await searchAmazon(body.title.trim())
    .then(items => items[0] ?? null)
    .catch(() => null)
  return NextResponse.json({ result })
}
