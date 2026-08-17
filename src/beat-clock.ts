// One beat grid is the timing authority for the whole page: the background
// beat ticks on it, the looper snaps its start and length to it, and the
// breathing animation reads its phase. Sharing one grid is what keeps a loop
// and the beat locked together instead of drifting apart a little every cycle.

export interface BeatGrid {
  /** AudioContext time the grid starts from. */
  originTime: number;
  bpm: number;
}

export const DEFAULT_BPM = 96;

export interface Beat {
  index: number;
  time: number;
}

export function beatInterval(bpm: number): number {
  return bpm > 0 ? 60 / bpm : 0;
}

export function beatTime(grid: BeatGrid, beatIndex: number): number {
  return grid.originTime + beatIndex * beatInterval(grid.bpm);
}

export function beatIndexAt(grid: BeatGrid, time: number): number {
  const interval = beatInterval(grid.bpm);
  if (interval <= 0) return 0;
  return Math.floor((time - grid.originTime) / interval);
}

/** Every beat landing in [from, to). Empty for an inverted or empty window. */
export function beatsInWindow(grid: BeatGrid, from: number, to: number): Beat[] {
  const interval = beatInterval(grid.bpm);
  if (interval <= 0 || to <= from) return [];
  const beats: Beat[] = [];
  let index = Math.ceil((from - grid.originTime) / interval);
  for (;;) {
    const time = grid.originTime + index * interval;
    if (time >= to) break;
    if (time >= from) beats.push({ index, time });
    index += 1;
  }
  return beats;
}

export function snapToNearestBeat(grid: BeatGrid, time: number): number {
  const interval = beatInterval(grid.bpm);
  if (interval <= 0) return time;
  return grid.originTime + Math.round((time - grid.originTime) / interval) * interval;
}

/** 0 exactly on a beat, rising to just under 1 immediately before the next. */
export function beatPhase(grid: BeatGrid, time: number): number {
  const interval = beatInterval(grid.bpm);
  if (interval <= 0) return 0;
  const beats = (time - grid.originTime) / interval;
  return ((beats % 1) + 1) % 1;
}
