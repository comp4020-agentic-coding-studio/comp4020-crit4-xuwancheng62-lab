import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BeatGrid } from "../src/beat-clock";
import type { PadEvent } from "../src/loop-model";
import { Looper, advanceLabel } from "../src/looper";
import type { PadId } from "../src/pads";

// A fake clock stands in for AudioContext.currentTime, which is the whole
// reason the Looper takes its clock as a dependency: the record/overdub
// lifecycle is checkable here in milliseconds instead of in real time.
function fakeClock(start = 0) {
  let time = start;
  return {
    now: () => time,
    set(value: number) {
      time = value;
    },
    advance(delta: number) {
      time += delta;
    },
  };
}

const GRID: BeatGrid = { originTime: 0, bpm: 120 }; // 0.5s per beat, 4-beat minimum loop
const BEAT = 0.5;
const PARAMS = { semitones: 0, brightness: 0.5 };

let clock: ReturnType<typeof fakeClock>;
let triggered: { padId: PadId; time: number }[];
let looper: Looper;

beforeEach(() => {
  clock = fakeClock(0);
  triggered = [];
  looper = new Looper({
    now: clock.now,
    grid: () => GRID,
    trigger: (event: PadEvent, absoluteTime: number) =>
      triggered.push({ padId: event.padId, time: absoluteTime }),
  });
});

/** Drive the scheduling poll forward to `untilTime`, as the real 25ms interval would. */
function pollUntil(untilTime: number, stepSeconds = 0.025) {
  while (clock.now() < untilTime) {
    looper.tick();
    clock.advance(stepSeconds);
  }
  looper.tick();
}

function recordOneNote(padId: PadId = "a", pressAt = 0.1, releaseAt = 0.2, closeAt = 2) {
  looper.advance(); // -> recording
  clock.set(pressAt);
  looper.recordPress(padId, PARAMS);
  clock.set(releaseAt);
  looper.recordRelease(padId);
  clock.set(closeAt);
  looper.advance(); // -> playing
}

describe("the cycling loop control", () => {
  it("names its next action at every step", () => {
    expect(advanceLabel("empty")).toBe("Record");
    expect(advanceLabel("recording")).toBe("Stop");
    expect(advanceLabel("playing")).toBe("Overdub");
    expect(advanceLabel("overdubbing")).toBe("Done");
  });

  it("walks empty -> recording -> playing -> overdubbing -> playing", () => {
    expect(looper.state).toBe("empty");
    looper.advance();
    expect(looper.state).toBe("recording");
    clock.set(0.1);
    looper.recordPress("a", PARAMS);
    looper.recordRelease("a");
    clock.set(2);
    looper.advance();
    expect(looper.state).toBe("playing");
    looper.advance();
    expect(looper.state).toBe("overdubbing");
    looper.advance();
    expect(looper.state).toBe("playing");
  });

  it("falls back to empty when the recording pass captured nothing", () => {
    looper.advance();
    clock.set(2);
    looper.advance();
    expect(looper.state).toBe("empty");
    expect(looper.hasLoop).toBe(false);
  });

  it("reports each state change once, in order", () => {
    const seen: string[] = [];
    const watched = new Looper({
      now: clock.now,
      grid: () => GRID,
      trigger: () => {},
      onStateChange: (state) => seen.push(state),
    });
    watched.advance();
    clock.set(0.1);
    watched.recordPress("a", PARAMS);
    watched.recordRelease("a");
    clock.set(2);
    watched.advance();
    watched.clear();
    expect(seen).toEqual(["recording", "playing", "empty"]);
  });
});

