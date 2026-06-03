interface Row { labelJP: string; labelEN: string; value: string; negative?: boolean }
interface Props { rows: Row[]; total: number }

export default function PriceBreakdown({ rows, total }: Props) {
  return (
    <div className="bg-white/60 rounded-xl px-3 py-2 text-xs mb-3 space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex justify-between items-baseline">
          <span className="text-[var(--ink-soft)]">
            {row.labelJP} <span className="italic text-[9px]">{row.labelEN}</span>
          </span>
          <span className={`font-semibold ${row.negative ? 'text-[var(--red)]' : 'text-[var(--ink-mid)]'}`}>
            {row.value}
          </span>
        </div>
      ))}
      <div className="flex justify-between items-baseline border-t border-black/10 pt-1">
        <span className="font-bold text-[var(--ink-soft)]">
          実質価格 <span className="italic font-normal text-[9px]">Effective price</span>
        </span>
        <span className="font-bold text-[var(--red)]">¥{total.toLocaleString()}</span>
      </div>
    </div>
  )
}
