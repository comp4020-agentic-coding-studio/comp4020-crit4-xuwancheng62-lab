// The loop stores gestures, not audio: what was pressed, when, and how the
// pitch moved while it was held. Every repeat re-runs the real synth voices,
// so the hundredth cycle is as live as the first — a captured audio buffer
// would be a recording being played back, which is the one thing the brief
// rules out.
//
// It is also plain data and arithmetic, which is why the awkward parts (a
// window straddling a cycle boundary, an overdub landing past the loop end)
// are testable without any audio at all.

import { type BeatGrid, beatInterval } from "./beat-clock";
import type { PadId } from "./pads";

/** A pitch/brightness sample taken while a pad was held, offset from its press. */
export interface ParamBreakpoint {
  offsetSeconds: number;
  semitones: number;
  brightness: number;
}

export interface PadEvent {
  padId: PadId;
  /** Offset from the loop's start, always inside [0, loopLengthSeconds). */
  pressOffsetSeconds: number;
  /** How long it was held, or null for a percussive pad that decays on its own. */
  heldSeconds: number | null;
  /** At least one entry: the state at the moment of the press. */
  breakpoints: ParamBreakpoint[];
}

export interface LoopRecording {
  loopLengthSeconds: number;
  events: PadEvent[];
}

export interface ScheduledPadEvent {
  absoluteTime: number;
  event: PadEvent;
}

export const EMPTY_RECORDING: LoopRecording = { loopLengthSeconds: 0, events: [] };

export const MINIMUM_LOOP_BEATS = 4;

export function isEmpty(recording: LoopRecording): boolean {
  return recording.loopLengthSeconds <= 0 || recording.events.length === 0;
}

/**
 * Rounds a recorded length to whole beats on the shared grid, so the loop and
 * the background beat stay locked forever instead of sliding apart. Note
 * timing *inside* the loop is left exactly as played — snapping that too would
 * flatten the groove, which is the part a player can actually feel.
 */
export function snapLoopLength(
  rawSeconds: number,
  grid: BeatGrid,
  minimumBeats: number = MINIMUM_LOOP_BEATS,
): number {
  const interval = beatInterval(grid.bpm);
  if (interval <= 0) return Math.max(0, rawSeconds);
  const beats = Math.max(minimumBeats, Math.round(rawSeconds / interval));
  return beats * interval;
}

/** Folds any offset into [0, loopLength), including negative ones. */
export function wrapOffset(offset: number, loopLength: number): number {
  if (loopLength <= 0) return 0;
  return ((offset % loopLength) + loopLength) % loopLength;
}

/** Adds a pass on top without disturbing what is already there. */
export function overdub(base: LoopRecording, newEvents: readonly PadEvent[]): LoopRecording {
  if (newEvents.length === 0) return base;
  return {
    loopLengthSeconds: base.loopLengthSeconds,
    events: [...base.events, ...newEvents].sort(
      (left, right) => left.pressOffsetSeconds - right.pressOffsetSeconds,
    ),
  };
}

export function clearRecording(): LoopRecording {
  return EMPTY_RECORDING;
}

/**
 * Every replay landing in [from, to), in time order. The window can be shorter
 * than the loop, longer than it, or straddle a cycle boundary; each of those
 * has to yield each event exactly once per cycle it covers.
 */
export function loopEventsInWindow(
  recording: LoopRecording,
  loopStartTime: number,
  from: number,
  to: number,
): ScheduledPadEvent[] {
  const length = recording.loopLengthSeconds;
  if (length <= 0 || to <= from || recording.events.length === 0) return [];

  const firstCycle = Math.max(0, Math.floor((from - loopStartTime) / length));
  const lastCycle = Math.floor((to - loopStartTime) / length);
  if (lastCycle < firstCycle) return [];

  const due: ScheduledPadEvent[] = [];
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const cycleStart = loopStartTime + cycle * length;
    for (const event of recording.events) {
      const absoluteTime = cycleStart + event.pressOffsetSeconds;
      if (absoluteTime >= from && absoluteTime < to) due.push({ absoluteTime, event });
    }
  }
  return due.sort((left, right) => left.absoluteTime - right.absoluteTime);
}
