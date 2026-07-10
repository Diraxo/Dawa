'use client'

import Link from 'next/link'
import { useState } from 'react'
import { stripDrPrefix } from '@/lib/utils'

// Shared by both the patient and doctor conversation lists so avatar sizing,
// spacing, hover feedback, badge cap, and online-dot semantics stay identical
// across roles — each page previously hand-rolled its own divergent row.

export interface ConversationRowData {
  id: string
  peerName: string
  peerPhotoUrl: string | null
  isDoctorPeer: boolean
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
  isOnline: boolean
}

function AvatarPhoto({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="w-12 h-12 rounded-full bg-cloud-grey overflow-hidden">
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        className={`w-12 h-12 rounded-full object-cover transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  )
}

export function ConversationRow({
  data,
  href,
  onClick,
}: {
  data: ConversationRowData
  href?: string
  onClick?: () => void
}) {
  const displayName = data.isDoctorPeer ? `Dr. ${stripDrPrefix(data.peerName)}` : data.peerName
  const initial =
    (data.isDoctorPeer ? stripDrPrefix(data.peerName) : data.peerName).charAt(0).toUpperCase() || '?'

  const inner = (
    <div className="w-full flex items-center gap-4 px-5 py-4 hover:bg-cloud-grey transition-colors text-left">
      <div className="relative flex-shrink-0">
        {data.peerPhotoUrl ? (
          <AvatarPhoto src={data.peerPhotoUrl} alt={displayName} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-teal-green flex items-center justify-center text-white font-black text-lg">
            {initial}
          </div>
        )}
        {data.isOnline && (
          <div className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-success border-2 border-white" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p
            className={`font-montserrat text-sm text-ink-black truncate ${
              data.unreadCount > 0 ? 'font-bold' : 'font-semibold'
            }`}
          >
            {displayName}
          </p>
          <p className="text-[11px] text-ink-black/40 flex-shrink-0">{data.lastMessageTime}</p>
        </div>
        <div className="flex items-center gap-2">
          <p
            className={`text-xs truncate flex-1 ${
              data.unreadCount > 0 ? 'text-ink-black font-medium' : 'text-ink-black/50'
            }`}
          >
            {data.lastMessage}
          </p>
          {data.unreadCount > 0 && (
            <div className="min-w-[20px] h-5 rounded-full bg-teal-green flex items-center justify-center px-1.5 flex-shrink-0">
              <span className="text-white font-bold text-[10px]">
                {data.unreadCount > 99 ? '99+' : data.unreadCount}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (href) return <Link href={href} className="block">{inner}</Link>
  return (
    <button onClick={onClick} className="w-full text-left">
      {inner}
    </button>
  )
}

export function ConversationDivider() {
  return <div className="h-px bg-cloud-grey ml-20" />
}
