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
      {/* Desktop sidebar */}
      <div className="hidden lg:block flex-shrink-0">{sidebar}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute left-0 top-0 h-full overflow-y-auto shadow-xl"
            onClick={() => setOpen(false)}
          >
            {sidebar}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-40 flex items-center gap-3 bg-white border-b border-steel-grey px-4 h-14">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="w-10 h-10 -ml-2 flex items-center justify-center text-ink-black"
          >
            <Menu size={22} />
          </button>
          <LogoMark size={28} />
          <span className="font-montserrat font-bold text-base text-ink-black">
            CARE<span className="text-teal-green">HUB</span>
          </span>
        </header>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
