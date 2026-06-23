// __DEV__ is a React Native global — true in dev/Expo Go, false in production builds
export const logger = {
  log: (...args: unknown[]) => { if (__DEV__) console.log(...args); },
  error: (...args: unknown[]) => { if (__DEV__) console.error(...args); },
  warn: (...args: unknown[]) => { if (__DEV__) console.warn(...args); },
  info: (...args: unknown[]) => { if (__DEV__) console.info(...args); },
};
