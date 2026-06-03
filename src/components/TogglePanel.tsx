'use client'
import { UserToggles } from '@/lib/types'

interface Props {
  toggles: UserToggles
  onChange: (t: UserToggles) => void
  amazonSubscribeAvailable: boolean
  rakutenSubscribeAvailable: boolean
}

export default function TogglePanel({ toggles, onChange, amazonSubscribeAvailable, rakutenSubscribeAvailable }: Props) {
  const set = (patch: Partial<UserToggles>) => onChange({ ...toggles, ...patch })

  return (
    <div className="bg-white border border-[var(--border)] rounded-xl p-3 mb-4 text-xs space-y-3">
      {/* Amazon */}
      <div>
        <p className="font-bold text-[10px] uppercase tracking-wide text-[var(--ink-soft)] mb-1.5">Amazon</p>
        {amazonSubscribeAvailable && (
          <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
            <input type="checkbox" checked={toggles.amazonSubscribeSave}
              onChange={e => set({ amazonSubscribeSave: e.target.checked })} className="rounded" />
            <span>定期おトク便 <span className="italic text-[var(--ink-soft)]">Subscribe & Save ~5% off</span></span>
          </label>
        )}
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={toggles.amazonPrimeBulk}
            onChange={e => set({ amazonPrimeBulk: e.target.checked })} className="rounded" />
          <span>Primeまとめ買い <span className="italic text-[var(--ink-soft)]">+2% points (5+ items)</span></span>
        </label>
      </div>

      {/* Rakuten */}
      <div>
        <p className="font-bold text-[10px] uppercase tracking-wide text-[var(--ink-soft)] mb-1.5">楽天 Rakuten</p>
        <div className="flex items-center gap-2 mb-1.5">
          <span>ポイント倍率 <span className="italic text-[var(--ink-soft)]">SPU level</span></span>
          <div className="flex gap-1 ml-auto">
            {([1, 3, 5, 10] as const).map(v => (
              <button key={v} onClick={() => set({ rakutenSPU: v })}
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                  toggles.rakutenSPU === v
                    ? 'bg-[var(--ink)] text-white border-[var(--ink)]'
                    : 'bg-white text-[var(--ink-soft)] border-[var(--border)]'
                }`}>{v}x</button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 mb-1.5 cursor-pointer">
          <input type="checkbox" checked={toggles.rakutenCard}
            onChange={e => set({ rakutenCard: e.target.checked })} className="rounded" />
          <span>楽天カードで支払う <span className="italic text-[var(--ink-soft)]">Pay with Rakuten Card (+2%)</span></span>
        </label>
        {rakutenSubscribeAvailable && (
          <div className="flex items-center gap-2">
            <span>定期購入 <span className="italic text-[var(--ink-soft)]">Subscription</span></span>
            <select value={toggles.rakutenTeiki}
              onChange={e => set({ rakutenTeiki: e.target.value as UserToggles['rakutenTeiki'] })}
              className="ml-auto text-[10px] border border-[var(--border)] rounded px-1 py-0.5 bg-white">
              <option value="off">off</option>
              <option value="first">初回 −10% (first order)</option>
              <option value="recurring">2回目以降 −5% (recurring)</option>
            </select>
          </div>
        )}
      </div>
    </div>
  )
}
