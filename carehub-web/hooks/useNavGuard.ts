import { useCallback, useRef } from 'react'

const DEFAULT_COOLDOWN_MS = 800

/**
 * Wraps an action handler so a rapid double/triple click (before the first
 * click's async request has had a chance to settle) is ignored instead of
 * firing the same request multiple times. The guard releases when the
 * wrapped function's promise settles, or after `cooldownMs` for a
 * synchronous one — never on a fixed timer alone, so it doesn't block a
 * legitimate next action longer than the original one actually took.
 *
 * Mirrors hooks/useNavGuard.ts in the mobile app — kept as the one
 * consistent retry/double-submit-guard pattern across both platforms.
 */
export function useNavGuard(cooldownMs = DEFAULT_COOLDOWN_MS) {
  const lockedRef = useRef(false)

  const guard = useCallback(
    <A extends unknown[]>(fn: (...args: A) => void | Promise<unknown>) =>
      (...args: A) => {
        if (lockedRef.current) return
        lockedRef.current = true
        const result = fn(...args)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          ;(result as Promise<unknown>).finally(() => { lockedRef.current = false })
        } else {
          setTimeout(() => { lockedRef.current = false }, cooldownMs)
        }
      },
    [cooldownMs],
  )

  return guard
}
