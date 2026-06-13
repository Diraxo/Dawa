import type { Metadata, Viewport } from 'next'
import { Montserrat } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'CareHub — Trusted Care. Anywhere. Always.',
  description: 'Connect with verified doctors via chat, phone, or video call. Available 24/7 from any device.',
  keywords: ['telemedicine', 'online doctor', 'healthcare', 'consultation', 'Ethiopia', 'Africa'],
  icons: { icon: '/logo.png', apple: '/logo.png' },
  openGraph: {
    title: 'CareHub — Trusted Care. Anywhere. Always.',
    description: 'Connect with verified doctors in minutes. Chat, phone, or video consultations.',
    type: 'website',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1A4598',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning className={montserrat.variable}>
        <body className="font-montserrat bg-white text-ink-black antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
