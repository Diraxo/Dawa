import { useAuth, useUser } from '@clerk/clerk-expo'
import { useEffect, useRef } from 'react'

import { getAuthClient } from '@/lib/supabase'
import { streamClient } from '@/lib/stream'
import { useAuthStore } from '@/store/authStore'
import { logger } from '@/lib/logger'

export function useStreamConnection() {
  const { isSignedIn, getToken } = useAuth()
  const { user } = useUser()
  const { setUser, connectStream, disconnectStream, isStreamConnected, streamConnectRetryTick } =
    useAuthStore()
  const connectingRef = useRef(false)

  // The client's own connection state can drop silently (backgrounding,
  // network blip) without any of the individual chat screens knowing —
  // `isStreamConnected` was previously set once on connect and never
  // corrected, so a stale-true value hid dropped sockets from callers that
  // gate re-`watch()`ing a channel on it.
  useEffect(() => {
    const sub = streamClient.on('connection.changed', (event) => {
      useAuthStore.setState({ isStreamConnected: !!event.online })
    })
    return () => sub.unsubscribe()
  }, [])

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
      useAuthStore.setState({ streamConnectionError: false })
      try {
        const clerkToken = await getToken()
        if (!clerkToken) {
          useAuthStore.setState({ streamConnectionError: true })
          return
        }

        const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
        // Bare fetch() never times out on its own — a stalled request (dead
        // wifi, cold-starting edge function) would otherwise leave
        // `connectingRef` true and `isStreamConnected` false forever, with
        // no error surfaced, which is exactly what left screens gated on
        // isStreamConnected spinning indefinitely.
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 15000)
        let res: Response
        try {
          res = await fetch(`${supabaseUrl}/functions/v1/generate-stream-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${clerkToken}`,
            },
            signal: controller.signal,
          })
        } finally {
          clearTimeout(timeout)
        }

        if (!res.ok) {
          useAuthStore.setState({ streamConnectionError: true })
          return
        }

        const { token } = await res.json() as { token: string; userId: string }

        // Prefer the DB's custom-uploaded avatar over Clerk's imageUrl so
        // Stream chat (e.g. the doctor's patient-avatar view) reflects it too.
        let dbPhotoUrl: string | null = null
        try {
          const { data } = await getAuthClient(clerkToken)
            .from('users')
            .select('profile_photo_url')
            .eq('clerk_id', user.id)
            .maybeSingle()
          dbPhotoUrl = (data as any)?.profile_photo_url ?? null
        } catch {
          // Non-fatal — fall back to Clerk's image below
        }

        setUser(
          user.id,
          user.fullName ?? user.firstName ?? 'User',
          dbPhotoUrl ?? user.imageUrl ?? null
        )

        await connectStream(token)
      } catch (err) {
        logger.error('[Stream] connection failed:', err)
        useAuthStore.setState({ streamConnectionError: true })
      } finally {
        connectingRef.current = false
      }
    }

    connect()
  }, [isSignedIn, user?.id, streamConnectRetryTick])
}
