import { ReactNode } from 'react'
import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

interface AuthCardProps {
  children: ReactNode
  title: string
  subtitle: string
}

export function AuthCard({ children, title, subtitle }: AuthCardProps) {
  return (
    <div className="min-h-screen bg-cloud-grey flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 justify-center mb-8">
          <LogoMark size={40} />
          <span className="font-montserrat font-bold text-2xl text-ink-black">
            CARE<span className="text-teal-green">HUB</span>
          </span>
        </Link>

        <div className="card p-8">
          <div className="text-center mb-8">
            <h1 className="font-montserrat font-black text-3xl text-ink-black mb-2">{title}</h1>
            <p className="text-ink-black/60 text-sm">{subtitle}</p>
          </div>
          {children}
        </div>

        <p className="text-center text-xs text-ink-black/40 mt-6">
          TRUSTED CARE. ANYWHERE. ALWAYS.
        </p>
      </div>
    </div>
  )
}
