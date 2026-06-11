/**
 * Find the active item for a playback time: the most recently started item
 * (last index whose start <= time), or -1 before the first item starts and
 * after the last item ends.
 *
 * Selecting by "last started" instead of interval containment makes the
 * result monotonic in time — the highlight can never jump backward — even
 * when item boundaries overlap or are slightly corrupted. During gaps the
 * previous item stays active, matching the old gap-handling behavior.
 */
export function findActiveTimedIndex(
  length: number,
  time: number,
  getStart: (index: number) => number,
  getEnd: (index: number) => number,
): number {
  let active = -1
  for (let i = 0; i < length; i++) {
    if (time >= getStart(i)) {
      active = i
    }
  }
  if (active === length - 1 && active >= 0 && time >= getEnd(active)) {
    return -1
  }
  return active
}
