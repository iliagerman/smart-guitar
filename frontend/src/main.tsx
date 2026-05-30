import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import './index.css'
import { initAmplifyAuth } from '@/lib/amplify'
import { initMetaPixel } from '@/lib/meta-pixel'
import { initRuntimeObserver } from '@/lib/runtime-observer'

initAmplifyAuth()
initMetaPixel()
initRuntimeObserver()

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    // Check for SW updates on every page load
    registration.update()
    // Re-check when the tab regains focus (user returning to the app)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update()
      }
    })
  },
})

// Reload the page when a new service worker takes control (new deploy)
let reloading = false
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (reloading) return
  reloading = true
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
