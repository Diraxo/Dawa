'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { useUser } from '@clerk/nextjs'
import LogoMark from '@/components/ui/LogoMark'

const links = [
  { label: 'Home', href: '#hero' },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Specialties', href: '#specialties' },
  { label: 'For Doctors', href: '#for-doctors' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const { isSignedIn, isLoaded } = useUser()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.nav
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-white/90 backdrop-blur-md shadow-card' : 'bg-transparent'
      }`}
    >
      <div className="container-site flex items-center justify-between h-[72px]">
        {/* Logo */}
        <Link href={isSignedIn ? '/dashboard' : '/'} className="flex items-center gap-2.5 group">
          <LogoMark size={36} />
          <span className={`font-montserrat font-bold text-xl transition-colors ${scrolled ? 'text-ink-black' : 'text-white'}`}>
            CARE<span className="text-teal-green">HUB</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          {links.map(l => (
            <a
              key={l.href}
              href={l.href}
              className={`font-montserrat font-medium text-sm transition-colors relative group ${
                scrolled ? 'text-ink-black/70 hover:text-care-blue' : 'text-white/80 hover:text-white'
              }`}
            >
              {l.label}
              <span className="absolute -bottom-0.5 left-0 w-0 h-0.5 bg-gradient-interactive rounded-full group-hover:w-full transition-all duration-300" />
            </a>
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {isLoaded && (
            isSignedIn ? (
              <Link href="/dashboard" className="btn-primary h-10 px-5 text-sm rounded-xl">
                Dashboard →
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="btn-outline h-10 px-5 text-sm rounded-xl">
                  Log in
                </Link>
                <Link href="/sign-up" className="btn-primary h-10 px-5 text-sm rounded-xl">
                  Get Started →
                </Link>
              </>
            )
          )}
        </div>

        {/* Hamburger */}
        <button
          onClick={() => setOpen(v => !v)}
          className="md:hidden flex flex-col gap-1.5 p-2"
          aria-label="Menu"
        >
          <span className={`block w-6 h-0.5 transition-all duration-300 ${scrolled ? 'bg-ink-black' : 'bg-white'} ${open ? 'rotate-45 translate-y-2' : ''}`} />
          <span className={`block w-6 h-0.5 transition-all duration-300 ${scrolled ? 'bg-ink-black' : 'bg-white'} ${open ? 'opacity-0' : ''}`} />
          <span className={`block w-6 h-0.5 transition-all duration-300 ${scrolled ? 'bg-ink-black' : 'bg-white'} ${open ? '-rotate-45 -translate-y-2' : ''}`} />
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="md:hidden bg-white border-t border-steel-grey overflow-hidden"
          >
            <div className="container-site py-4 flex flex-col gap-4">
              {links.map(l => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="font-montserrat font-medium text-ink-black/80 py-2"
                >
                  {l.label}
                </a>
              ))}
              <div className="flex flex-col gap-2 pt-2 border-t border-steel-grey">
                {isLoaded && (
                  isSignedIn ? (
                    <Link href="/dashboard" onClick={() => setOpen(false)} className="btn-primary h-11 text-sm rounded-xl">
                      Dashboard →
                    </Link>
                  ) : (
                    <>
                      <Link href="/sign-in" className="btn-outline h-11 text-sm rounded-xl">
                        Log in
                      </Link>
                      <Link href="/sign-up" className="btn-primary h-11 text-sm rounded-xl">
                        Get Started →
                      </Link>
                    </>
                  )
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  )
}
