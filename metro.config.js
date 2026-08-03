const path = require('path');
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// carehub-web is a separate Next.js app, not part of the RN bundle. Metro still
// crawls/watches it by default since it lives under the project root, and its
// .next build output contains paths with "?" that crash Metro's file watcher on
// Windows (lstat UNKNOWN on FallbackWatcher). Block the whole directory so Metro
// never resolves or watches it.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList]),
  /carehub-web[/\\].*/,
];

// Allow expo-image to load local .svg files as assets
config.resolver.assetExts.push('svg');

// Required for @supabase/realtime-js — it uses package.json "exports" field
config.resolver.unstable_enablePackageExports = true;

// react-native-teleport ships lib/module/package.json with {"type":"module"}.
// Metro treats this as ESM and skips .native.js resolution for every file under
// lib/module/, loading the web versions on Android instead of index.native.js.
// Affected paths and why the web versions crash:
//   views/Portal         — web version imports { createPortal } from "react-dom" → hard crash
//   views/PortalHost     — web version calls usePortalRegistryContext() → throws
//   views/PortalProvider — web version provides wrong JS registry context
//   contexts/ScrollViewContext — web version returns wrong React context object
// "views/Portal" as a substring catches all three portal paths (Portal, PortalHost,
// PortalProvider). We intercept each and force Metro to the correct .native.js file.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isNative = platform === 'android' || platform === 'ios';
  const fromTeleport = context.originModulePath?.includes(
    path.join('react-native-teleport', 'lib', 'module')
  );

  if (
    isNative &&
    fromTeleport &&
    (moduleName.includes('views/Portal') || moduleName.includes('contexts/ScrollViewContext'))
  ) {
    const resolvedDir = path.resolve(path.dirname(context.originModulePath), moduleName);
    return { filePath: path.join(resolvedDir, 'index.native.js'), type: 'sourceFile' };
  }

  // react-native-agora is native-only. On web it's still bundled via Expo
  // Router's require.context (from .native.tsx route files), so redirect it
  // to a no-op stub that satisfies the imports without native code.
  if (platform === 'web' && moduleName === 'react-native-agora') {
    return {
      filePath: path.resolve(__dirname, 'lib/react-native-agora.web.js'),
      type: 'sourceFile',
    };
  }

  // @react-native-firebase/messaging is native-only. index.js/lib/voipPush.ts only
  // require() it behind `if (Platform.OS === 'android')`, but Metro still statically
  // resolves the require() call into the web dependency graph, and the package's
  // SharedEventEmitter imports react-native internals unavailable on web — stub it out.
  if (platform === 'web' && moduleName === '@react-native-firebase/messaging') {
    return {
      filePath: path.resolve(__dirname, 'lib/firebase-messaging.web.js'),
      type: 'sourceFile',
    };
  }

  // codegenNativeComponent/codegenNativeCommands are used by native view specs
  // (Agora, stream-chat-expo, react-native-pdf, etc.) and are not supported on
  // web. Stub them out so web bundles don't crash.
  if (
    platform === 'web' &&
    (moduleName === 'react-native/Libraries/Utilities/codegenNativeComponent' ||
      moduleName.endsWith('/codegenNativeComponent'))
  ) {
    return {
      filePath: path.resolve(__dirname, 'lib/codegenNativeComponent.web.js'),
      type: 'sourceFile',
    };
  }
  if (
    platform === 'web' &&
    (moduleName === 'react-native/Libraries/Utilities/codegenNativeCommands' ||
      moduleName.endsWith('/codegenNativeCommands'))
  ) {
    return {
      filePath: path.resolve(__dirname, 'lib/codegenNativeCommands.web.js'),
      type: 'sourceFile',
    };
  }

  // stream-chat-expo's TurboModule native specs call TurboModuleRegistry.get/getEnforcing
  // at module-init time. TurboModuleRegistry is not exported by react-native-web, so it
  // is undefined on web and crashes with "Cannot read properties of undefined (reading 'get')".
  // Stub both specs to null so the rest of stream-chat-expo loads safely.
  if (
    platform === 'web' &&
    (moduleName.includes('NativeStreamMultipartUploader') ||
      moduleName.includes('NativeStreamVideoThumbnail'))
  ) {
    return {
      filePath: path.resolve(__dirname, 'lib/stream-native-module.web.js'),
      type: 'sourceFile',
    };
  }

  // whatwg-url@5 (pulled in by node-fetch) calls require("punycode") — the
  // Node.js built-in — which is undefined in the browser. The npm `punycode`
  // package is already installed and provides the same API, so redirect to it.
  if (platform === 'web' && moduleName === 'punycode') {
    return {
      filePath: path.resolve(__dirname, 'node_modules/punycode/punycode.js'),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativewind(config, { input: "./global.css" });
