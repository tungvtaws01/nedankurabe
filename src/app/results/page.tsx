'use client'
import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, useRef, Suspense } from 'react'
import { flushSync } from 'react-dom'
import { ProductResult, UserToggles, DEFAULT_TOGGLES } from '@/lib/types'
import { recalcWithToggles } from '@/lib/price/normalize'
import { isComparablePair } from '@/lib/price/explain'
import ProductCard from '@/components/ProductCard'
import TogglePanel from '@/components/TogglePanel'
import KeywordResultsList from '@/components/KeywordResultsList'
import PriceExplanation from '@/components/PriceExplanation'
import AffiliateDisclosure from '@/components/AffiliateDisclosure'

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
  const [amazonPool, setAmazonPool] = useState<ProductResult[]>([])
  const [rawResults, setRawResults] = useState<ProductResult[]>([])
  const [mode, setMode] = useState<'keyword-list' | 'comparison' | null>(null)
  const [toggles, setToggles] = useState<UserToggles>(DEFAULT_TOGGLES)
  const [loading, setLoading] = useState(true)
  const [loadingMessage, setLoadingMessage] = useState('検索中…')
  const [livePointsLoading, setLivePointsLoading] = useState(false)
  const [crossSearching, setCrossSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [explanation, setExplanation] = useState<string | null>(null)
  const sseAbortRef = useRef<{ abort: () => void } | null>(null)
  // Incremented on every handleBack() or new load(); async callbacks check this
  // before applying results so stale responses can't flip the UI back.
  const opIdRef = useRef(0)

  useEffect(() => { setToggles(loadToggles()) }, [])

  useEffect(() => {
    async function load() {
      const opId = ++opIdRef.current
      setLoading(true); setLoadingMessage('検索中…'); setError(null)
      setPickList([]); setRawResults([]); setAmazonPool([])
      setLivePointsLoading(false); setCrossSearching(false)
      setExplanation(null)

      // URL lookup: use SSE stream so basic results appear fast, live points follow
      if (url) {
        try {
          const res = await fetch('/api/lookup/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
          })
          if (!res.ok || !res.body) {
            const data = await res.json() as { error?: string }
            setError(data.error ?? '検索中にエラーが発生しました。')
            return
          }
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (opIdRef.current !== opId) { reader.cancel(); break }
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const event = JSON.parse(line.slice(6)) as {
                  type: string
                  results?: ProductResult[]
                  result?: ProductResult
                  cached?: boolean
                  message?: string
                  text?: string
                }
                if (opIdRef.current !== opId) break
                if (event.type === 'partial') {
                  const results = event.results ?? []
                  const hasRakuten = results.some(r => r.platform === 'rakuten')
                  flushSync(() => {
                    setRawResults(results)
                    setMode('comparison')
                    setLoading(false)
                    setCrossSearching(true)
                    if (hasRakuten) setLivePointsLoading(true)
                  })
                } else if (event.type === 'basic') {
                  const results = event.results ?? []
                  const hasRakuten = results.some(r => r.platform === 'rakuten')
                  flushSync(() => {
                    setRawResults(results)
                    setMode('comparison')
                    setLoading(false)
                    setCrossSearching(false)
                    if (hasRakuten && !event.cached) setLivePointsLoading(true)
                    else if (event.cached) setLivePointsLoading(false)
                  })
                } else if (event.type === 'live-points' && event.result) {
                  flushSync(() => {
                    setRawResults(prev => prev.map(r => r.platform === 'rakuten' ? event.result! : r))
                    setLivePointsLoading(false)
                  })
                } else if (event.type === 'explanation') {
                  setExplanation(event.text ?? null)
                } else if (event.type === 'status') {
                  setLoadingMessage(event.message ?? '検索中…')
                } else if (event.type === 'done') {
                  setCrossSearching(false)
                  setLivePointsLoading(false)
                } else if (event.type === 'error') {
                  flushSync(() => {
                    setError(event.message ?? 'エラーが発生しました。')
                    setLoading(false)
                    setCrossSearching(false)
                  })
                }
              } catch { /* ignore malformed lines */ }
            }
          }
        } catch {
          if (opIdRef.current === opId) {
            setError('検索中にエラーが発生しました。もう一度お試しください。')
          }
        } finally {
          if (opIdRef.current === opId) {
            setLoading(false)
            setLivePointsLoading(false)
          }
        }
        return
      }

      // Keyword search: SSE stream — Rakuten appears in ~1s, Amazon appends ~8s later
      let abortedByUser = false
      const controller = new AbortController()
      sseAbortRef.current = {
        abort: () => { abortedByUser = true; controller.abort() },
      }
      try {
        const res = await fetch('/api/search/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          const data = await res.json() as { error?: string }
          setError(data.error ?? '検索中にエラーが発生しました。')
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string
                results?: ProductResult[]
                cached?: boolean
              }
              if (event.type === 'rakuten') {
                flushSync(() => {
                  setPickList(event.results ?? [])
                  setMode('keyword-list')
                  setLoading(false)
                  if (!event.cached) setCrossSearching(true)
                })
              } else if (event.type === 'amazon') {
                flushSync(() => {
                  setAmazonPool(event.results ?? [])
                  setCrossSearching(false)
                })
              } else if (event.type === 'done') {
                setCrossSearching(false)
              }
            } catch { /* ignore malformed lines */ }
          }
        }
      } catch (e) {
        if (abortedByUser) return
        if ((e as { name?: string })?.name !== 'AbortError') {
          setError('検索中にエラーが発生しました。もう一度お試しください。')
        }
      } finally {
        sseAbortRef.current = null
        if (!abortedByUser) {
          setLoading(false)
          setCrossSearching(false)
        }
      }
    }
    if (query || url) load()
  }, [query, url])

  async function handlePickSelect(selected: ProductResult) {
    sseAbortRef.current?.abort()
    const opId = ++opIdRef.current
    setError(null)
    setExplanation(null)

    // Show tapped item immediately — comparison screen appears without waiting for API
    setRawResults([selected])
    setCrossSearching(true)
    setMode('comparison')
    // Rakuten taps fetch live points; show the points skeleton until they arrive.
    if (selected.platform === 'rakuten') setLivePointsLoading(true)

    if (selected.platform === 'rakuten') {
      // Rakuten tap: stream enrich-compare so the comparison appears when the Amazon
      // match resolves (~5-8s) instead of blocking on the live-points crawl (up to 40s).
      try {
        const res = await fetch('/api/enrich-compare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: selected, candidates: amazonPool }),
        })
        if (!res.ok || !res.body) {
          if (opIdRef.current === opId) {
            setError('比較中にエラーが発生しました。もう一度お試しください。')
            setCrossSearching(false); setLivePointsLoading(false)
          }
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (opIdRef.current !== opId) { reader.cancel(); break }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as {
                type: string; results?: ProductResult[]; result?: ProductResult; text?: string; message?: string
              }
              if (opIdRef.current !== opId) break
              if (event.type === 'basic') {
                flushSync(() => {
                  setRawResults(event.results ?? [selected])
                  setCrossSearching(false)
                })
              } else if (event.type === 'live-points' && event.result) {
                flushSync(() => {
                  setRawResults(prev => prev.map(r => r.platform === 'rakuten' ? event.result! : r))
                  setLivePointsLoading(false)
                })
              } else if (event.type === 'explanation') {
                setExplanation(event.text ?? null)
              } else if (event.type === 'done') {
                flushSync(() => { setCrossSearching(false); setLivePointsLoading(false) })
              } else if (event.type === 'error') {
                flushSync(() => {
                  setError(event.message ?? 'エラーが発生しました。')
                  setCrossSearching(false); setLivePointsLoading(false)
                })
              }
            } catch { /* ignore malformed lines */ }
          }
        }
      } catch {
        if (opIdRef.current === opId) {
          setCrossSearching(false); setLivePointsLoading(false)
          setError('比較中にエラーが発生しました。もう一度お試しください。')
        }
      }
      return
    }

    // Amazon tap: match against the Rakuten pick-list (single blocking call — no
    // live-points crawl on this path, so the slow operation streaming targets is absent).
    try {
      const res = await fetch('/api/find-amazon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: selected, candidates: pickList }),
      })
      const data = await res.json() as { result: ProductResult | null; explanation?: string | null }
      if (opIdRef.current !== opId) return
      const results = [selected, ...(data.result ? [data.result] : [])]
        .sort((a, b) => a.effectivePrice - b.effectivePrice)
      setRawResults(results)
      setExplanation(data.explanation ?? null)
      setCrossSearching(false)
    } catch {
      if (opIdRef.current === opId) {
        setCrossSearching(false)
        setError('比較中にエラーが発生しました。もう一度お試しください。')
      }
    }
  }

  function handleBack() {
    opIdRef.current++
    setMode('keyword-list'); setRawResults([]); setError(null)
    setExplanation(null)
  }

  function handleToggles(t: UserToggles) {
    setToggles(t)
    localStorage.setItem('nedankurabe_toggles', JSON.stringify(t))
  }

  const ranked = recalcWithToggles(rawResults, toggles)
  // The bundled sentence reflects DEFAULT toggle settings. If a toggle changes the
  // winner or the gap, the sentence's numbers would be stale → fall back to bullets.
  const defaultRanked = recalcWithToggles(rawResults, DEFAULT_TOGGLES)
  const comparable = ranked.length === 2 && isComparablePair(ranked[0], ranked[1])
  const winnerUnchanged =
    ranked.length === 2 && defaultRanked.length === 2 &&
    ranked[0].affiliateUrl === defaultRanked[0].affiliateUrl
  const defaultGap = defaultRanked.length === 2 ? defaultRanked[1].effectivePrice - defaultRanked[0].effectivePrice : null
  const currentGap = ranked.length === 2 ? ranked[1].effectivePrice - ranked[0].effectivePrice : null
  const showSentence = comparable && !!explanation && winnerUnchanged && defaultGap === currentGap

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
        <div className="text-center py-20">
          <p className="text-sm text-[var(--ink-soft)] animate-pulse">{loadingMessage}</p>
          <p className="text-xs text-[var(--ink-soft)] mt-1 italic opacity-60">Searching…</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && mode === 'keyword-list' && (
        <>
          {crossSearching && (
            <p className="text-center text-xs text-blue-500 animate-pulse mb-2">
              ⟳ Amazonの商品も検索中… Searching Amazon
            </p>
          )}
          <KeywordResultsList
            results={[...pickList, ...amazonPool].sort((a, b) =>
              (a.priceUnavailable ? 1 : 0) - (b.priceUnavailable ? 1 : 0) || a.salePrice - b.salePrice)}
            query={query ?? ''}
            onSelect={handlePickSelect}
          />
        </>
      )}

      {!loading && !error && mode === 'comparison' && ranked.length > 0 && (
        <>
          <TogglePanel
            toggles={toggles}
            onChange={handleToggles}
            amazonSubscribeAvailable={rawResults.some(r => r.platform === 'amazon' && r.subscribeAvailable)}
            rakutenSubscribeAvailable={rawResults.some(r => r.platform === 'rakuten' && r.subscribeAvailable)}
          />
          <AffiliateDisclosure />
          {ranked.length === 1 && crossSearching && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-3 text-xs text-blue-600 text-center animate-pulse">
              {ranked[0].platform === 'rakuten'
                ? '⟳ Amazonで同等商品を検索中… Searching Amazon'
                : '⟳ 楽天で同等商品を検索中… Searching Rakuten'}
            </div>
          )}
          {ranked.length === 1 && !crossSearching && (
            <div className="bg-[var(--cream)] border border-[var(--border)] rounded-xl p-3 mb-3 text-xs text-[var(--ink-soft)] text-center">
              {ranked[0].platform === 'rakuten'
                ? 'Amazonで同等商品が見つかりませんでした。 Amazon equivalent not found.'
                : '楽天で同等商品が見つかりませんでした。 Rakuten equivalent not found.'}
            </div>
          )}
          {comparable && (
            <PriceExplanation
              winner={ranked[0]}
              loser={ranked[1]}
              explanation={showSentence && explanation ? explanation : undefined}
            />
          )}
          {ranked.map((r, i) => (
            <ProductCard
              key={`${r.platform}:${r.affiliateUrl || r.title}`}
              result={r}
              isWinner={comparable && i === 0}
              toggles={toggles}
              pointsLoading={livePointsLoading && r.platform === 'rakuten'}
              loading={r.salePrice === 0 && !r.priceUnavailable}
            />
          ))}
          <p className="text-center text-[9px] text-[var(--ink-soft)] mt-4 leading-relaxed">
            ※ 価格・ポイントは取得時点のものです<br />
            <span className="italic">Prices and points are as of retrieval time. Verify on each site before purchasing.</span>
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
