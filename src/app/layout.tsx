import type { Metadata } from 'next'
import { Noto_Sans_JP } from 'next/font/google'
import Footer from '@/components/Footer'
import './globals.css'

const noto = Noto_Sans_JP({
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  variable: '--font-noto',
})

export const metadata: Metadata = {
  title: 'ねだんくらべ — Amazon・楽天 最安値比較',
  description: 'Amazon と楽天市場の最安値を実質価格で比較します。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Dela+Gothic+One&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className={`${noto.variable} font-sans antialiased`}>
        {children}
        <Footer />
      </body>
    </html>
  )
}
