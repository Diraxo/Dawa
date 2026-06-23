const path = require('path');
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

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

  // codegenNativeComponent is used by native view specs (Agora, stream-chat-expo, etc.)
  // and is not supported on web. Stub it out so web bundles don't crash.
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
