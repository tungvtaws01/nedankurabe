'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const POPULAR = ['パンパース テープ', '明治ほほえみ', 'エルゴ抱っこ紐', 'おしりふき', 'ベビーカー']
// Recognizes full Amazon/Rakuten URLs AND Amazon mobile-share short links
// (amzn.asia/…, amzn.to/…, a.co/…) so a pasted short link routes to the URL
// flow (and triggers the preview), not the keyword search. The short-link hosts
// require a trailing "/" so "a.com" isn't mistaken for "a.co".
const URL_RE = /^(https?:\/\/)?(www\.)?amazon\.co\.jp|^(https?:\/\/)?item\.rakuten\.co\.jp|^(https?:\/\/)?(amzn\.asia|amzn\.to|amzn\.eu|amzn\.com|a\.co)\//

interface Preview {
  platform: 'amazon' | 'rakuten'
  title: string
  salePrice: number | null
  imageUrl: string
  shopName: string
  priceUnavailable?: boolean
}

export default function SearchBox() {
  const [input, setInput] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [navigating, setNavigating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const router = useRouter()

  const isUrl = URL_RE.test(input.trim())

  // Fetch preview whenever input changes to a URL
  useEffect(() => {
    const v = input.trim()
    if (!URL_RE.test(v)) {
      setPreview(null)
      setPreviewState('idle')
      abortRef.current?.abort()
      return
    }

    // Debounce 300ms to avoid fetching mid-paste
    const timer = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setPreview(null)
      setPreviewState('loading')
      try {
        const res = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: v }),
          signal: ctrl.signal,
        })
        if (!res.ok) { setPreviewState('error'); return }
        const data = await res.json() as Preview
        if (!ctrl.signal.aborted) {
          setPreview(data)
          setPreviewState('ready')
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setPreviewState('error')
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [input])

  function navigate(value: string) {
    const v = value.trim()
    if (!v) return
    setNavigating(true)
    if (URL_RE.test(v)) {
      router.push(`/results?url=${encodeURIComponent(v)}`)
    } else {
      router.push(`/results?q=${encodeURIComponent(v)}`)
    }
  }

  // For keyword input: button always enabled when there's text
  // For URL input: button enabled only when preview is ready
  const canCompare = isUrl ? previewState === 'ready' : !!input.trim()
  const buttonLabel = navigating ? '...' : isUrl && previewState === 'loading' ? '確認中…' : '比較'

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-[var(--border)]">
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canCompare && navigate(input)}
            placeholder="Amazon/楽天のURL、または商品名（例：パンパース Sサイズ）を入力"
            className="flex-1 rounded-xl border border-[var(--border)] bg-[var(--cream)] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ink)]"
          />
          <button
            onClick={() => navigate(input)}
            disabled={navigating || !canCompare}
            className="bg-[var(--ink)] text-white rounded-xl px-4 py-2.5 text-sm font-bold whitespace-nowrap disabled:opacity-40 transition-opacity"
          >
            {buttonLabel}
          </button>
        </div>

        {/* URL preview area */}
        {isUrl && (
          <div className="mt-3 rounded-xl border border-[var(--border)] overflow-hidden">
            {previewState === 'loading' && (
              <div className="flex items-center gap-3 p-3 bg-[var(--cream)]">
                <div className="w-12 h-12 rounded-lg bg-gray-200 animate-pulse shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
                  <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
                  <div className="h-4 bg-gray-200 rounded animate-pulse w-1/4" />
                </div>
              </div>
            )}
            {previewState === 'error' && (
              <div className="p-3 bg-red-50 text-xs text-red-600 text-center">
                商品が見つかりませんでした。URLを確認してください。
              </div>
            )}
            {previewState === 'ready' && preview && (
              <div className="flex items-center gap-3 p-3 bg-[var(--cream)]">
                {preview.imageUrl && (
                  <img
                    src={preview.imageUrl}
                    alt={preview.title}
                    className="w-12 h-12 object-contain rounded-lg border border-[var(--border)] bg-white shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                      preview.platform === 'amazon'
                        ? 'bg-[var(--amazon)] text-[var(--amazon-accent)]'
                        : 'bg-[var(--red)] text-white'
                    }`}>
                      {preview.platform === 'amazon' ? 'Amazon' : '楽天'}
                    </span>
                    <span className="text-[10px] text-[var(--ink-soft)] truncate">{preview.shopName}</span>
                  </div>
                  <p className="text-xs font-semibold leading-snug line-clamp-2 mb-1">{preview.title}</p>
                  {preview.priceUnavailable || preview.salePrice == null ? (
                    <p className="text-[10px] text-[var(--ink-soft)]">Amazonで価格を確認</p>
                  ) : (
                    <p className="text-sm font-black text-[var(--red)]">¥{preview.salePrice.toLocaleString()}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-[var(--ink-soft)] text-center mt-2">
          URLを貼り付けるか、商品名で検索できます{' '}
          <span className="italic">Paste a URL or search by product name</span>
        </p>
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
