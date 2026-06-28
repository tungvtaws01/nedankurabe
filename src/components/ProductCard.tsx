import { ProductResult, UserToggles } from '@/lib/types'
import PriceBreakdown, { Row } from './PriceBreakdown'

function buildRows(r: ProductResult, t: UserToggles, pointsLoading: boolean): Row[] {
  if (r.priceUnavailable) return []
  const rows: Row[] = [{ labelJP: '定価', labelEN: 'List price', value: `¥${r.salePrice.toLocaleString()}` }]

  if (r.platform === 'amazon') {
    if (t.amazonSubscribeSave && r.subscribeAvailable) {
      const d = Math.round(r.salePrice * 0.05)
      rows.push({ labelJP: '定期おトク便', labelEN: 'Subscribe & Save', value: `－¥${d.toLocaleString()}`, negative: true })
    }
    if (r.couponDiscount > 0) {
      rows.push({ labelJP: 'クーポン', labelEN: 'Coupon', value: `－¥${r.couponDiscount.toLocaleString()}`, negative: true })
    }
    const rate = t.amazonPrimeBulk ? 3 : 1
    const pts = Math.round(r.salePrice * rate / 100)
    rows.push({ labelJP: `Amazonポイント(${rate}%)`, labelEN: 'Amazon Points', value: `－¥${pts.toLocaleString()}`, negative: true })
  } else {
    if (r.shippingCost > 0) {
      rows.push({ labelJP: '送料', labelEN: 'Shipping', value: `＋¥${r.shippingCost.toLocaleString()}` })
    }
    if (r.couponDiscount > 0) {
      rows.push({ labelJP: 'クーポン', labelEN: 'Coupon', value: `－¥${r.couponDiscount.toLocaleString()}`, negative: true })
    }
    if (pointsLoading) {
      rows.push({ labelJP: 'ポイント還元', labelEN: 'Points (live)', value: '', negative: true, loading: true })
    } else {
      const cardBonus = t.rakutenCard ? 2 : 0
      const effectiveRate = r.pointRate + (t.rakutenSPU - 1) + cardBonus
      const pts = Math.floor(Math.floor(r.salePrice / r.taxRate) * effectiveRate / 100)
      rows.push({ labelJP: `ポイント還元(${effectiveRate}%)`, labelEN: 'Points earned', value: `－¥${pts.toLocaleString()}`, negative: true })
    }
  }
  return rows
}

export default function ProductCard({ result, isWinner, toggles, pointsLoading, loading }: {
  result: ProductResult; isWinner: boolean; toggles: UserToggles; pointsLoading?: boolean; loading?: boolean
}) {
  const isAmazon = result.platform === 'amazon'

  // Skeleton: shown while the product page is still being crawled (e.g. an Amazon
  // URL lookup, ~5-14s). Renders the comparison-screen structure + the title we can
  // derive from the URL immediately, instead of a blank full-screen spinner.
  if (loading) {
    return (
      <div className="rounded-2xl p-4 mb-3 bg-white border-2 border-[var(--border)]">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${isAmazon
            ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
            : 'bg-[var(--red)] text-white'}`}>
            {isAmazon ? 'Amazon' : '楽天 Rakuten'}
          </span>
        </div>
        {result.title && (
          <p className="text-xs font-bold leading-snug mb-3 line-clamp-3">{result.title}</p>
        )}
        <div className="h-7 w-28 rounded bg-[var(--cream)] animate-pulse mb-3" />
        <div className="h-3 w-full rounded bg-[var(--cream)] animate-pulse mb-2" />
        <div className="h-3 w-2/3 rounded bg-[var(--cream)] animate-pulse mb-3" />
        <p className="text-[9px] text-blue-500 leading-relaxed animate-pulse">
          ⟳ 商品情報を取得中… Loading product
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl p-4 mb-3 ${isWinner
      ? 'bg-[var(--win-bg)] border-2 border-[var(--win-border)]'
      : 'bg-white border-2 border-[var(--border)]'}`}>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {isWinner && (
          <span className="bg-[var(--win-border)] text-yellow-900 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
            🏆 最安値 <span className="italic font-normal">Cheapest</span>
          </span>
        )}
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${isAmazon
          ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
          : 'bg-[var(--red)] text-white'}`}>
          {isAmazon ? 'Amazon' : '楽天 Rakuten'}
        </span>
        {result.sizeMatch === 'exact' && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-800">
            サイズ一致 <span className="font-normal italic">same size</span>
          </span>
        )}
        {result.sizeMatch === 'different' && (
          <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
            別容量 <span className="font-normal italic">different size</span>
          </span>
        )}
      </div>

      <div className="flex gap-3 mb-3">
        {result.imageUrl && (
          <img src={result.imageUrl} alt={result.title}
            className="w-16 h-16 object-contain rounded-lg border border-[var(--border)] shrink-0 bg-white" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-bold leading-snug mb-0.5 line-clamp-3">{result.title}</p>
          <p className="text-[10px] text-[var(--ink-soft)]">{result.shopName}</p>
        </div>
      </div>

      {result.priceUnavailable ? (
        <div className="bg-[var(--cream)] border border-[var(--border)] rounded-lg px-3 py-2 mb-3">
          <p className="text-[11px] text-[var(--ink-soft)] leading-relaxed">
            価格はAmazonでご確認ください
            <span className="italic ml-1">Check the current price on Amazon</span>
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-2xl font-black text-[var(--red)]"
              style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
              ¥{result.effectivePrice.toLocaleString()}
            </span>
            <span className="text-[10px] text-[var(--ink-soft)]">
              実質価格 <span className="italic">Effective price</span>
              {!isAmazon && !pointsLoading && result.pointRate <= 1 && result.couponDiscount === 0 && (
                <span className="ml-1 text-amber-600 font-medium not-italic">(キャンペーン除く)</span>
              )}
            </span>
          </div>
          <PriceBreakdown rows={buildRows(result, toggles, !isAmazon && !!pointsLoading)} total={result.effectivePrice} />
        </>
      )}

      {!isAmazon && !pointsLoading && result.pointRate <= 1 && result.couponDiscount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
          <p className="text-[10px] text-amber-800 leading-relaxed font-medium">
            ⚠️ スーパーDEAL・クーポン未反映
          </p>
          <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
            実質価格はキャンペーンポイント(例: 10%バック)を含みません。
            <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer"
              className="underline text-[var(--red)] ml-1 font-medium">
              楽天で実際のポイントを確認 →
            </a>
          </p>
        </div>
      )}
      {!isAmazon && pointsLoading && (
        <p className="text-[9px] text-blue-500 mb-2 leading-relaxed animate-pulse">
          ⟳ スーパーDEAL・クーポン情報を取得中… Fetching live points
        </p>
      )}

      {result.affiliateUrl ? (
        <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer sponsored"
          className={`block w-full text-center py-3 rounded-xl text-xs font-bold ${isAmazon
            ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
            : 'bg-[var(--red)] text-white'}`}>
          {isAmazon ? 'Amazonで見る' : '楽天で購入する'} →
          <span className="italic ml-1 opacity-70 font-normal">
            {isAmazon ? 'View on Amazon' : 'Buy on Rakuten'}
          </span>
        </a>
      ) : (
        <p className="text-[10px] text-[var(--ink-soft)] text-center py-2">リンクは現在利用できません</p>
      )}
    </div>
  )
}
