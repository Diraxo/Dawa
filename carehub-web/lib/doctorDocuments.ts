// Storage-path parsing for doctor_profiles.license_doc_url / id_doc_url,
// mirroring the shapes written by app/(doctor)/registration/step-4.tsx and
// app/(doctor)/my-documents.tsx (mobile).

export function parseLicensePaths(licenseRaw: string | null): string[] {
  if (!licenseRaw) return []
  try {
    const paths: unknown = JSON.parse(licenseRaw)
    return Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [licenseRaw]
  } catch {
    return [licenseRaw]
  }
}

export function parseIdDocPaths(idRaw: string | null): string[] {
  if (!idRaw) return []
  try {
    const parsed = JSON.parse(idRaw)
    if (parsed && typeof parsed === 'object') {
      if (parsed.type === 'national_id') {
        return [parsed.front, parsed.back].filter((p): p is string => typeof p === 'string')
      }
      if (parsed.type === 'passport') {
        return typeof parsed.file === 'string' ? [parsed.file] : []
      }
      return []
    }
    return typeof parsed === 'string' ? [parsed] : []
  } catch {
    return [idRaw]
  }
}
