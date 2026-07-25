const { withAndroidManifest } = require("@expo/config-plugins");

// Android 11+ package visibility hides other apps from queryIntentActivities
// (used by Linking.canOpenURL) unless declared here. Needed so the Help &
// Support WhatsApp button can detect whether WhatsApp is installed before
// opening it, falling back to wa.me otherwise.
module.exports = function withWhatsAppQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.queries = manifest.queries ?? [{}];
    const queries = manifest.queries[0];
    queries.package = queries.package ?? [];

    const alreadyDeclared = queries.package.some(
      (entry) => entry.$?.["android:name"] === "com.whatsapp"
    );
    if (!alreadyDeclared) {
      queries.package.push({ $: { "android:name": "com.whatsapp" } });
    }

    return config;
  });
};
