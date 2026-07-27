const fs = require("fs");

// FCM push registration on Android silently no-ops if android.package doesn't
// match a package_name in google-services.json — no crash, no log, notifications
// just never arrive. Fail the build/start loudly instead of shipping that.
// (iOS uses PushKit/CallKit, not Firebase, so GoogleService-Info.plist is a
// documented placeholder and is intentionally not checked here.)
function assertAndroidFirebaseConfigMatches(androidPackage, googleServicesPath) {
  if (!androidPackage || !fs.existsSync(googleServicesPath)) return;

  const googleServices = JSON.parse(fs.readFileSync(googleServicesPath, "utf8"));
  const registeredPackages = (googleServices.client ?? [])
    .map((c) => c.client_info?.android_client_info?.package_name)
    .filter(Boolean);

  if (!registeredPackages.includes(androidPackage)) {
    throw new Error(
      `Firebase config drift: app.json android.package is "${androidPackage}", but ` +
        `${googleServicesPath} has no client entry for it (found: ${registeredPackages.join(", ") || "none"}). ` +
        `Android push notifications would silently fail to register. Add an Android app for ` +
        `"${androidPackage}" in the Firebase console and re-download google-services.json.`
    );
  }
}

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json";

  assertAndroidFirebaseConfigMatches(config.android?.package, googleServicesFile);

  return {
    ...config,
    android: {
      ...config.android,
      googleServicesFile,
    },
  };
};
