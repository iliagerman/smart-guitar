import { songDetailPath } from '@/router/routes'

/**
 * Request browser notification permission (non-blocking, safe to call multiple times).
 * Only prompts the user once — subsequent calls are no-ops if already granted/denied.
 */
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return
  if (Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

/**
 * Show a browser notification. Falls back silently if permission was not granted
 * or the Notification API is unavailable.
 */
export function showBrowserNotification(opts: {
  title: string
  body: string
  songId: string
  tag: string
}) {
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return

  const notification = new Notification(opts.title, {
    body: opts.body,
    icon: '/icons/icon-192x192.png',
    tag: opts.tag,
  })

  notification.onclick = () => {
    window.focus()
    window.location.href = songDetailPath(opts.songId)
    notification.close()
  }
}
