import Image from 'next/image'

interface LogoMarkProps {
  size?: number
  className?: string
  /** 'light' = white logo for dark/gradient backgrounds (default). 'dark' = dark logo for white/light backgrounds. */
  variant?: 'light' | 'dark'
}

export default function LogoMark({ size = 40, className = '', variant = 'light' }: LogoMarkProps) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.22) }}
    >
      <Image
        src={variant === 'dark' ? '/logo-dark.png' : '/logo-white.png'}
        alt="Dawa"
        width={size}
        height={size}
        priority
        style={{ borderRadius: Math.round(size * 0.22), objectFit: 'contain' }}
      />
    </span>
  )
}
