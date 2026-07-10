// Doctor display names are free-text (`users.full_name`) and registration UI
// actively invites doctors to type "Dr." into that field, so any code that
// unconditionally prepends "Dr. " risks a double "Dr. Dr. Name". Strip an
// existing prefix first, then prepend exactly one.
// Mirrors carehub-web's stripDrPrefix() (carehub-web/lib/utils.ts).
export function stripDrPrefix(name: string): string {
  return name.replace(/^Dr\.?\s+/i, '').trim();
}

export function formatDoctorName(rawName: string | null | undefined, fallback = 'Doctor'): string {
  const name = (rawName ?? '').trim();
  if (!name) return fallback;
  return `Dr. ${stripDrPrefix(name)}`;
}
