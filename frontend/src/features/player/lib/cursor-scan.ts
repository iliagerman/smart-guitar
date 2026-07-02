/**
 * Mutable forward-scan position shared across repeated calls to the
 * `scanForward*` helpers below. Playback time is monotonic almost all of the
 * time, so re-scanning from the cursor instead of from the start turns an
 * O(n) per-frame scan into O(1) amortized. Create a fresh cursor (rather than
 * mutating an existing one) whenever the underlying data array changes.
 */
export interface ScanCursor {
  index: number
}

export function createScanCursor(): ScanCursor {
  return { index: -1 }
}

/**
 * Cursor-based version of `findActiveTimedIndex`: the most recently started
 * item (last index whose start <= time), or -1 before the first item starts
 * and after the last item ends. Assumes `getStart` is non-decreasing in
 * index (items are sorted by start time).
 *
 * Scans forward from the cursor's previous result. Automatically rescans
 * from the start when time moves backward (a seek) past the cursor's item.
 */
export function scanForwardActiveTimedIndex(
  length: number,
  time: number,
  getStart: (index: number) => number,
  getEnd: (index: number) => number,
  cursor: ScanCursor,
): number {
  const active = advanceCursor(length, time, getStart, cursor)
  if (active === length - 1 && active >= 0 && time >= getEnd(active)) {
    return -1
  }
  return active
}

/**
 * Cursor-based version of `findActiveChordIndex`: the most recently started
 * item, with no expiry (stays on the last item forever once time passes it).
 * Assumes `getStart` is non-decreasing in index.
 */
export function scanForwardMostRecentStarted(
  length: number,
  time: number,
  getStart: (index: number) => number,
  cursor: ScanCursor,
): number {
  return advanceCursor(length, time, getStart, cursor)
}

function advanceCursor(
  length: number,
  time: number,
  getStart: (index: number) => number,
  cursor: ScanCursor,
): number {
  if (cursor.index >= length) {
    cursor.index = -1
  }
  if (cursor.index >= 0 && time < getStart(cursor.index)) {
    // Time moved backward past the cursor's item — a seek. Rescan from the start.
    cursor.index = -1
  }

  let active = cursor.index
  let i = cursor.index + 1
  while (i < length && time >= getStart(i)) {
    active = i
    i++
  }
  cursor.index = active
  return active
}
