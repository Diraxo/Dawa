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

// Doctors sometimes save their name typed in ALL CAPS or all lowercase.
// Only normalizes those two cases to Title Case — a name that already mixes
// case (e.g. "McDonald", "O'Brien") is left untouched rather than mangled by
// a blanket transform.
export function normalizeNameCase(rawName: string | null | undefined): string {
  const name = (rawName ?? '').trim();
  if (!name) return name;
  const letters = name.replace(/[^a-zA-Z]/g, '');
  const isAllUpper = letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  const isAllLower = letters.length > 0 && letters === letters.toLowerCase() && letters !== letters.toUpperCase();
  if (!isAllUpper && !isAllLower) return name;
  return name.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
