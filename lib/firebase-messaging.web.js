// Web stub — @react-native-firebase/messaging is native-only (its SharedEventEmitter
// imports react-native/Libraries internals not present on web). lib/voipPush.ts only
// ever calls this behind `if (Platform.OS === 'android')`, but Metro still statically
// resolves the require() to build the web dependency graph, so it needs a stub target.
export default function messaging() {
  return {};
}
