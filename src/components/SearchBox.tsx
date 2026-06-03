'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

const POPULAR = ['パンパース テープ', '明治ほほえみ', 'エルゴ抱っこ紐', 'おしりふき', 'ベビーカー']
const URL_RE = /^https?:\/\/(www\.amazon\.co\.jp|item\.rakuten\.co\.jp)/

export default function SearchBox() {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  function navigate(value: string) {
    const v = value.trim()
    if (!v) return
    setLoading(true)
    if (URL_RE.test(v)) {
      router.push(`/results?url=${encodeURIComponent(v)}`)
    } else {
      router.push(`/results?q=${encodeURIComponent(v)}`)
    }
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-[var(--border)]">
        <p className="text-xs text-[var(--ink-soft)] mb-2">
          🔍 商品名で検索 <span className="italic">Search by product name</span>
        </p>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && navigate(input)}
            placeholder="例：パンパース テープ Sサイズ"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--cream)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]"
          />
          <button
            onClick={() => navigate(input)}
            disabled={loading || !input.trim()}
            className="bg-[var(--ink)] text-white rounded-xl px-4 py-2.5 text-sm font-bold whitespace-nowrap disabled:opacity-40"
          >
            {loading ? '...' : '最安値を調べる'}
          </button>
        </div>
        <div className="text-center text-xs text-[var(--ink-soft)] my-2">— または / or —</div>
        <div className="border border-dashed border-[var(--border)] rounded-xl p-3 text-center text-xs text-[var(--ink-mid)]">
          🔗 Amazon・楽天の商品URLを貼り付けると自動で比較します
          <span className="block italic text-[10px] text-[var(--ink-soft)] mt-0.5">
            Paste a product URL from Amazon or Rakuten to compare automatically
          </span>
        </div>
      </div>

      <div className="mt-5">
        <p className="text-xs text-[var(--ink-soft)] mb-2">
          よく検索されています <span className="italic">Popular searches</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {POPULAR.map(tag => (
            <button key={tag} onClick={() => navigate(tag)}
              className="bg-white border border-[var(--border)] rounded-full px-3 py-1 text-xs text-[var(--ink-mid)] hover:bg-[var(--cream)]">
              {tag}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 mt-5">
        <div className="flex-1 bg-[var(--amazon)] text-[var(--amazon-accent)] rounded-lg py-2 text-center text-xs font-bold">Amazon JP</div>
        <div className="flex-1 bg-[var(--red)] text-white rounded-lg py-2 text-center text-xs font-bold">楽天市場 Rakuten</div>
      </div>
    </div>
  )
}
