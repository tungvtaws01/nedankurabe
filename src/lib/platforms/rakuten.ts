import { ProductResult } from '@/lib/types'
import { calcRakutenEffectivePrice } from '@/lib/price/normalize'

const SEARCH_URL = 'https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseRakutenItem(item: any, affiliateId: string): ProductResult {
  const price: number = item.itemPrice
  const shippingCost: number = item.postageFlag === 0 ? 0 : 490
  const pointRate: number = item.pointRate ?? 1
  const imageUrl: string = item.smallImageUrls?.[0]?.imageUrl ?? ''
  const itemUrl: string = item.itemUrl ?? ''

  const taxExcludedPrice = Math.floor(price / 1.1)
  const pointsEarned = Math.floor(taxExcludedPrice * pointRate / 100)
  const effectivePrice = calcRakutenEffectivePrice(price, shippingCost, 0, pointRate, 1, false, 'off', null)
  const affiliateUrl = affiliateId
    ? `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=${encodeURIComponent(itemUrl)}`
    : itemUrl

  return {
    platform: 'rakuten',
    title: item.itemName ?? '',
    imageUrl,
    shopName: item.shopName ?? '',
    salePrice: price,
    shippingCost,
    couponDiscount: 0,
    pointRate,
    pointsEarned,
    effectivePrice,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    affiliateUrl,
  }
}

export async function searchRakuten(keyword: string): Promise<ProductResult[]> {
  const appId = process.env.RAKUTEN_APP_ID!
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? ''
  const params = new URLSearchParams({ applicationId: appId, keyword, hits: '5', sort: '+itemPrice' })
  const res = await fetch(`${SEARCH_URL}?${params}`)
  if (!res.ok) throw new Error(`Rakuten API ${res.status}`)
  const data = await res.json() as { Items: Array<{ Item: unknown }> }
  return (data.Items ?? []).map(({ Item }) => parseRakutenItem(Item, affiliateId))
}

export async function lookupRakuten(itemCode: string): Promise<ProductResult | null> {
  const appId = process.env.RAKUTEN_APP_ID!
  const affiliateId = process.env.RAKUTEN_AFFILIATE_ID ?? ''
  const params = new URLSearchParams({ applicationId: appId, itemCode, hits: '1' })
  const res = await fetch(`${SEARCH_URL}?${params}`)
  if (!res.ok) return null
  const data = await res.json() as { Items: Array<{ Item: unknown }> }
  if (!data.Items?.length) return null
  return parseRakutenItem(data.Items[0].Item, affiliateId)
}
