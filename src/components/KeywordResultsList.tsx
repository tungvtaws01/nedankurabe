// src/components/KeywordResultsList.tsx
import { ProductResult } from '@/lib/types'

interface Props {
  results: ProductResult[]
  query: string
  onSelect: (result: ProductResult) => void
}

export default function KeywordResultsList({ results, query, onSelect }: Props) {
  return (
    <div>
      <p className="text-[10px] text-[var(--ink-soft)] mb-3">
        「{query}」の検索結果{' '}
        <span className="italic">— 比較したい商品を選んでください / Select a product to compare</span>
      </p>

      {results.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}

      <div className="space-y-2">
        {results.map((r) => (
          <button
            key={r.affiliateUrl}
            onClick={() => onSelect(r)}
            className="w-full text-left bg-white border-2 border-[var(--border)] rounded-2xl p-3 flex gap-3 items-center hover:border-[var(--ink)] transition-colors active:bg-[var(--cream)]"
          >
            {r.imageUrl && (
              <img
                src={r.imageUrl}
                alt={r.title}
                className="w-14 h-14 object-contain rounded-lg border border-[var(--border)] shrink-0 bg-white"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold leading-snug line-clamp-3 mb-0.5">{r.title}</p>
              <p className="text-[10px] text-[var(--ink-soft)]">{r.shopName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-base font-black text-[var(--red)]">¥{r.salePrice.toLocaleString()}</p>
              {r.shippingCost === 0 && (
                <p className="text-[9px] text-green-600">送料無料</p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
