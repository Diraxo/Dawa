'use client'

import { useEffect, useRef, useState } from 'react'
import { SpeakingPulse } from './SpeakingPulse'

const EDGE_MARGIN = 16

interface DraggableSelfViewProps {
  width?: number
  height?: number
  // Exactly one of top/bottom anchors the un-dragged resting position —
  // patient pages dock bottom-right (above the control bar), doctor pages
  // dock top-right (below the timer overlay). Both are relative to the
  // nearest positioned ancestor (the video area, which must be `relative`).
  top?: number
  bottom?: number
  isOff: boolean
  isSpeaking?: boolean
  offIcon?: React.ReactNode
  children: React.ReactNode
}

// Shared WhatsApp-style local camera preview — small floating PiP, rounded
// corners, no border, freely draggable via pointer events (mouse + touch
// unified), and snaps to whichever edge it's released nearest. One
// implementation for all 4 doctor/patient video pages so drag behavior can't
// drift between them (previously neither web page had any drag support at
// all — the self view was a fixed, unmovable box). Mirrors
// components/consultation/DraggableSelfView.tsx on the mobile app.
export function DraggableSelfView({
  width = 112, height = 150, top, bottom, isOff, isSpeaking = false, offIcon, children,
}: DraggableSelfViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Dragged position in px, relative to the nearest positioned ancestor.
  // Null until the user drags at least once — the resting top/bottom+right
  // CSS anchor is used until then.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const draggingRef = useRef(false)
  const startRef = useRef({ pointerX: 0, pointerY: 0, left: 0, top: 0 })

  const onPointerDown = (e: React.PointerEvent) => {
    const el = containerRef.current
    if (!el) return
    startRef.current = { pointerX: e.clientX, pointerY: e.clientY, left: el.offsetLeft, top: el.offsetTop }
    draggingRef.current = false
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const el = containerRef.current
    if (!el || !el.hasPointerCapture(e.pointerId)) return
    const dx = e.clientX - startRef.current.pointerX
    const dy = e.clientY - startRef.current.pointerY
    // Threshold before treating this as a drag — a plain click/tap must not
    // jump the preview by a stray pixel or two.
    if (!draggingRef.current && Math.hypot(dx, dy) < 6) return
    draggingRef.current = true
    const parent = el.offsetParent as HTMLElement | null
    const maxLeft = Math.max(0, (parent?.clientWidth ?? window.innerWidth) - width)
    const maxTop = Math.max(0, (parent?.clientHeight ?? window.innerHeight) - height)
    setPos({
      left: Math.min(Math.max(startRef.current.left + dx, 0), maxLeft),
      top: Math.min(Math.max(startRef.current.top + dy, 0), maxTop),
    })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const el = containerRef.current
    if (draggingRef.current && el) {
      const parent = el.offsetParent as HTMLElement | null
      const pw = parent?.clientWidth ?? window.innerWidth
      setPos(p => {
        if (!p) return p
        const snapLeft = p.left + width / 2 < pw / 2 ? EDGE_MARGIN : Math.max(EDGE_MARGIN, pw - EDGE_MARGIN - width)
        return { left: snapLeft, top: p.top }
      })
    }
    // Reset on the next tick so a click handler on this element (none today,
    // but kept defensive for future use) can still tell a tap from a drag.
    setTimeout(() => { draggingRef.current = false }, 0)
  }

  // Keep the preview on-screen across a viewport resize if it was dragged.
  useEffect(() => {
    const onResize = () => {
      const parent = containerRef.current?.offsetParent as HTMLElement | null
      const pw = parent?.clientWidth ?? window.innerWidth
      const ph = parent?.clientHeight ?? window.innerHeight
      setPos(p => (p ? {
        left: Math.min(Math.max(p.left, 0), Math.max(0, pw - width)),
        top: Math.min(Math.max(p.top, 0), Math.max(0, ph - height)),
      } : p))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [width, height])

  const anchorStyle: React.CSSProperties = pos
    ? { left: pos.left, top: pos.top }
    : (top != null ? { top, right: EDGE_MARGIN } : { bottom: bottom ?? 16, right: EDGE_MARGIN })

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className="absolute z-20 cursor-grab active:cursor-grabbing select-none touch-none"
      style={{ width, height, ...anchorStyle }}
    >
      <SpeakingPulse active={isSpeaking} className="w-full h-full rounded-2xl">
        <div className="relative w-full h-full rounded-2xl overflow-hidden bg-[#1F2937] shadow-lg">
          {!isOff ? children : (
            <div className="w-full h-full flex items-center justify-center text-white/40">
              {offIcon}
            </div>
          )}
        </div>
      </SpeakingPulse>
    </div>
  )
}
