export type Platform = 'amazon' | 'rakuten'

export interface ProductResult {
  platform: Platform
  title: string
  description?: string          // brief product description for LLM matching context
  imageUrl: string
  shopName: string
  salePrice: number            // displayed price, tax included (yen)
  shippingCost: number         // 送料; 0 if free shipping
  couponDiscount: number       // yen; 0 if no coupon
  pointRate: number            // Rakuten: API pointRate (e.g. 30 = SuperDEAL 30%); Amazon: always 1
  pointsEarned: number         // pre-calculated at SPU=1x, no toggles active
  effectivePrice: number       // pre-calculated at all defaults; recalculated client-side on toggle change
  subscribeAvailable: boolean  // Amazon: Subscribe & Save eligible; Rakuten: 定期購入 eligible
  rakutenCardEligible: boolean // Rakuten Card bonus applies (true for virtually all Rakuten items)
  teikiRates: { first: number; recurring: number } | null  // Rakuten only
  taxRate: 1.08 | 1.1                                      // 1.08 for food (軽減税率), 1.1 otherwise
  affiliateUrl: string
  // True when this is a link-only listing whose price/points cannot be shown
  // compliantly (Amazon during the pre-Creators-API gap). Such results are
  // rendered without a price, excluded from the cheapest-of comparison, and
  // never marked the winner.
  priceUnavailable?: boolean
  // Cross-platform pack-size relation vs the item the user is comparing against.
  // Set only on link-only Amazon candidate cards; 'exact' ≈ same pack, 'different' ≈
  // same product different pack. Omitted when size is not comparable.
  sizeMatch?: 'exact' | 'different'
}

export interface UserToggles {
  amazonSubscribeSave: boolean
  amazonPrimeBulk: boolean
  rakutenSPU: 1 | 3 | 5 | 10
  rakutenCard: boolean
  rakutenTeiki: 'off' | 'first' | 'recurring'
}

export const DEFAULT_TOGGLES: UserToggles = {
  amazonSubscribeSave: false,
  amazonPrimeBulk: false,
  rakutenSPU: 1,
  rakutenCard: false,
  rakutenTeiki: 'off',
}

export interface SearchResponse {
  mode: 'keyword-list' | 'comparison'
  // keyword-list mode: both platforms crawled in parallel
  rakutenResults: ProductResult[]
  amazonResults: ProductResult[]
  // comparison mode: URL paste result (single pair)
  results: ProductResult[]
  query: string
  cached: boolean
  explanation?: string         // LLM price-difference sentence (comparison mode, when a pair was found)
}
