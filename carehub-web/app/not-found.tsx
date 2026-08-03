import Link from 'next/link'
import LogoMark from '@/components/ui/LogoMark'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-cloud-grey px-6">
      <LogoMark size={48} variant="dark" />

      <h1 className="mt-8 text-[96px] font-bold font-montserrat leading-none bg-gradient-interactive bg-clip-text text-transparent select-none">
        404
      </h1>

      <h2 className="mt-3 text-2xl font-semibold font-montserrat text-ink-black text-center">
        Page not found
      </h2>
      <p className="mt-2 text-sm font-montserrat text-ink-black/50 text-center max-w-xs">
        This page doesn&apos;t exist or you don&apos;t have permission to access it.
      </p>

      <Link
        href="/"
        className="mt-8 h-[52px] px-8 flex items-center rounded-2xl bg-gradient-interactive text-white font-montserrat font-bold text-base hover:opacity-90 transition-opacity"
      >
        Go to Home
      </Link>
    </div>
  )
}
