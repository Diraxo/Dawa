/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'notification-service',
  displayName: 'Dawa Notification Service',
  // No entitlements needed — the extension only downloads a public image URL,
  // it doesn't share an App Group or any data with the main app.
}
