import SearchBox from '@/components/SearchBox'

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-black" style={{ fontFamily: '"Dela Gothic One", sans-serif' }}>
          ベビ<span className="text-[var(--red)]">トク</span>
        </h1>
        <p className="text-sm text-[var(--ink-soft)] mt-1">ベビー用品を、かしこくおトクに。</p>
        <p className="text-xs italic text-[var(--ink-soft)] mt-0.5">
          ベビー用品の実質価格を Amazon・楽天 でまとめて比較
        </p>
      </div>
      <SearchBox />
    </main>
  )
}
