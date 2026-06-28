import { ProductResult } from '@/lib/types'
import { findMatchByAsin, linkSlugToProduct } from '@/lib/harvest/repo'
import { buildAmazonLinkResult } from '@/lib/platforms/amazon-link'
import { lookupRakuten } from '@/lib/platforms/rakuten'
import { matchAgainstDb } from '@/lib/matching/db-fallback'

export interface AmazonPasteResolution {
  amazonCard: ProductResult
  rakuten: ProductResult | null
}

// Resolve an Amazon paste (ASIN + best-effort slug title) into a link-only Amazon
// card plus its priced Rakuten sibling. Exact ASIN match first; on miss, fall back
// to a confidence-gated DB title match and write the result back. Returns null only
// when there is neither a DB match nor a usable slug title (route then 404s).
// All steps best-effort: failures degrade to "Amazon card alone, no Rakuten".
export async function resolveAmazonPaste(asin: string, slugTitle: string): Promise<AmazonPasteResolution | null> {
  const match = await findMatchByAsin(asin).catch(() => null)
  if (!match && !slugTitle) return null

  let title = match?.productTitle ?? slugTitle
  let imageUrl = match?.productImageUrl ?? ''
  let rakuten = match?.rakutenItemCode ? await lookupRakuten(match.rakutenItemCode).catch(() => null) : null

  if (!match && slugTitle) {
    const probe = buildAmazonLinkResult({ asin, title: slugTitle, imageUrl: '' })
    const dbMatch = (await matchAgainstDb(probe, 'rakuten').catch(() => []))[0] ?? null
    if (dbMatch) {
      title = dbMatch.productTitle
      imageUrl = dbMatch.productImageUrl
      rakuten = await lookupRakuten(dbMatch.targetListingId).catch(() => null)
      await linkSlugToProduct(dbMatch.productId, 'amazon', asin, dbMatch.productTitle, 0.8).catch(() => {})
    }
  }

  return { amazonCard: buildAmazonLinkResult({ asin, title, imageUrl }), rakuten }
}
