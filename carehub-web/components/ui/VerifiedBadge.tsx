import { Check } from 'lucide-react'

interface VerifiedBadgeProps {
  size?: number
}

// Shown only for admin-approved doctors (status === 'approved'); callers gate this.
export default function VerifiedBadge({ size = 16 }: VerifiedBadgeProps) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-care-blue flex-shrink-0"
      style={{ width: size, height: size }}
      aria-label="Verified doctor"
      title="Verified doctor"
    >
      <Check className="text-white" style={{ width: size * 0.65, height: size * 0.65 }} strokeWidth={3} />
    </span>
  )
}
