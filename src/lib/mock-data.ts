import { ProductResult } from '@/lib/types'

// Mock pair: a priced Rakuten item + a link-only Amazon item (no price shown).

export const MOCK_RESULTS: ProductResult[] = [
  {
    platform: 'amazon',
    title: 'パンパース テープ Sサイズ はじめての肌へのいちばん 82枚',
    imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/rakuten24/cabinet/gu3/4987176206206.jpg',
    shopName: 'Amazon.co.jp',
    salePrice: 2178,
    shippingCost: 0,
    couponDiscount: 0,
    pointRate: 1,
    // round(2178 × 0.01) = 22
    pointsEarned: 22,
    // 2178 − 22 = 2156
    effectivePrice: 2156,
    subscribeAvailable: true,
    rakutenCardEligible: false,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: 'https://www.amazon.co.jp/dp/B0CCJ3KBN3?tag=nedankurabe-22',
    priceUnavailable: true,
  },
  {
    platform: 'rakuten',
    title: 'パンパース オムツ はじめての肌へのいちばん テープ Sサイズ 82枚入',
    imageUrl: 'https://thumbnail.image.rakuten.co.jp/@0_mall/rakuten24/cabinet/gu3/4987176206206.jpg',
    shopName: '楽天24 ベビー館',
    salePrice: 2400,
    shippingCost: 0,
    couponDiscount: 0,
    // 10% point campaign (includes base 1%)
    pointRate: 10,
    // floor(floor(2400/1.1) × 10/100) = floor(2181 × 0.10) = 218
    pointsEarned: 218,
    // 2400 − 218 = 2182  (¥26 more than Amazon at default)
    effectivePrice: 2182,
    subscribeAvailable: false,
    rakutenCardEligible: true,
    teikiRates: null,
    taxRate: 1.1,
    affiliateUrl: 'https://item.rakuten.co.jp/rakuten24/4987176206206/',
  },
]
