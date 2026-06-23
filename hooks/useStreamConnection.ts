import { useAuth, useUser } from '@clerk/clerk-expo'
import { useEffect, useRef } from 'react'

import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'

export function useStreamConnection() {
  const { isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const { setUser, connectStream, disconnectStream, isStreamConnected } = useAuthStore()
  const connectingRef = useRef(false)

  useEffect(() => {
    if (!isSignedIn || !user) {
      if (streamClient.userID) {
        disconnectStream()
      }
      return
    }

    if (isStreamConnected || connectingRef.current) return

    const connect = async () => {
      connectingRef.current = true
      try {
        const clerkToken = await getToken()
        if (!clerkToken) return

        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
        const res = await fetch(
          `${supabaseUrl}/functions/v1/generate-stream-token`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${clerkToken}`,
            },
          }
        )

        if (!res.ok) return

        const { token } = await res.json() as { token: string; userId: string }

        setUser(
          user.id,
          user.fullName ?? user.firstName ?? 'User',
          user.imageUrl ?? null
        )

        await connectStream(token)
      } catch (err) {
        logger.error('[Stream] connection failed:', err)
      } finally {
        connectingRef.current = false
      }
    }

    connect()
  }, [isSignedIn, user?.id])
}
