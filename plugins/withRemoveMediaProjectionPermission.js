const { withAndroidManifest } = require("@expo/config-plugins");

const PERMISSION = "android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION";

// io.agora.rtc:full-screen-sharing-special (a transitive dep of react-native-agora)
// injects this permission for its screen-share feature, which Dawa doesn't use.
// Google Play flags any manifest permission that isn't declared/justified in
// Play Console, so strip it at merge time instead of declaring an unused capability.
module.exports = function withRemoveMediaProjectionPermission(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] ?? [];

    const alreadyPresent = manifest["uses-permission"].some(
      (entry) => entry.$?.["android:name"] === PERMISSION
    );
    if (!alreadyPresent) {
      manifest["uses-permission"].push({
        $: {
          "android:name": PERMISSION,
          "tools:node": "remove",
        },
      });
    }

    return config;
  });
};
