const { withAndroidManifest } = require("@expo/config-plugins");

const SCOPED_PERMISSIONS = [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];

// expo-file-system / expo-image-picker pull these in without a maxSdkVersion
// cap. The app only ever reads/writes its own app-scoped files and picker-
// selected media (both exempt from these permissions on Android 13+), so
// Play Console flags an unbounded declaration as unused/overbroad on
// API 33+. Capping at 32 keeps legacy-storage behavior on older OS versions
// this app still supports, without requesting it where it isn't needed.
module.exports = function withScopedStoragePermissions(config) {
  return withAndroidManifest(config, (config) => {
    const usesPermission = config.modResults.manifest["uses-permission"] ?? [];

    for (const entry of usesPermission) {
      const name = entry.$?.["android:name"];
      if (!SCOPED_PERMISSIONS.includes(name)) continue;
      entry.$["android:maxSdkVersion"] = "32";
    }

    return config;
  });
};
