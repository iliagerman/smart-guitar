import { describe, it, expect } from 'vitest'
import { describeEventClient, describeEventDetails } from './event-details'

const CLIENT = {
    device: 'iPhone',
    os: 'iOS 18.5',
    browser: 'Safari 18.5',
    standalone: false,
    viewport: '390x844',
    app_version: 'v1300 · 0af270d · 2026-10-13 09:00',
}

describe('describeEventClient', () => {
    it('summarises the device, with the build and screen as secondary detail', () => {
        expect(describeEventClient({ path: '/songs', client: CLIENT })).toEqual({
            summary: 'iPhone · iOS 18.5 · Safari 18.5',
            detail: 'v1300 · 0af270d · 2026-10-13 09:00 · 390x844',
        })
    })

    it('marks the installed home-screen app', () => {
        expect(describeEventClient({ client: { ...CLIENT, browser: 'Home screen app', standalone: true } })?.summary).toBe(
            'iPhone · iOS 18.5 · Home screen app · installed',
        )
    })

    it('has nothing to say for events recorded before the device was tracked', () => {
        expect(describeEventClient({ path: '/songs' })).toBeNull()
        expect(describeEventClient(null)).toBeNull()
    })
})

describe('describeEventDetails', () => {
    it('lists every property but the client, in the order it was recorded', () => {
        expect(
            describeEventDetails({
                position: 0.4,
                plan: 'free',
                sheet: 'Sheet 1',
                sheet_timing: 'estimated',
                count_in: true,
                client: CLIENT,
            }),
        ).toEqual([
            { key: 'position', value: '0.4' },
            { key: 'plan', value: 'free' },
            { key: 'sheet', value: 'Sheet 1' },
            { key: 'sheet_timing', value: 'estimated' },
            { key: 'count_in', value: 'true' },
        ])
    })

    it('flattens lists and nested values into readable text', () => {
        expect(describeEventDetails({ stems: ['guitar'], volumes: { vocals: 0, guitar: 1 } })).toEqual([
            { key: 'stems', value: 'guitar' },
            { key: 'volumes', value: '{"vocals":0,"guitar":1}' },
        ])
    })

    it('is empty when there is nothing beyond the client', () => {
        expect(describeEventDetails({ client: CLIENT })).toEqual([])
        expect(describeEventDetails(null)).toEqual([])
    })
})
