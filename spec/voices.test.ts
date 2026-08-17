import { describe, expect, it } from "vitest";
import { createVoice, playBeatTick } from "../src/audio/voices";
import { paramsForFraction } from "../src/input/pad-controller";
import { PADS, PAD_IDS } from "../src/pads";
import { FakeAudioContext } from "./fake-audio-context";

// The crit's own framing is that an agent can build a synth but cannot hear the
// result. So rather than trusting that these envelopes are well formed, this
// sweeps every voice across the whole range of gestures a player can make and
// lets the validating fake object to anything malformed. It catches the class of
// Web Audio bug that makes no noise and throws no error — a ramp from zero, a
// NaN frequency, an oscillator reused instead of rebuilt — which is exactly the
// class I cannot catch by listening once and calling it done.

function environment() {
  const ctx = new FakeAudioContext();
  return {
    ctx: ctx as unknown as AudioContext,
    out: ctx.createGain() as unknown as AudioNode,
    noiseBuffer: ctx.createBuffer(1, 48000, 48000) as unknown as AudioBuffer,
  };
}

/** Eleven positions down the pad, which is every gesture a finger can make. */
const FRACTIONS = Array.from({ length: 11 }, (_, step) => step / 10);

describe("every voice, across every gesture", () => {
  for (const padId of PAD_IDS) {
    const spec = PADS[padId];

    describe(`${spec.label} (${padId})`, () => {
      it("survives a press, a drag and a release at any height on the pad", () => {
        const voice = createVoice(spec, environment());
        let time = 0;
        for (const fraction of FRACTIONS) {
          const params = paramsForFraction(padId, fraction);
          expect(() => voice.press(time, params)).not.toThrow();
          for (const drag of FRACTIONS) {
            time += 0.01;
            expect(() => voice.moveTo(time, paramsForFraction(padId, drag))).not.toThrow();
          }
          time += 0.05;
          expect(() => voice.release(time)).not.toThrow();
          time += 0.5;
        }
      });

      it("replays a recorded gesture of any shape", () => {
        const voice = createVoice(spec, environment());
        let time = 1;
        for (const fraction of FRACTIONS) {
          const breakpoints = FRACTIONS.map((drag, index) => ({
            offsetSeconds: index * 0.05,
            ...paramsForFraction(padId, drag),
          }));
          expect(() =>
            voice.playScheduled(time, { breakpoints, heldSeconds: 0.6 }),
          ).not.toThrow();
          expect(() =>
            voice.playScheduled(time, {
              breakpoints: [{ offsetSeconds: 0, ...paramsForFraction(padId, fraction) }],
              heldSeconds: null, // a note still held when the loop closed
            }),
          ).not.toThrow();
          time += 1;
        }
      });

      it("copes with a gesture that carries no breakpoints at all", () => {
        const voice = createVoice(spec, environment());
        expect(() => voice.playScheduled(0, { breakpoints: [], heldSeconds: 0.2 })).not.toThrow();
      });

      it("copes with a held note far longer than its own decay", () => {
        const voice = createVoice(spec, environment());
        expect(() =>
          voice.playScheduled(0, {
            breakpoints: [{ offsetSeconds: 0, semitones: 0, brightness: 0.5 }],
            heldSeconds: 30,
          }),
        ).not.toThrow();
      });

      it("releases cleanly even when it was never pressed", () => {
        const voice = createVoice(spec, environment());
        expect(() => voice.release(0)).not.toThrow();
        expect(() => voice.moveTo(0, paramsForFraction(padId, 0.5))).not.toThrow();
      });

      it("builds a fresh source per press rather than restarting one", () => {
        // A real OscillatorNode throws on a second start(), so ten presses
        // through one voice is the check that each press builds its own nodes.
        const voice = createVoice(spec, environment());
        for (let press = 0; press < 10; press += 1) {
          const time = press * 0.5;
          expect(() => voice.press(time, paramsForFraction(padId, 0.5))).not.toThrow();
          expect(() => voice.release(time + 0.2)).not.toThrow();
        }
      });
    });
  }
});

describe("the beat tick", () => {
  it("schedules a well-formed envelope at any time", () => {
    const { ctx, out } = environment();
    for (const time of [0, 0.5, 12.25, 900]) {
      expect(() => playBeatTick(ctx, out, time)).not.toThrow();
    }
  });
});

describe("the validating fake really does object", () => {
  // A sensor nobody has seen fail is a sensor nobody should trust.
  it("rejects an exponential ramp to zero", () => {
    const param = new FakeAudioContext().createGain().gain;
    param.setValueAtTime(0.5, 0);
    expect(() => param.exponentialRampToValueAtTime(0, 1)).toThrow(/exponentialRamp/);
  });

  it("rejects an exponential ramp away from zero", () => {
    const param = new FakeAudioContext().createGain().gain;
    param.setValueAtTime(0, 0);
    expect(() => param.exponentialRampToValueAtTime(0.5, 1)).toThrow(/silent/);
  });

  it("rejects a NaN reaching an AudioParam", () => {
    const param = new FakeAudioContext().createGain().gain;
    expect(() => param.setValueAtTime(Number.NaN, 0)).toThrow(/finite/);
  });

  it("rejects a source node started twice", () => {
    const osc = new FakeAudioContext().createOscillator();
    osc.start(0);
    expect(() => osc.start(1)).toThrow(/twice/);
  });
});
