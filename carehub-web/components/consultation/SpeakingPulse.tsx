'use client'

interface SpeakingPulseProps {
  active: boolean
  color?: string
  className?: string
  children: React.ReactNode
}

// Shared "who's talking" ring — a soft pulsing border layered around a self
// view or a remote avatar. Driven purely by a boolean so both web video pages
// (doctor + patient) can wire it to Agora's volume-indicator event without
// duplicating the animation. Mirrors components/consultation/SpeakingPulse.tsx
// on the mobile app.
export function SpeakingPulse({ active, color = '#00BFA5', className = '', children }: SpeakingPulseProps) {
  return (
    <div className={`relative ${className}`}>
      {active && (
        <span
          className="absolute inset-0 rounded-[inherit] pointer-events-none animate-speak-pulse"
          style={{ border: `3px solid ${color}` }}
        />
      )}
      {children}
    </div>
  )
}
