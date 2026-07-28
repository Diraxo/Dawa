// Web stub for react-native/Libraries/Utilities/codegenNativeCommands
// Used by native view specs (react-native-pdf, etc.) to build a dispatcher
// for native view commands — not supported on web, so return an empty
// commands object. Never invoked on web at runtime: consumers only reach
// their native view (and thus these command functions) behind a
// Platform.OS !== 'web' guard.
export default function codegenNativeCommands() {
  return {};
}
