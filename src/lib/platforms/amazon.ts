import { createHmac, createHash } from 'crypto'
import { ProductResult } from '@/lib/types'
import { calcAmazonEffectivePrice } from '@/lib/price/normalize'

const HOST = 'webservices.amazon.co.jp'
const REGION = 'us-west-2'
const SERVICE = 'ProductAdvertisingAPI'

function sign(key: Buffer, msg: string): Buffer {
  return createHmac('sha256', key).update(msg).digest()
}

function getSigningKey(secret: string, date: string): Buffer {
  return sign(sign(sign(sign(Buffer.from('AWS4' + secret), date), REGION), SERVICE), 'aws4_request')
}

function buildAuthHeaders(path: string, payload: string, target: string): Record<string, string> {
  const accessKey = process.env.AMAZON_ACCESS_KEY!
  const secretKey = process.env.AMAZON_SECRET_KEY!
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = createHash('sha256').update(payload).digest('hex')

  const canonicalHeaders =
    `content-encoding:amz-1.0\ncontent-type:application/json; charset=utf-8\n` +
    `host:${HOST}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`
  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target'
  const canonicalReq = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const credScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, credScope,
    createHash('sha256').update(canonicalReq).digest('hex'),
  ].join('\n')
  const sig = createHmac('sha256', getSigningKey(secretKey, dateStamp)).update(stringToSign).digest('hex')

  return {
    'content-encoding': 'amz-1.0',
    'content-type': 'application/json; charset=utf-8',
    host: HOST,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`,
  }
}

async function paCall(path: string, target: string, body: object): Promise<unknown> {
  const payload = JSON.stringify(body)
  const headers = buildAuthHeaders(path, payload, target)
  const res = await fetch(`https://${HOST}${path}`, { method: 'POST', headers, body: payload })
  if (!res.ok) throw new Error(`Amazon PA-API ${res.status}: ${await res.text()}`)
  return res.json()
}

const RESOURCES = [
  'Images.Primary.Medium',
  'ItemInfo.Title',
  'Offers.Listings.Price',
  'Offers.Listings.DeliveryInfo.IsFreeShippingEligible',
  'Offers.Listings.MerchantInfo',
  'Offers.Listings.ProgramEligibility.IsAmazonFulfilled',
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseAmazonItem(item: any, partnerTag: string): ProductResult {
  const salePrice: number = item.Offers?.Listings?.[0]?.Price?.Amount ?? 0
  const isFree: boolean = item.Offers?.Listings?.[0]?.DeliveryInfo?.IsFreeShippingEligible ?? true
  const merchantName: string = item.Offers?.Listings?.[0]?.MerchantInfo?.Name ?? 'Amazon.co.jp'
  const isAmazonFulfilled: boolean = item.Offers?.Listings?.[0]?.ProgramEligibility?.IsAmazonFulfilled ?? false
  const asin: string = item.ASIN ?? ''
  const pointsEarned = Math.round(salePrice * 0.01)

  return {
    platform: 'amazon',
    title: item.ItemInfo?.Title?.DisplayValue ?? '',
    imageUrl: item.Images?.Primary?.Medium?.URL ?? '',
    shopName: merchantName,
    salePrice,
    shippingCost: isFree ? 0 : 490,
    couponDiscount: 0,
    pointRate: 1,
    pointsEarned,
    effectivePrice: calcAmazonEffectivePrice(salePrice, 0, false, false),
    subscribeAvailable: isAmazonFulfilled,
    rakutenCardEligible: false,
    teikiRates: null,
    affiliateUrl: `https://www.amazon.co.jp/dp/${asin}?tag=${partnerTag}`,
  }
}

export async function searchAmazon(keyword: string): Promise<ProductResult[]> {
  const tag = process.env.AMAZON_PARTNER_TAG!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await paCall('/paapi5/searchitems', 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems', {
    Keywords: keyword, Resources: RESOURCES, SearchIndex: 'All',
    PartnerTag: tag, PartnerType: 'Associates', Marketplace: 'www.amazon.co.jp',
  }) as any
  return (data.SearchResult?.Items ?? []).slice(0, 5).map((i: unknown) => parseAmazonItem(i, tag))
}

export async function lookupAmazon(asin: string): Promise<ProductResult | null> {
  const tag = process.env.AMAZON_PARTNER_TAG!
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await paCall('/paapi5/getitems', 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems', {
    ItemIds: [asin], Resources: RESOURCES,
    PartnerTag: tag, PartnerType: 'Associates', Marketplace: 'www.amazon.co.jp',
  }) as any
  const items = data.ItemsResult?.Items ?? []
  return items.length ? parseAmazonItem(items[0], tag) : null
}
