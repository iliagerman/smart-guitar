function base64UrlToBase64(input: string): string {
    const padLength = (4 - (input.length % 4)) % 4
    const padded = input + '='.repeat(padLength)
    return padded.replace(/-/g, '+').replace(/_/g, '/')
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split('.')
    if (parts.length < 2) return null

    try {
        const json = atob(base64UrlToBase64(parts[1]))
        return JSON.parse(json) as Record<string, unknown>
    } catch {
        return null
    }
}

export function getEmailFromIdToken(idToken: string): string | null {
    const payload = decodeJwtPayload(idToken)
    const email = payload?.email
    return typeof email === 'string' ? email : null
}
