declare module 'runtime-observer/browser' {
  interface BrowserObserverConfig {
    endpoint: string
    apiKey: string
    projectName: string
    serviceName: string
  }

  interface BrowserObserver {
    installBrowserHooks(): void
    instrumentFetch(): void
    captureNavigation(): void
    emit(eventType: string, payload: Record<string, unknown>): void
  }

  export function initBrowserObserver(config: BrowserObserverConfig): BrowserObserver
}
