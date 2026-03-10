import type { SongRanking } from '@/types/analytics'
import { EmptyState } from '@/components/shared/EmptyState'

export function SongRankingsTable({ songs }: { songs: SongRanking[] }) {
    return (
        <section className="rounded-2xl border border-charcoal-800 bg-charcoal-900/70 p-4">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-smoke-100">Top songs</h2>
                <p className="text-sm text-smoke-400">Most played songs and how many unique users touched them.</p>
            </div>
            {songs.length === 0 ? (
                <EmptyState title="No song plays yet" description="Song rankings will show up after users start playing tracks." className="py-10" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="border-b border-charcoal-800 text-left text-smoke-400">
                                <th className="px-3 py-2 font-medium">Song</th>
                                <th className="px-3 py-2 font-medium">Plays</th>
                                <th className="px-3 py-2 font-medium">Unique users</th>
                            </tr>
                        </thead>
                        <tbody>
                            {songs.map((song) => (
                                <tr key={song.song_id ?? song.song_title ?? 'unknown'} className="border-b border-charcoal-900/80">
                                    <td className="px-3 py-3 text-smoke-200">{song.song_title ?? 'Unknown song'}</td>
                                    <td className="px-3 py-3 text-smoke-300">{song.play_count.toLocaleString()}</td>
                                    <td className="px-3 py-3 text-smoke-300">{song.unique_users.toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    )
}
