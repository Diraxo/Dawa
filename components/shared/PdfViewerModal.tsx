import { Ionicons } from '@expo/vector-icons'
// expo-file-system's bare export is the new File/Directory class API and has
// no cacheDirectory/downloadAsync/deleteAsync — those classic APIs live under
// /legacy now. See app/(doctor)/consultation-summary.tsx for the same note.
import * as FileSystem from 'expo-file-system/legacy'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { colors } from '@/constants/colors'
import { fonts } from '@/constants/fonts'
import { logger } from '@/lib/logger'

// react-native-pdf is a native module — not registered in Expo Go, same
// constraint as stream-chat-expo elsewhere in this app. Require it lazily so
// routes still load there; the modal just shows a message instead of crashing.
let Pdf: any = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Pdf = require('react-native-pdf').default
} catch {}

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PdfViewerModalProps {
  visible: boolean
  url: string | null
  title?: string | null
  fileSize?: number | null
  onClose: () => void
}

// In-app PDF viewer used everywhere a PDF can be shared in a consultation
// (chat, and the in-call chat panel for voice/video). Documents are streamed
// into the app's private cache — never opened via Linking/the system browser,
// never exposed as a tappable link. View-only: no share/save/export action,
// since these are sensitive consultation documents. The cached copy is
// deleted as soon as the viewer closes so the file doesn't linger on-device.
export function PdfViewerModal({ visible, url, title, fileSize, onClose }: PdfViewerModalProps) {
  const [localUri, setLocalUri] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [numPages, setNumPages] = useState(0)
  const cleanupUriRef = useRef<string | null>(null)

  useEffect(() => {
    if (!visible || !url) return
    let cancelled = false
    setLoading(true)
    setError(false)
    setLocalUri(null)
    setNumPages(0)

    const dest = `${FileSystem.cacheDirectory}consult-doc-${Date.now()}.pdf`
    FileSystem.downloadAsync(url, dest)
      .then(({ uri }) => {
        if (cancelled) return
        cleanupUriRef.current = uri
        setLocalUri(uri)
      })
      .catch((err) => {
        logger.error('[PdfViewerModal] download error:', err)
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [visible, url])

  // Wipe the cached copy the moment the viewer is dismissed — it should not
  // persist on-device once the user is done reading it.
  useEffect(() => {
    if (visible) return
    const toDelete = cleanupUriRef.current
    if (toDelete) {
      FileSystem.deleteAsync(toDelete, { idempotent: true }).catch(() => {})
      cleanupUriRef.current = null
    }
    setLocalUri(null)
  }, [visible])

  const sizeLabel = formatFileSize(fileSize ?? undefined)
  const subtitle = [sizeLabel, numPages > 0 ? `${numPages} page${numPages === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn} accessibilityLabel="Close document">
            <Ionicons name="close" size={24} color={colors.inkBlack} />
          </Pressable>
          <View style={styles.titleWrap}>
            <Text style={styles.title} numberOfLines={1}>{title || 'Document'}</Text>
            {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
          </View>
          <View style={styles.closeBtn} />
        </View>

        {!Pdf ? (
          <View style={styles.center}>
            <Ionicons name="document-text-outline" size={40} color={colors.steelGrey} />
            <Text style={styles.stateText}>Document viewer unavailable</Text>
            <Text style={styles.stateHint}>This build doesn&apos;t include the document viewer module — a fresh development/production build is required</Text>
          </View>
        ) : loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.tealGreen} size="large" />
            <Text style={styles.stateText}>Opening document…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
            <Text style={styles.stateText}>Couldn&apos;t open this document</Text>
          </View>
        ) : localUri ? (
          <Pdf
            source={{ uri: localUri, cache: false }}
            style={styles.pdf}
            enablePaging={false}
            horizontal={false}
            enableDoubleTapZoom
            minScale={1}
            maxScale={4}
            spacing={8}
            trustAllCerts={false}
            onLoadComplete={(pages: number) => setNumPages(pages)}
            onError={(err: unknown) => { logger.error('[PdfViewerModal] render error:', err); setError(true) }}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.mistWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.cloudGrey,
  },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center' },
  title: { fontFamily: fonts.semiBold, fontSize: 15, color: colors.inkBlack },
  subtitle: { fontFamily: fonts.regular, fontSize: 11, color: colors.steelGrey, marginTop: 1 },
  pdf: { flex: 1, width: '100%', backgroundColor: colors.mistWhite },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  stateText: { fontFamily: fonts.medium, fontSize: 14, color: '#6B7280', textAlign: 'center' },
  stateHint: { fontFamily: fonts.regular, fontSize: 12, color: '#9CA3AF', textAlign: 'center' },
})
