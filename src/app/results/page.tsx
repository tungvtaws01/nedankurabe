'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { ProductResult, UserToggles, DEFAULT_TOGGLES, SearchResponse } from '@/lib/types'
import { recalcWithToggles } from '@/lib/price/normalize'
import ProductCard from '@/components/ProductCard'
import TogglePanel from '@/components/TogglePanel'
import KeywordResultsList from '@/components/KeywordResultsList'

function loadToggles(): UserToggles {
  if (typeof window === 'undefined') return DEFAULT_TOGGLES
  try { return JSON.parse(localStorage.getItem('nedankurabe_toggles') ?? 'null') ?? DEFAULT_TOGGLES }
  catch { return DEFAULT_TOGGLES }
}

function ResultsContent() {
  const params = useSearchParams()
  const router = useRouter()
  const query = params.get('q')
  const url = params.get('url')

  const [pickList, setPickList] = useState<ProductResult[]>([])
  const [rawResults, setRawResults] = useState<ProductResult[]>([])
  const [mode, setMode] = useState<'keyword-list' | 'comparison' | null>(null)
  const [toggles, setToggles] = useState<UserToggles>(DEFAULT_TOGGLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setToggles(loadToggles()) }, [])

  useEffect(() => {
    async function load() {
      setLoading(true); setError(null); setPickList([]); setRawResults([])
      try {
        const [endpoint, body] = url
          ? ['/api/lookup', { url }]
          : ['/api/search', { query }]
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json() as SearchResponse & { error?: string }
        if (!res.ok) { setError(data.error ?? '検索中にエラーが発生しました。'); return }
        if (data.mode === 'keyword-list') {
          setPickList(data.results ?? [])
          setMode('keyword-list')
        } else {
          setRawResults(data.results ?? [])
          setMode('comparison')
        }
      } catch {
        setError('検索中にエラーが発生しました。もう一度お試しください。')
      } finally {
        setLoading(false)
      }
    }
    if (query || url) load()
  }, [query, url])

  async function handlePickSelect(selected: ProductResult) {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/find-amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: selected.title }),
      })
      const data = await res.json() as { result: ProductResult | null }
      const results = [selected, ...(data.result ? [data.result] : [])]
        .sort((a, b) => a.effectivePrice - b.effectivePrice)
      setRawResults(results)
      setMode('comparison')
    } catch {
      setError('比較中にエラーが発生しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setMode('keyword-list')
    setRawResults([])
    setError(null)
  }

  function handleToggles(t: UserToggles) {
    setToggles(t)
    localStorage.setItem('nedankurabe_toggles', JSON.stringify(t))
  }

  const ranked = recalcWithToggles(rawResults, toggles)

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-[var(--border)]">
        <button
          onClick={mode === 'comparison' && pickList.length > 0 ? handleBack : () => router.push('/')}
          className="w-8 h-8 bg-white border border-[var(--border)] rounded-lg flex items-center justify-center text-sm shrink-0"
        >
          ←
        </button>
        <div className="min-w-0">
          <p className="text-[10px] text-[var(--ink-soft)]">
            {mode === 'comparison' && pickList.length > 0
              ? '← 検索結果に戻る Return to results'
              : '検索ワード Search'}
          </p>
          <p className="text-sm font-bold truncate">{query ?? url}</p>
        </div>
      </div>

      {loading && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          検索中… <span className="italic">Searching...</span>
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && mode === 'keyword-list' && (
        <KeywordResultsList
          results={pickList}
          query={query ?? ''}
          onSelect={handlePickSelect}
        />
      )}

      {!loading && !error && mode === 'comparison' && ranked.length > 0 && (
        <>
          <TogglePanel
            toggles={toggles}
            onChange={handleToggles}
            amazonSubscribeAvailable={rawResults.some(r => r.platform === 'amazon' && r.subscribeAvailable)}
            rakutenSubscribeAvailable={rawResults.some(r => r.platform === 'rakuten' && r.subscribeAvailable)}
          />
          {ranked.map((r, i) => (
            <ProductCard key={r.affiliateUrl} result={r} isWinner={i === 0} toggles={toggles} />
          ))}
          <p className="text-center text-[9px] text-[var(--ink-soft)] mt-4 leading-relaxed">
            ※ 価格・ポイントは取得時点のものです<br />
            <span className="italic">
              Prices and points are as of retrieval time. Verify on each site before purchasing.
            </span>
          </p>
        </>
      )}

      {!loading && !error && mode === 'comparison' && ranked.length === 0 && (
        <p className="text-center py-20 text-sm text-[var(--ink-soft)]">
          商品が見つかりませんでした。<br />
          <span className="italic text-xs">No products found. Try a different keyword.</span>
        </p>
      )}
    </main>
  )
}

export default function ResultsPage() {
  return (
    <Suspense fallback={<p className="text-center py-20 text-sm text-[var(--ink-soft)]">読み込み中…</p>}>
      <ResultsContent />
    </Suspense>
  )
}
