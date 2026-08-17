import { describe, expect, it } from "vitest";
import type { BeatGrid } from "../src/beat-clock";
import {
  EMPTY_RECORDING,
  type LoopRecording,
  MINIMUM_LOOP_BEATS,
  type PadEvent,
  clearRecording,
  isEmpty,
  loopEventsInWindow,
  overdub,
  snapLoopLength,
  wrapOffset,
} from "../src/loop-model";
import type { PadId } from "../src/pads";

const grid: BeatGrid = { originTime: 0, bpm: 120 }; // 0.5s per beat

function event(padId: PadId, pressOffsetSeconds: number): PadEvent {
  return {
    padId,
    pressOffsetSeconds,
    heldSeconds: null,
    breakpoints: [{ offsetSeconds: 0, semitones: 0, brightness: 0.5 }],
  };
}

function recording(loopLengthSeconds: number, events: PadEvent[]): LoopRecording {
  return { loopLengthSeconds, events };
}

describe("snapLoopLength", () => {
  it("rounds to the nearest whole beat, so the loop cannot drift off the beat", () => {
    expect(snapLoopLength(3.7, grid)).toBeCloseTo(3.5); // 7.4 beats -> 7
    expect(snapLoopLength(3.8, grid)).toBeCloseTo(4); // 7.6 beats -> 8
  });

  it("always returns a whole number of beats", () => {
    for (const raw of [2.1, 3.3, 4.9, 7.7, 11.2]) {
      const beats = snapLoopLength(raw, grid) / 0.5;
      expect(beats).toBeCloseTo(Math.round(beats));
    }
  });

  it("floors an accidental tap to a usable minimum rather than a silent loop", () => {
    expect(snapLoopLength(0.05, grid)).toBeCloseTo(MINIMUM_LOOP_BEATS * 0.5);
    expect(snapLoopLength(0, grid)).toBeCloseTo(MINIMUM_LOOP_BEATS * 0.5);
  });

  it("does not divide by zero on a nonsensical tempo", () => {
    expect(snapLoopLength(3, { originTime: 0, bpm: 0 })).toBe(3);
  });
});

describe("wrapOffset", () => {
  it("folds an offset past the end back to the start", () => {
    expect(wrapOffset(2.1, 2)).toBeCloseTo(0.1);
  });

  it("folds a negative offset to the end of the loop", () => {
    expect(wrapOffset(-0.1, 2)).toBeCloseTo(1.9);
  });

  it("leaves an in-range offset alone", () => {
    expect(wrapOffset(0.75, 2)).toBeCloseTo(0.75);
  });
});

describe("overdub", () => {
  it("keeps every original event and adds the new ones, sorted", () => {
    const base = recording(2, [event("a", 0), event("s", 1)]);
    const merged = overdub(base, [event("d", 0.5)]);
    expect(merged.events.map((e) => e.padId)).toEqual(["a", "d", "s"]);
    expect(merged.loopLengthSeconds).toBe(2);
  });

  it("accumulates across two passes without losing a layer", () => {
    const first = overdub(recording(2, [event("a", 0)]), [event("s", 0.5)]);
    const second = overdub(first, [event("d", 1.5)]);
    expect(second.events).toHaveLength(3);
    expect(second.events.map((e) => e.padId)).toEqual(["a", "s", "d"]);
  });

  it("is a no-op for an empty pass", () => {
    const base = recording(2, [event("a", 0)]);
    expect(overdub(base, [])).toBe(base);
  });

  it("does not extend the loop for an overdub, only add to it", () => {
    const merged = overdub(recording(2, [event("a", 0)]), [event("f", 1.9)]);
    expect(merged.loopLengthSeconds).toBe(2);
  });
});

describe("loopEventsInWindow", () => {
  it("is empty for an empty recording, whatever the window", () => {
    expect(loopEventsInWindow(EMPTY_RECORDING, 0, 0, 100)).toEqual([]);
    expect(loopEventsInWindow(clearRecording(), 0, 0, 100)).toEqual([]);
    expect(isEmpty(EMPTY_RECORDING)).toBe(true);
  });

  it("finds an event in the first cycle", () => {
    const due = loopEventsInWindow(recording(2, [event("a", 0)]), 0, 0, 0.05);
    expect(due).toHaveLength(1);
    expect(due[0].absoluteTime).toBeCloseTo(0);
  });

  it("repeats the event once per cycle the window covers", () => {
    const due = loopEventsInWindow(recording(2, [event("a", 0)]), 0, 1.9, 4.3);
    expect(due.map((entry) => entry.absoluteTime)).toEqual([2, 4]);
  });

  it("handles a window straddling a cycle boundary", () => {
    // Two events, one near the end of a cycle and one on the downbeat: a
    // window across the seam must return both, in order, exactly once.
    const due = loopEventsInWindow(recording(2, [event("a", 0), event("s", 1.8)]), 0, 1.7, 2.1);
    expect(due.map((entry) => [entry.event.padId, entry.absoluteTime])).toEqual([
      ["s", 1.8],
      ["a", 2],
    ]);
  });

  it("excludes the upper bound so butt-joined windows cannot double-fire", () => {
    const loop = recording(2, [event("a", 0)]);
    const first = loopEventsInWindow(loop, 0, 1.9, 2);
    const second = loopEventsInWindow(loop, 0, 2, 2.1);
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it("fires nothing before the loop has started", () => {
    expect(loopEventsInWindow(recording(2, [event("a", 0)]), 5, 0, 1)).toEqual([]);
  });

  it("is empty for an inverted window", () => {
    expect(loopEventsInWindow(recording(2, [event("a", 0)]), 0, 2, 1)).toEqual([]);
  });

  it("drops no repeat and duplicates none across a long run of polls", () => {
    // The end-to-end property that matters: poll after poll, every event fires
    // exactly once per cycle. A dropped hit is a hole in the groove and a
    // doubled one is a flam, and both are much easier to assert than to hear.
    const loop = recording(2, [event("a", 0), event("s", 0.75), event("d", 1.5)]);
    const times: number[] = [];
    let scheduledUpTo = 0;
    for (let poll = 0; poll < 400; poll += 1) {
      const now = poll * 0.025;
      const to = now + 0.1;
      if (to <= scheduledUpTo) continue;
      for (const entry of loopEventsInWindow(loop, 0, scheduledUpTo, to)) {
        times.push(entry.absoluteTime);
      }
      scheduledUpTo = to;
    }
    const cycles = Math.floor(scheduledUpTo / 2);
    expect(times.length).toBeGreaterThanOrEqual(cycles * 3);
    expect(new Set(times).size).toBe(times.length); // no duplicates
    expect([...times]).toEqual([...times].sort((left, right) => left - right)); // in order
  });
});
