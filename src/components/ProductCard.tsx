import { ProductResult, UserToggles } from '@/lib/types'
import PriceBreakdown, { Row } from './PriceBreakdown'

function buildRows(r: ProductResult, t: UserToggles): Row[] {
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
    const cardBonus = t.rakutenCard ? 2 : 0
    const effectiveRate = r.pointRate + (t.rakutenSPU - 1) + cardBonus
    const pts = Math.floor(Math.floor(r.salePrice / r.taxRate) * effectiveRate / 100)
    rows.push({ labelJP: `ポイント還元(${effectiveRate}%)`, labelEN: 'Points earned', value: `－¥${pts.toLocaleString()}`, negative: true })
  }
  return rows
}

export default function ProductCard({ result, isWinner, toggles }: {
  result: ProductResult; isWinner: boolean; toggles: UserToggles
}) {
  const isAmazon = result.platform === 'amazon'

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

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-2xl font-black text-[var(--red)]"
          style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ¥{result.effectivePrice.toLocaleString()}
        </span>
        <span className="text-[10px] text-[var(--ink-soft)]">
          実質価格 <span className="italic">Effective price</span>
        </span>
      </div>

      <PriceBreakdown rows={buildRows(result, toggles)} total={result.effectivePrice} />

      {!isAmazon && (
        <p className="text-[9px] text-[var(--ink-soft)] mb-2 leading-relaxed">
          ※ ポイントは基本1%のみ表示。スーパーDEAL・クーポンは含まれません。
          <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer"
            className="underline text-[var(--red)] ml-1 font-medium">
            実際のポイントを確認 →
          </a>
        </p>
      )}

      <a href={result.affiliateUrl} target="_blank" rel="noopener noreferrer"
        className={`block w-full text-center py-3 rounded-xl text-xs font-bold ${isAmazon
          ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
          : 'bg-[var(--red)] text-white'}`}>
        {isAmazon ? 'Amazonで購入する' : '楽天で購入する'} →
        <span className="italic ml-1 opacity-70 font-normal">
          {isAmazon ? 'Buy on Amazon' : 'Buy on Rakuten'}
        </span>
      </a>
    </div>
  )
}
