import { describe, expect, it } from "vitest";
import {
  type BeatGrid,
  beatIndexAt,
  beatInterval,
  beatPhase,
  beatTime,
  beatsInWindow,
  snapToNearestBeat,
} from "../src/beat-clock";

const grid: BeatGrid = { originTime: 0, bpm: 120 }; // 0.5s per beat
const offsetGrid: BeatGrid = { originTime: 10.25, bpm: 120 };

describe("beatInterval", () => {
  it("converts bpm to seconds per beat", () => {
    expect(beatInterval(120)).toBe(0.5);
    expect(beatInterval(60)).toBe(1);
  });

  it("returns 0 for a nonsensical tempo rather than dividing by zero", () => {
    expect(beatInterval(0)).toBe(0);
    expect(beatInterval(-10)).toBe(0);
  });
});

describe("beatTime / beatIndexAt", () => {
  it("places beat 4 at two seconds on a 120bpm grid", () => {
    expect(beatTime(grid, 4)).toBe(2);
  });

  it("respects a grid that does not start at zero", () => {
    expect(beatTime(offsetGrid, 4)).toBeCloseTo(12.25);
  });

  it("round-trips a beat index through its time", () => {
    for (const index of [0, 1, 7, 40]) {
      expect(beatIndexAt(grid, beatTime(grid, index))).toBe(index);
    }
  });
});

describe("beatsInWindow", () => {
  it("returns exactly the beats inside a half-open window", () => {
    expect(beatsInWindow(grid, 0, 1).map((beat) => beat.time)).toEqual([0, 0.5]);
  });

  it("excludes the upper bound so consecutive windows cannot double-count", () => {
    const first = beatsInWindow(grid, 0, 1).map((beat) => beat.index);
    const second = beatsInWindow(grid, 1, 2).map((beat) => beat.index);
    expect(first).toEqual([0, 1]);
    expect(second).toEqual([2, 3]);
    expect(first.filter((index) => second.includes(index))).toEqual([]);
  });

  it("is empty for an empty or inverted window", () => {
    expect(beatsInWindow(grid, 1, 1)).toEqual([]);
    expect(beatsInWindow(grid, 2, 1)).toEqual([]);
  });

  it("covers a window spanning many beats without gaps", () => {
    const beats = beatsInWindow(grid, 0, 5);
    expect(beats).toHaveLength(10);
    expect(beats.map((beat) => beat.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("handles a grid whose origin is not zero", () => {
    expect(beatsInWindow(offsetGrid, 10.25, 11.25).map((beat) => beat.time)).toEqual([
      10.25, 10.75,
    ]);
  });
});

describe("snapToNearestBeat", () => {
  it("leaves a time already on the grid alone", () => {
    expect(snapToNearestBeat(grid, 1.5)).toBeCloseTo(1.5);
  });

  it("rounds to the nearest beat in both directions", () => {
    expect(snapToNearestBeat(grid, 1.6)).toBeCloseTo(1.5);
    expect(snapToNearestBeat(grid, 1.9)).toBeCloseTo(2);
  });

  it("can snap forwards, to a beat that has not happened yet", () => {
    expect(snapToNearestBeat(grid, 1.76)).toBeGreaterThan(1.76);
  });
});

describe("beatPhase", () => {
  it("is 0 on a beat and 0.5 halfway between two", () => {
    expect(beatPhase(grid, 0)).toBeCloseTo(0);
    expect(beatPhase(grid, 0.25)).toBeCloseTo(0.5);
    expect(beatPhase(grid, 1)).toBeCloseTo(0);
  });

  it("wraps to just under 1 immediately before the next beat", () => {
    expect(beatPhase(grid, 0.49)).toBeGreaterThan(0.9);
    expect(beatPhase(grid, 0.49)).toBeLessThan(1);
  });

  it("stays in [0, 1) before the grid origin, so an early frame cannot break it", () => {
    const phase = beatPhase(offsetGrid, 0);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(1);
  });
});
