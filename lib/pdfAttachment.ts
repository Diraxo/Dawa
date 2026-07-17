// Shared PDF-attachment detection used to intercept Stream Chat's default
// file-attachment tap handler (which otherwise calls Linking.openURL and
// kicks the user out to Chrome) and route it into the in-app PdfViewerModal
// instead. Checked by mime_type first since that's authoritative; falls back
// to the filename for attachments uploaded without one.
export function isPdfAttachment(attachment: any): boolean {
  if (!attachment) return false
  const mime = attachment.mime_type as string | undefined
  if (mime === 'application/pdf') return true
  const name = (attachment.title || attachment.fallback || attachment.asset_url || '') as string
  return /\.pdf(\?|$)/i.test(name)
}
