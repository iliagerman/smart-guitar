import { usePlaybackStore } from '@/stores/playback.store'
import { usePlayerPrefsStore } from '@/stores/player-prefs.store'
import type { LyricsSegment } from '@/types/song'

interface LyricsSyncDebugProps {
  segments: LyricsSegment[]
  activeSegmentIndex: number
  activeWordIndex: number
  lyricsSource: string | null
}

export function LyricsSyncDebug({
  segments,
  activeSegmentIndex,
  activeWordIndex,
  lyricsSource,
}: LyricsSyncDebugProps) {
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const lyricsOffsetMs = usePlayerPrefsStore((s) => s.lyricsOffsetMs)

  const adjustedTime = currentTime - lyricsOffsetMs / 1000

  const seg = activeSegmentIndex >= 0 ? segments[activeSegmentIndex] : null
  const word = seg && activeWordIndex >= 0 ? seg.words[activeWordIndex] : null

  const totalWords = segments.reduce((sum, s) => sum + s.words.length, 0)

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg bg-charcoal-900/90 border border-charcoal-700 p-3 font-mono text-xs text-smoke-200 shadow-lg backdrop-blur-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-smoke-400 font-semibold text-[10px] uppercase tracking-wider">
          Lyrics Sync Debug
        </span>
        <span className="text-[10px] text-smoke-500">Ctrl+Shift+D to close</span>
      </div>

      <div className="space-y-1">
        <Row label="Source" value={lyricsSource ?? 'unknown'} />
        <Row label="Segments" value={`${segments.length} (${totalWords} words)`} />
        <Divider />
        <Row label="Raw time" value={fmt(currentTime)} />
        <Row label="Offset" value={`${lyricsOffsetMs}ms`} />
        <Row label="Adj time" value={fmt(adjustedTime)} />
        <Divider />
        <Row
          label="Segment"
          value={
            seg
              ? `#${activeSegmentIndex} [${fmt(seg.start)}-${fmt(seg.end)}]`
              : 'none'
          }
        />
        <Row
          label="Word"
          value={
            word
              ? `#${activeWordIndex} "${word.word}" [${fmt(word.start)}-${fmt(word.end)}]`
              : 'none'
          }
        />
        {word && (
          <>
            <Row
              label="Delta start"
              value={`${((adjustedTime - word.start) * 1000).toFixed(0)}ms`}
              highlight={Math.abs(adjustedTime - word.start) > 0.3}
            />
            <Row
              label="Delta end"
              value={`${((word.end - adjustedTime) * 1000).toFixed(0)}ms`}
              highlight={adjustedTime > word.end}
            />
          </>
        )}
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-smoke-500 shrink-0">{label}</span>
      <span className={`text-right truncate ${highlight ? 'text-flame-400' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-charcoal-700/50" />
}

function fmt(t: number): string {
  return t.toFixed(3) + 's'
}
