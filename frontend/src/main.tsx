import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'
import { initAmplifyAuth } from '@/lib/amplify'
import { initMetaPixel } from '@/lib/meta-pixel'

initAmplifyAuth()
initMetaPixel()
registerSW({ immediate: true })

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
