import { useEffect } from 'react'

/**
 * Mobile browsers can overlay UI (URL bar / bottom toolbar) on top of the page.
 * `window.visualViewport` gives us the *visible* viewport, which we use to:
 * - set `--vv-height` so our app shell uses the real visible height
 * - set `--vv-bottom-offset` so fixed bottom nav can sit above overlays/keyboard
 */
export function VisualViewportVars() {
    useEffect(() => {
        const root = document.documentElement

        function update() {
            const vv = window.visualViewport

            if (!vv) {
                root.style.setProperty('--vv-height', '100dvh')
                root.style.setProperty('--vv-bottom-offset', '0px')
                return
            }

            // `vv.height + vv.offsetTop` is the bottom edge of the visible viewport,
            // relative to the layout viewport (`window.innerHeight`).
            const bottomOffset = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))

            root.style.setProperty('--vv-height', `${Math.round(vv.height)}px`)
            root.style.setProperty('--vv-bottom-offset', `${Math.round(bottomOffset)}px`)
        }

        update()

        const vv = window.visualViewport
        vv?.addEventListener('resize', update)
        vv?.addEventListener('scroll', update)
        window.addEventListener('resize', update)
        window.addEventListener('orientationchange', update)

        return () => {
            vv?.removeEventListener('resize', update)
            vv?.removeEventListener('scroll', update)
            window.removeEventListener('resize', update)
            window.removeEventListener('orientationchange', update)
        }
    }, [])

    return null
}
