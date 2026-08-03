const { withAndroidManifest } = require("@expo/config-plugins");

const TARGET_NAMES = [
  "com.google.firebase.messaging.default_notification_channel_id",
  "com.google.firebase.messaging.default_notification_color",
];

// expo-notifications' `defaultChannel`/`icon`/`color` config and
// @react-native-firebase/messaging both declare these meta-data keys,
// which fails the manifest merge unless one is marked to win.
module.exports = function withFirebaseMessagingManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const metaData = application?.["meta-data"] ?? [];

    for (const entry of metaData) {
      const name = entry.$?.["android:name"];
      if (!TARGET_NAMES.includes(name)) continue;

      if (entry.$["android:value"] !== undefined) {
        entry.$["tools:replace"] = "android:value";
      } else if (entry.$["android:resource"] !== undefined) {
        entry.$["tools:replace"] = "android:resource";
      }
    }

    return config;
  });
};
