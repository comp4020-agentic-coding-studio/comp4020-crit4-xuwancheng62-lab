// Web Audio notes have to be scheduled slightly ahead of real time or they
// jitter audibly, so nothing is triggered "now" — a poll asks what falls into
// the next lookahead window and books it. Keeping the window arithmetic here,
// pure, is what makes "did it double-book that beat?" a unit test rather than
// something you have to hear to catch.

export interface LookaheadWindow {
  from: number;
  to: number;
}

export const LOOKAHEAD_SECONDS = 0.1;
export const POLL_INTERVAL_MS = 25;

/**
 * The stretch of time to schedule on this poll, or null when the previous
 * window already covers everything in reach. Consecutive windows are
 * half-open and butt-joined, so no instant is ever claimed twice.
 */
export function nextSchedulingWindow(
  now: number,
  lastScheduledUpTo: number,
  lookaheadSeconds: number = LOOKAHEAD_SECONDS,
): LookaheadWindow | null {
  const to = now + lookaheadSeconds;
  if (to <= lastScheduledUpTo) return null;
  return { from: lastScheduledUpTo, to };
}
