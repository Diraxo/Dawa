const path = require('path');
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Allow expo-image to load local .svg files as assets
config.resolver.assetExts.push('svg');

// Required for @supabase/realtime-js — it uses package.json "exports" field
config.resolver.unstable_enablePackageExports = true;

// react-native-teleport ships lib/module/package.json with {"type":"module"}.
// Metro treats this as ESM and skips .native.js resolution, so the web file
// (views/PortalHost/index.js) is loaded on Android instead of index.native.js,
// causing "usePortalRegistryContext must be used within a PortalRegistryContext".
// We intercept the directory import and return the correct native file directly.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isNative = platform === 'android' || platform === 'ios';
  const fromTeleport = context.originModulePath?.includes(
    path.join('react-native-teleport', 'lib', 'module')
  );

  if (isNative && fromTeleport && moduleName.includes('views/PortalHost')) {
    const resolvedDir = path.resolve(path.dirname(context.originModulePath), moduleName);
    return { filePath: path.join(resolvedDir, 'index.native.js'), type: 'sourceFile' };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativewind(config, { input: "./global.css" });
