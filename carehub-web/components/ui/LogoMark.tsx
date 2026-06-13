import Image from 'next/image'

// The CareHub logo (hands holding a teal heart) inside a white rounded square
// so it reads on light, dark, and gradient backgrounds alike.
export default function LogoMark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center bg-white border border-steel-grey/60 shadow-sm flex-shrink-0 ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <Image
        src="/logo.png"
        alt="CareHub"
        width={Math.round(size * 0.74)}
        height={Math.round(size * 0.74)}
        priority
      />
    </span>
  )
}
