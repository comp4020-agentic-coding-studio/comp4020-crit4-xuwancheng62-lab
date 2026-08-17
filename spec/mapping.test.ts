import { describe, expect, it } from "vitest";
import {
  clientYToFraction,
  fractionToBrightness,
  fractionToContinuousSemitones,
  fractionToPentatonicSemitones,
  midiToFrequency,
  pentatonicLadder,
} from "../src/mapping";

// The spec asks that "the player's choices shape what they hear" and that
// "there is no way to play it wrong". Both land in this mapping: the gesture
// has to change the pitch, and the pitch it changes to has to be in tune.

describe("clientYToFraction", () => {
  it("reads the top of the pad as 1 and the bottom as 0", () => {
    expect(clientYToFraction(100, 100, 200)).toBe(1);
    expect(clientYToFraction(300, 100, 200)).toBe(0);
  });

  it("reads the vertical middle as 0.5", () => {
    expect(clientYToFraction(200, 100, 200)).toBe(0.5);
  });

  it("clamps a pointer dragged outside the pad", () => {
    expect(clientYToFraction(-500, 100, 200)).toBe(1);
    expect(clientYToFraction(9999, 100, 200)).toBe(0);
  });

  it("survives a zero-height rect rather than dividing by zero", () => {
    expect(clientYToFraction(100, 100, 0)).toBe(0.5);
  });
});

describe("pentatonic pitch snapping", () => {
  it("puts the pad's root note at its vertical middle", () => {
    expect(fractionToPentatonicSemitones(0.5)).toBe(0);
  });

  it("reaches the edges of the range", () => {
    expect(fractionToPentatonicSemitones(0)).toBe(-12);
    expect(fractionToPentatonicSemitones(1)).toBe(12);
  });

  it("never lands between two pentatonic degrees", () => {
    const ladder = new Set(pentatonicLadder());
    for (let step = 0; step <= 100; step += 1) {
      expect(ladder.has(fractionToPentatonicSemitones(step / 100))).toBe(true);
    }
  });

  it("offers no two degrees a semitone apart, so no two pads can clash", () => {
    const ladder = pentatonicLadder();
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index] - ladder[index - 1]).toBeGreaterThan(1);
    }
  });

  it("rises monotonically with the drag", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 100; step += 1) {
      const semitones = fractionToPentatonicSemitones(step / 100);
      expect(semitones).toBeGreaterThanOrEqual(previous);
      previous = semitones;
    }
  });
});

describe("continuous pitch, for the glide pad", () => {
  it("is neutral in the middle and hits both extremes", () => {
    expect(fractionToContinuousSemitones(0.5)).toBeCloseTo(0);
    expect(fractionToContinuousSemitones(0)).toBeCloseTo(-12);
    expect(fractionToContinuousSemitones(1)).toBeCloseTo(12);
  });

  it("passes between the pentatonic degrees, unlike the snapped mapping", () => {
    const ladder = new Set(pentatonicLadder());
    const offGrid = Array.from({ length: 101 }, (_, step) =>
      fractionToContinuousSemitones(step / 100),
    ).filter((semitones) => !ladder.has(semitones));
    expect(offGrid.length).toBeGreaterThan(0);
  });
});

describe("brightness", () => {
  it("tracks the drag from 0 to 1 and clamps beyond it", () => {
    expect(fractionToBrightness(0)).toBe(0);
    expect(fractionToBrightness(1)).toBe(1);
    expect(fractionToBrightness(2)).toBe(1);
    expect(fractionToBrightness(-2)).toBe(0);
  });
});

describe("midiToFrequency", () => {
  it("puts concert A and middle C where they belong", () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it("doubles an octave up", () => {
    expect(midiToFrequency(72)).toBeCloseTo(midiToFrequency(60) * 2);
  });
});
