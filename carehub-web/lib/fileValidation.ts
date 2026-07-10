/**
 * Shared file-validation logic for carehub-web.
 * Applied both on the client (immediate feedback) and server (enforcement).
 *
 * Security rationale:
 * - Validate by MIME type AND file extension independently — browser-reported
 *   Content-Type is easy to forge; extension-only checks are trivially bypassed
 *   by renaming files.
 * - Reject executable extensions regardless of claimed MIME type.
 * - Generate safe storage filenames that strip path separators and special chars.
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
])

export const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf'])

// Executables and scripts that must never be uploaded, regardless of MIME
const BLOCKED_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.bash', '.zsh',
  '.js', '.ts', '.mjs', '.cjs',
  '.py', '.rb', '.php', '.pl', '.lua',
  '.dll', '.so', '.dylib',
  '.apk', '.ipa', '.deb', '.rpm',
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.html', '.htm', '.svg', '.xml',
  '.vbs', '.wsf', '.hta',
])

export interface FileValidationResult {
  valid: boolean
  error?: string
}

/** Validate a File object (browser / Node.js File API). */
export function validateFile(file: File): FileValidationResult {
  // Size check
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: `File is too large. Maximum size is 10 MB.` }
  }
  if (file.size === 0) {
    return { valid: false, error: 'File is empty.' }
  }

  // Extension check — get the last extension in the filename
  const ext = getExtension(file.name)

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed for security reasons.` }
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported file type "${ext}". Allowed: JPG, PNG, PDF.` }
  }

  // MIME type check (where the browser provides it)
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    return { valid: false, error: `File content type "${file.type}" is not allowed. Allowed: JPG, PNG, PDF.` }
  }

  return { valid: true }
}

/** Validate from raw metadata (useful in server API routes where File isn't available). */
export function validateFileMetadata(opts: {
  filename: string
  mimeType: string
  sizeBytes: number
}): FileValidationResult {
  const { filename, mimeType, sizeBytes } = opts

  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File is too large. Maximum size is 10 MB.' }
  }
  if (sizeBytes === 0) {
    return { valid: false, error: 'File is empty.' }
  }

  const ext = getExtension(filename)

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed.` }
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported file type "${ext}". Allowed: JPG, PNG, PDF.` }
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType.toLowerCase().split(';')[0].trim())) {
    return { valid: false, error: `Content type "${mimeType}" is not allowed.` }
  }

  return { valid: true }
}

/**
 * Generate a safe storage filename.
 * Strips directory separators, null bytes, and characters that could cause issues
 * in object storage keys. Prepends a timestamp for uniqueness.
 */
export function safeFilename(originalName: string, prefix?: string): string {
  // Decode any URL encoding first
  let name = decodeURIComponent(originalName).replace(/%/g, '')

  // Strip directory components (defend against path traversal)
  name = name.replace(/[/\\]/g, '_')

  // Replace null bytes and control characters
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f]/g, '')

  // Replace whitespace runs with a single underscore
  name = name.replace(/\s+/g, '_')

  // Keep only safe chars: alphanumeric, dash, underscore, dot
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_')

  // Prevent double-extension tricks like "malware.pdf.exe" by only allowing known extensions at the end
  const ext = getExtension(name)
  const stem = name.slice(0, name.length - ext.length)

  const safeStem = stem.replace(/\./g, '_')
  const safeName = `${safeStem}${ext}`

  return prefix
    ? `${prefix}${Date.now()}_${safeName}`
    : `${Date.now()}_${safeName}`
}

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  if (parts.length < 2) return ''
  return `.${parts[parts.length - 1]}`
}
