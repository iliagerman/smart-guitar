import { initBrowserObserver } from 'runtime-observer/browser'
import { env } from '@/config/env'

export function initRuntimeObserver() {
  if (!env.runtimeObserverEnabled || !env.runtimeObserverApiKey) {
    return
  }

  const observer = initBrowserObserver({
    endpoint: env.runtimeObserverEndpoint,
    apiKey: env.runtimeObserverApiKey,
    projectName: env.runtimeObserverProjectName,
    serviceName: 'frontend',
  })

  observer.installBrowserHooks()
  observer.instrumentFetch()
  observer.captureNavigation()
  observer.emit('log_record', {
    level: 'INFO',
    logger_name: 'browser.app',
    message: 'frontend started',
  })
}
