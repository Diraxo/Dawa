'use client'

import { useState } from 'react'
import { Menu } from 'lucide-react'
import LogoMark from '@/components/ui/LogoMark'

// Wraps a sidebar + main content so the sidebar collapses into a hamburger
// drawer on screens below lg (works down to the smallest phones).
export default function ResponsiveShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-cloud-grey">
      {/* Skip to main content (keyboard / screen reader) */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:px-4 focus:py-2 focus:bg-white focus:text-care-blue focus:font-semibold focus:rounded-lg focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <div className="hidden lg:block flex-shrink-0" role="navigation" aria-label="Main navigation">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute left-0 top-0 h-full overflow-y-auto shadow-xl"
            role="navigation"
            aria-label="Main navigation"
          >
            {sidebar}
            <button
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="sr-only focus:not-sr-only"
            >
              Close
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 bg-white border-b border-steel-grey px-4 h-14" role="banner">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="w-10 h-10 -ml-2 flex items-center justify-center text-ink-black"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
          <LogoMark size={28} variant="dark" />
          <span className="font-montserrat font-bold text-base text-ink-black" aria-label="Dawa">
            DA<span className="text-teal-green">WA</span>
          </span>
        </header>

        <main id="main-content" className="flex-1 overflow-auto" role="main" tabIndex={-1}>{children}</main>
      </div>
    </div>
  )
}
