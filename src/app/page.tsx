import SearchBox from '@/components/SearchBox'

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black" style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ねだん<span className="text-[var(--red)]">くらべ</span>
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">Amazon・楽天 最安値かんたん比較</p>
        <p className="text-xs italic text-[var(--ink-soft)] mt-0.5">
          Easy cheapest price comparison across Amazon &amp; Rakuten
        </p>
      </div>
      <SearchBox />
    </main>
  )
}
