import UserNotifications

// Downloads and attaches the doctor's profile photo (or any rich-content
// image) to an incoming push notification before it's displayed.
//
// Expo's push relay nests the `richContent: { image: <url> }` field we send
// from the edge functions (see supabase/functions/handle-consultation-notification
// and send-appointment-notification) under `body._richContent.image` in the
// final APNs payload — confirmed against Expo's own reference implementation
// (github.com/expo/expo/pull/36202). `mutableContent: true` in the same
// payload is what causes iOS to invoke this extension at all.
class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    guard
      let body = request.content.userInfo["body"] as? [String: Any],
      let richContent = body["_richContent"] as? [String: Any],
      let imageUrlString = richContent["image"] as? String,
      let imageUrl = URL(string: imageUrlString)
    else {
      contentHandler(bestAttemptContent)
      return
    }

    downloadAndAttachImage(url: imageUrl, to: bestAttemptContent) { content in
      contentHandler(content)
    }
  }

  private func downloadAndAttachImage(
    url: URL,
    to content: UNMutableNotificationContent,
    completion: @escaping (UNNotificationContent) -> Void
  ) {
    let task = URLSession.shared.downloadTask(with: url) { temporaryFileLocation, _, error in
      guard let temporaryFileLocation = temporaryFileLocation, error == nil else {
        completion(content)
        return
      }

      let fileManager = FileManager.default
      let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory())
      let fileExtension = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
      let targetUrl = tempDirectory.appendingPathComponent(UUID().uuidString + "." + fileExtension)

      do {
        try fileManager.moveItem(at: temporaryFileLocation, to: targetUrl)
        let attachment = try UNNotificationAttachment(identifier: "image", url: targetUrl, options: nil)
        content.attachments = [attachment]
      } catch {
        // No attachment — notification still displays with its original text.
      }

      completion(content)
    }
    task.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    // iOS gives this extension a ~30 second budget. If the image download
    // hasn't finished by then, deliver whatever we have (no image) rather
    // than let the notification disappear entirely.
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }
}
