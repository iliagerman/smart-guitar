import type { ClientInfo, RecentEvent } from '@/types/analytics'

type EventProperties = RecentEvent['properties']

export interface EventClientDescription {
    /** Device, operating system and browser. */
    summary: string
    /** App build and screen size. */
    detail: string
}

export interface EventDetail {
    key: string
    value: string
}

/** The device an event came from, or null for events recorded before it was tracked. */
export function describeEventClient(properties: EventProperties): EventClientDescription | null {
    const client = properties?.client as ClientInfo | undefined
    if (!client) return null
    const summary = [client.device, client.os, client.browser, client.standalone ? 'installed' : null]
    return {
        summary: summary.filter(Boolean).join(' · '),
        detail: [client.app_version, client.viewport].filter(Boolean).join(' · '),
    }
}

function formatValue(value: unknown): string {
    if (Array.isArray(value)) return value.join(', ')
    if (value !== null && typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

/** An event's own properties (everything but the client) as readable key/value pairs. */
export function describeEventDetails(properties: EventProperties): EventDetail[] {
    return Object.entries(properties ?? {})
        .filter(([key]) => key !== 'client')
        .map(([key, value]) => ({ key, value: formatValue(value) }))
}
