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
  title: 'ベビトク — ベビー用品の最安値比較',
  description: 'ベビー用品の実質価格を Amazon・楽天 でまとめて比較。かしこくおトクに。',
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
