const RTL_CHAR_REGEX = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/
const LTR_CHAR_REGEX = /[A-Za-z]/

export type TextDirection = 'ltr' | 'rtl'

export function detectTextDirection(text: string): TextDirection {
    if (!text) return 'ltr'

    // Count a small sample of chars to avoid O(n) on huge lyric blobs.
    const sample = text.length > 4000 ? text.slice(0, 4000) : text
    let rtl = 0
    let ltr = 0

    for (let i = 0; i < sample.length; i++) {
        const ch = sample[i]
        if (RTL_CHAR_REGEX.test(ch)) rtl++
        else if (LTR_CHAR_REGEX.test(ch)) ltr++
    }

    // If we see any RTL characters and they are not clearly outnumbered,
    // prefer RTL. This matches typical Hebrew/Arabic song metadata.
    if (rtl > 0 && rtl >= ltr) return 'rtl'
    return 'ltr'
}
