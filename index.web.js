// index.web.js — web entry point
//
// Metro prefers this platform-specific file over index.js when bundling for
// web, so none of index.js's Android/Firebase/CallKeep-only code (which
// pulls in native-only modules that can't resolve on web, e.g.
// @react-native-firebase/messaging importing RN internals) ever enters the
// web dependency graph. Keep this file free of any native-only imports.

import 'expo-router/entry'