describe("recording and replay", () => {
  it("replays the recorded note once per cycle, forever", () => {
    recordOneNote();
    pollUntil(7);
    expect(triggered.map((entry) => entry.time)).toEqual([2.1, 4.1, 6.1]);
    expect(triggered.every((entry) => entry.padId === "a")).toBe(true);
  });

  it("spaces consecutive repeats exactly one loop length apart", () => {
    recordOneNote();
    pollUntil(9);
    const times = triggered.map((entry) => entry.time);
    for (let index = 1; index < times.length; index += 1) {
      expect(times[index] - times[index - 1]).toBeCloseTo(looper.loopLengthSeconds);
    }
  });

  it("closes to a whole number of beats, so it cannot drift off the beat", () => {
    // Start and stop deliberately off the grid.
    clock.set(0.13);
    looper.advance();
    clock.set(0.4);
    looper.recordPress("a", PARAMS);
    looper.recordRelease("a");
    clock.set(3.37);
    looper.advance();
    const beats = looper.loopLengthSeconds / BEAT;
    expect(beats).toBeCloseTo(Math.round(beats));
    expect(Math.round(beats)).toBeGreaterThanOrEqual(4);
  });

  it("keeps a note played a moment before the loop closed", () => {
    looper.advance();
    clock.set(0.1);
    looper.recordPress("a", PARAMS);
    looper.recordRelease("a");
    clock.set(1.95);
    looper.recordPress("s", PARAMS); // still held when the loop closes
    clock.set(2);
    looper.advance();
    pollUntil(4.5);
    expect(new Set(triggered.map((entry) => entry.padId))).toEqual(new Set(["a", "s"]));
  });

  it("records the pitch and brightness a gesture was played with", () => {
    const captured: PadEvent[] = [];
    const watched = new Looper({
      now: clock.now,
      grid: () => GRID,
      trigger: (event) => captured.push(event),
      onStateChange: () => {},
    });
    watched.advance();
    clock.set(0.1);
    watched.recordPress("f", { semitones: 7, brightness: 0.9 });
    clock.set(0.3);
    watched.recordDrag("f", { semitones: -2, brightness: 0.2 });
    clock.set(0.5);
    watched.recordRelease("f");
    clock.set(2);
    watched.advance();

    // Poll the watched looper to get the event back out.
    for (let step = 0; step < 200 && captured.length === 0; step += 1) {
      watched.tick();
      clock.advance(0.025);
    }
    expect(captured.length).toBeGreaterThan(0);
    const event = captured[0];
    expect(event.breakpoints).toHaveLength(2);
    expect(event.breakpoints[0]).toMatchObject({ semitones: 7, brightness: 0.9 });
    expect(event.breakpoints[1].semitones).toBe(-2);
    expect(event.breakpoints[1].offsetSeconds).toBeCloseTo(0.2);
    expect(event.heldSeconds).toBeCloseTo(0.4);
  });

  it("ignores presses when it is not capturing", () => {
    looper.recordPress("a", PARAMS);
    looper.recordRelease("a");
    clock.set(3);
    pollUntil(6);
    expect(triggered).toEqual([]);
  });

  it("never double-fires when polled faster than the clock advances", () => {
    recordOneNote();
    for (let step = 0; step < 50; step += 1) looper.tick(); // 50 polls, no time passing
    pollUntil(7);
    const times = triggered.map((entry) => entry.time);
    expect(new Set(times).size).toBe(times.length);
  });

  it("drops nothing when a poll arrives very late", () => {
    recordOneNote();
    clock.set(2.05);
    looper.tick();
    clock.set(6.05); // a four-second stall, several cycles' worth
    looper.tick();
    expect(triggered.length).toBeGreaterThanOrEqual(3);
    expect(new Set(triggered.map((entry) => entry.time)).size).toBe(triggered.length);
  });
});

describe("overdubbing", () => {
  it("adds a layer without losing the original", () => {
    recordOneNote("a");
    looper.advance(); // -> overdubbing
    clock.set(2.5);
    looper.recordPress("s", PARAMS);
    clock.set(2.6);
    looper.recordRelease("s");
    looper.advance(); // -> playing
    pollUntil(9);
    const pads = new Set(triggered.map((entry) => entry.padId));
    expect(pads).toEqual(new Set(["a", "s"]));
  });

  it("accumulates three layers across two overdub passes", () => {
    recordOneNote("a");
    for (const [padId, at] of [
      ["s", 2.5],
      ["d", 4.7],
    ] as const) {
      looper.advance();
      clock.set(at);
      looper.recordPress(padId, PARAMS);
      looper.recordRelease(padId);
      looper.advance();
    }
    triggered = [];
    pollUntil(13);
    expect(new Set(triggered.map((entry) => entry.padId))).toEqual(new Set(["a", "s", "d"]));
  });

  it("wraps a late overdub into the cycle instead of extending the loop", () => {
    recordOneNote("a");
    const lengthBefore = looper.loopLengthSeconds;
    looper.advance();
    clock.set(3.9); // most of a cycle past the loop start
    looper.recordPress("s", PARAMS);
    looper.recordRelease("s");
    looper.advance();
    expect(looper.loopLengthSeconds).toBe(lengthBefore);
    triggered = [];
    pollUntil(9);
    const spacing = triggered
      .filter((entry) => entry.padId === "s")
      .map((entry, index, all) => (index === 0 ? lengthBefore : entry.time - all[index - 1].time));
    for (const gap of spacing) expect(gap).toBeCloseTo(lengthBefore);
  });

  it("keeps playing the existing loop while overdubbing", () => {
    recordOneNote("a");
    looper.advance(); // -> overdubbing
    pollUntil(7);
    expect(triggered.filter((entry) => entry.padId === "a").length).toBeGreaterThanOrEqual(2);
  });
});

describe("clearing", () => {
  it("stops everything and returns to empty", () => {
    recordOneNote();
    pollUntil(4.5);
    expect(triggered.length).toBeGreaterThan(0);

    looper.clear();
    expect(looper.state).toBe("empty");
    expect(looper.hasLoop).toBe(false);

    triggered = [];
    pollUntil(12);
    expect(triggered).toEqual([]);
  });

  it("can record a fresh loop after a clear", () => {
    recordOneNote("a");
    looper.clear();
    clock.set(10);
    recordOneNote("d", 10.1, 10.2, 12);
    triggered = [];
    pollUntil(17);
    expect(triggered.length).toBeGreaterThan(0);
    expect(triggered.every((entry) => entry.padId === "d")).toBe(true);
  });
});

describe("the injected clock is the only clock", () => {
  it("does not read wall-clock time", () => {
    const spy = vi.spyOn(Date, "now");
    recordOneNote();
    pollUntil(6);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
