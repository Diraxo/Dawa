const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Allow expo-image to load local .svg files as assets
config.resolver.assetExts.push('svg');

// Required for @supabase/realtime-js — it uses package.json "exports" field
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativewind(config, { input: "./global.css" });
