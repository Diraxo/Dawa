// __DEV__ is a React Native global — true in dev/Expo Go, false in production builds
export const logger = {
  log: (...args: unknown[]) => { if (__DEV__) console.log(...args); },
  error: (...args: unknown[]) => { if (__DEV__) console.error(...args); },
  warn: (...args: unknown[]) => { if (__DEV__) console.warn(...args); },
  info: (...args: unknown[]) => { if (__DEV__) console.info(...args); },
};

// TEMPORARY — Issue 21 ghost-consultation investigation (2026-07-27).
// Deliberately NOT gated by __DEV__ (unlike logger.* above) so these lines
// are visible via `adb logcat *:S ReactNativeJS:V` on the installed release
// build where the bug reproduces — the dev-only logger is silent there.
// DELETE this export and every call site once the root cause is confirmed
// fixed; it must never ship long-term.
export const ghostDebug = (...args: unknown[]) => { console.log('[GHOST_DEBUG]', new Date().toISOString(), ...args); };
