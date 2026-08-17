import { describe, expect, it } from "vitest";
import { BREATH_SHARPNESS, breathLevel } from "../src/animation/breathing";

// The breath is the one visual that has to read as *rhythm* rather than as
// drifting light, and the difference is entirely in the shape of this curve: a
// plain sinusoid sits mid-swell most of the time, which looks like a slow fade.
// So the shape is worth asserting, not just the endpoints.

describe("breathLevel", () => {
  it("peaks exactly on the beat and empties between beats", () => {
    expect(breathLevel(0, true)).toBeCloseTo(1);
    expect(breathLevel(0.5, true)).toBeCloseTo(0);
    expect(breathLevel(1, true)).toBeCloseTo(1);
  });

  it("settles to nothing when the beat is off", () => {
    for (const phase of [0, 0.25, 0.5, 0.75]) {
      expect(breathLevel(phase, false)).toBe(0);
    }
  });

  it("stays within 0 and 1 for any phase, including out-of-range ones", () => {
    for (const phase of [-3.7, -0.2, 0, 0.33, 1, 2.5, 99.9]) {
      const level = breathLevel(phase, true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it("wraps, so phase 1.25 matches phase 0.25", () => {
    expect(breathLevel(1.25, true)).toBeCloseTo(breathLevel(0.25, true));
    expect(breathLevel(-0.25, true)).toBeCloseTo(breathLevel(0.75, true));
  });

  it("is a pulse, not a fade: a quarter beat in it has already mostly gone", () => {
    // A raw cosine would still be at 0.5 here. The sharpening exponent is what
    // makes the beat legible, so this is the assertion that would catch its
    // removal.
    expect(breathLevel(0.25, true)).toBeLessThan(0.25);
    expect(BREATH_SHARPNESS).toBeGreaterThan(1);
  });

  it("spends most of the beat dim rather than mid-swell", () => {
    const samples = Array.from({ length: 100 }, (_, step) => breathLevel(step / 100, true));
    const dim = samples.filter((level) => level < 0.2).length;
    expect(dim).toBeGreaterThan(55);
  });

  it("falls away monotonically from the beat to the halfway point", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let step = 0; step <= 50; step += 1) {
      const level = breathLevel(step / 100, true);
      expect(level).toBeLessThanOrEqual(previous + 1e-9);
      previous = level;
    }
  });
});
