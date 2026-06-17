// Affiliate disclosure shown near comparison results. Amazon's Operating Agreement
// requires a clear, proximate disclosure of the Associate relationship.
export default function AffiliateDisclosure() {
  return (
    <p className="text-[9px] text-[var(--ink-soft)] leading-relaxed bg-[var(--cream)] border border-[var(--border)] rounded-lg px-3 py-2 mb-3">
      当サイトはAmazonアソシエイト・プログラムおよび楽天アフィリエイトの参加者です。
      リンクから商品が購入されると当サイトが収益を得る場合があります。
      <span className="italic block mt-0.5">
        As an Amazon Associate and Rakuten Affiliate, we earn from qualifying purchases.
      </span>
    </p>
  )
}
