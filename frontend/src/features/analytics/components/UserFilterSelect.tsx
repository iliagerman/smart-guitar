import { useAnalyticsFilterStore } from '@/stores/analytics-filter.store'

export function UserFilterSelect({ emails }: { emails: string[] }) {
    const userEmail = useAnalyticsFilterStore((s) => s.userEmail)
    const setUserEmail = useAnalyticsFilterStore((s) => s.setUserEmail)

    return (
        <div className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-3">
            <label className="flex flex-col gap-2 text-sm text-smoke-300">
                <span>User filter</span>
                <input
                    list="analytics-user-emails"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="All users"
                    className="rounded-lg border border-charcoal-700 bg-charcoal-950 px-3 py-2 text-sm text-smoke-100 outline-none transition-colors focus:border-flame-400/40"
                />
            </label>
            <datalist id="analytics-user-emails">
                {emails.map((email) => (
                    <option key={email} value={email} />
                ))}
            </datalist>
        </div>
    )
}
