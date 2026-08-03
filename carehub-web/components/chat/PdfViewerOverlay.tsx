'use client'

import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'
import { ChevronLeft, ChevronRight, Download, MoreVertical, X, ZoomIn, ZoomOut } from 'lucide-react'
import { logger } from '@/lib/logger'

// Served from /public rather than bundled via `new URL(..., import.meta.url)`
// — that pattern emits an ES module asset that Next's production Terser pass
// can't minify ("'import.meta' cannot be used outside of module code"), which
// fails the build. /public keeps the worker same-origin (satisfies this
// app's `worker-src 'self' blob:` CSP) without going through webpack/Terser.
// Copied from node_modules/pdfjs-dist/build/pdf.worker.min.mjs — keep in sync
// with the installed pdfjs-dist version (currently 5.4.296) if react-pdf is upgraded.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

const MIN_SCALE = 0.75
const MAX_SCALE = 3

function formatFileSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function pinchDistance(touches: React.TouchList): number {
  const [a, b] = [touches[0], touches[1]]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

interface PdfViewerOverlayProps {
  url: string
  title?: string
  fileSize?: number
  onClose: () => void
}

// In-app PDF viewer for consultation chat attachments — mirrors the WhatsApp
// document viewer: continuous vertical scroll through every page, pinch /
// double-tap / button zoom, and no default download or open-in-new-tab
// affordance. Documents are fetched as a blob and rendered page-by-page onto
// <canvas> via pdf.js — the original storage URL never lands in the DOM (no
// <a href>, no <iframe src>). Download is only reachable from the explicit
// overflow menu, never the default tap action.
// Stream's file CDN doesn't send Access-Control-Allow-Origin, so a direct
// fetch() from the browser (needed to read bytes into a blob) is blocked by
// CORS even though the same URL renders fine in an <img> tag — <img> never
// triggers a CORS check, fetch() always does. Routing through our own origin
// sidesteps that: server-to-server requests aren't subject to CORS.
function toFetchableUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (/(^|\.)stream-io-cdn\.com$/.test(parsed.hostname)) {
      return `/api/chat/file-proxy?url=${encodeURIComponent(url)}`
    }
  } catch {}
  return url
}

export function PdfViewerOverlay({ url, title, fileSize, onClose }: PdfViewerOverlayProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [errorStage, setErrorStage] = useState<'fetch' | 'render' | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1)
  const [visiblePage, setVisiblePage] = useState(1)
  const [pageWidth, setPageWidth] = useState(720)
  const [showMenu, setShowMenu] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const pinchStartRef = useRef<{ distance: number; scale: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setErrorStage(null)
    setBlobUrl(null)
    setNumPages(0)
    setScale(1)
    setVisiblePage(1)

    fetch(toFetchableUrl(url))
      .then((res) => { if (!res.ok) throw new Error(`fetch failed: ${res.status}`); return res.blob() })
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setBlobUrl(objectUrl)
      })
      .catch((err) => {
        logger.error('[PdfViewerOverlay] load error:', err)
        if (!cancelled) setErrorStage('fetch')
      })

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const compute = () => setPageWidth(Math.min(760, window.innerWidth - 48))
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [])

  // Ctrl/Cmd + wheel zooms instead of scrolling the page, matching the
  // trackpad-pinch gesture browsers translate into a ctrlKey wheel event.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.01)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Touch-pinch zoom for mobile browsers / touchscreens.
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStartRef.current = { distance: pinchDistance(e.touches), scale }
    }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartRef.current) {
      e.preventDefault()
      const ratio = pinchDistance(e.touches) / pinchStartRef.current.distance
      setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStartRef.current.scale * ratio)))
    }
  }
  const onTouchEnd = () => { pinchStartRef.current = null }

  const toggleDoubleTapZoom = () => setScale((s) => (s > 1 ? 1 : 2))

  const trackVisiblePage = () => {
    const el = scrollRef.current
    if (!el) return
    const mid = el.scrollTop + el.clientHeight / 2
    let closest = 1
    let closestDist = Infinity
    pageRefs.current.forEach((node, idx) => {
      if (!node) return
      const dist = Math.abs(node.offsetTop + node.offsetHeight / 2 - mid)
      if (dist < closestDist) { closestDist = dist; closest = idx + 1 }
    })
    setVisiblePage(closest)
  }

  const handleDownload = () => {
    if (!blobUrl) return
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = title || 'document.pdf'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setShowMenu(false)
  }

  const sizeLabel = formatFileSize(fileSize)
  const subtitle = [sizeLabel, numPages > 0 ? `${numPages} page${numPages === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
        <div className="min-w-0 flex-1 mr-3">
          <p className="text-white/90 text-sm font-medium truncate">{title || 'Document'}</p>
          {subtitle && <p className="text-white/45 text-[11px]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.25))} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="Zoom out">
            <ZoomOut size={16} />
          </button>
          <button onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.25))} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="Zoom in">
            <ZoomIn size={16} />
          </button>
          <div className="relative">
            <button onClick={() => setShowMenu((v) => !v)} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="More options">
              <MoreVertical size={16} />
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 mt-2 w-44 bg-[#1c2333] rounded-xl shadow-2xl border border-white/10 py-1.5 z-20 overflow-hidden">
                  <button onClick={handleDownload} disabled={!blobUrl} className="w-full px-3.5 py-2.5 text-left text-sm text-white/90 hover:bg-white/10 flex items-center gap-2.5 disabled:opacity-40 transition-colors">
                    <Download size={15} /> Download
                  </button>
                </div>
              </>
            )}
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto select-none touch-pan-y"
        onScroll={trackVisiblePage}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="min-h-full flex flex-col items-center gap-3 px-4 py-4">
          {errorStage === 'fetch' ? (
            <p className="text-white/60 text-sm m-auto">Couldn&apos;t open this document.</p>
          ) : errorStage === 'render' ? (
            <p className="text-white/60 text-sm m-auto">Couldn&apos;t render this document.</p>
          ) : !blobUrl ? (
            <p className="text-white/60 text-sm m-auto">Opening document…</p>
          ) : (
            <Document
              file={blobUrl}
              onLoadSuccess={({ numPages: n }) => { setNumPages(n); pageRefs.current = new Array(n).fill(null) }}
              onLoadError={(err) => { logger.error('[PdfViewerOverlay] render error:', err); setErrorStage('render') }}
              loading={<p className="text-white/60 text-sm">Rendering…</p>}
              error={<p className="text-white/60 text-sm">Couldn&apos;t render this document.</p>}
            >
              {Array.from({ length: numPages }, (_, idx) => (
                <div
                  key={idx}
                  ref={(node) => { pageRefs.current[idx] = node }}
                  onDoubleClick={toggleDoubleTapZoom}
                  className="rounded-xl overflow-hidden shadow-2xl"
                >
                  <Page pageNumber={idx + 1} width={pageWidth * scale} renderAnnotationLayer={false} />
                </div>
              ))}
            </Document>
          )}
        </div>
      </div>

      {numPages > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/10 backdrop-blur rounded-full px-3 py-1.5">
          <ChevronLeft size={13} className="text-white/40" />
          <span className="text-white/70 text-xs font-medium tabular-nums">{visiblePage} / {numPages}</span>
          <ChevronRight size={13} className="text-white/40" />
        </div>
      )}
    </div>
  )
}
