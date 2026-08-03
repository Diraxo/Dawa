// Doctor "languages spoken" values are sometimes seeded directly into the
// DB (bypassing the registration picker, which already stores them Title
// Case), so patient-facing displays capitalize defensively rather than
// trusting the stored casing.
// Mirrors carehub-web's capitalizeLanguage() (carehub-web/lib/utils.ts).
export function capitalizeLanguage(lang: string): string {
  const trimmed = lang.trim()
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase()
}
