// Web Push service worker for Dawa (patient + doctor web).
// Registered once per session by useWebPushSubscription.ts. Routing logic is
// intentionally NOT duplicated here — the server (send-appointment-notification /
// handle-consultation-notification edge functions) sends a precomputed `url`
// in the push payload's data, and this worker just opens/focuses it.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    return
  }

  const title = payload.title || 'Dawa'
  const options = {
    body: payload.body || '',
    icon: '/logo-dark.png',
    badge: '/logo-dark.png',
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus()
        }
      }
      if (clientList.length > 0 && 'focus' in clientList[0]) {
        clientList[0].navigate(targetUrl)
        return clientList[0].focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
