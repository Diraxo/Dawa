/**
 * File validation for the Dawa React Native mobile app.
 * Mirrors carehub-web/lib/fileValidation.ts — keep in sync.
 */

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
])

export const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf'])

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
  valid:  boolean
  error?: string
}

/**
 * Validate a file picked by expo-document-picker.
 * Pass the asset object from DocumentPicker.getDocumentAsync().
 */
export function validatePickedFile(asset: {
  name:      string
  mimeType?: string | null
  size?:     number | null
}): FileValidationResult {
  const { name, mimeType, size } = asset

  if (size != null && size === 0) {
    return { valid: false, error: 'File is empty.' }
  }
  if (size != null && size > MAX_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File is too large. Maximum size is 10 MB.' }
  }

  const ext = getExtension(name)

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `File type "${ext}" is not allowed for security reasons.` }
  }
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported file type "${ext}". Allowed types: JPG, PNG, PDF.` }
  }
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType.toLowerCase())) {
    return { valid: false, error: `File content type is not allowed. Allowed: JPG, PNG, PDF.` }
  }

  return { valid: true }
}

/**
 * Generate a safe storage filename — strips path traversal and unsafe chars.
 */
export function safeFilename(originalName: string, prefix?: string): string {
  let name = originalName.replace(/[/\\]/g, '_')
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\x00-\x1f\x7f]/g, '')
  name = name.replace(/\s+/g, '_')
  name = name.replace(/[^a-zA-Z0-9._-]/g, '_')

  const ext    = getExtension(name)
  const stem   = name.slice(0, name.length - ext.length)
  const safeName = `${stem.replace(/\./g, '_')}${ext}`

  return prefix
    ? `${prefix}${Date.now()}_${safeName}`
    : `${Date.now()}_${safeName}`
}

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.')
  if (parts.length < 2) return ''
  return `.${parts[parts.length - 1]}`
}
