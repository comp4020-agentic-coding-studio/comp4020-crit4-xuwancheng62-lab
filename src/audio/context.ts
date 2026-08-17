// The AudioContext is created lazily, inside the first real gesture, because
// browsers refuse to start audio otherwise. Nothing here runs at import time —
// that also keeps these modules importable under jsdom, which has no Web Audio
// API at all.

import { type BeatGrid, DEFAULT_BPM } from "../beat-clock";
import { createNoiseBuffer } from "./noise";

export interface AudioRig {
  ctx: AudioContext;
  /** Pads, and every loop replay, share this bus. */
  padBus: GainNode;
  /** Deliberately quieter than the pads. */
  beatBus: GainNode;
  grid: BeatGrid;
  noiseBuffer: AudioBuffer;
}

const BEAT_LEVEL = 0.16;
const PAD_LEVEL = 0.85;

let rig: AudioRig | null = null;

function createRig(): AudioRig {
  const ctx = new AudioContext();

  // Overdubbing stacks layers, and four pads can be held at once, so the sum
  // can easily clip. A soft limiter on the way out costs one node and keeps a
  // busy loop sounding thick instead of crunchy.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(ctx.destination);

  const padBus = ctx.createGain();
  padBus.gain.value = PAD_LEVEL;
  padBus.connect(limiter);

  const beatBus = ctx.createGain();
  beatBus.gain.value = BEAT_LEVEL;
  beatBus.connect(limiter);

  return {
    ctx,
    padBus,
    beatBus,
    grid: { originTime: ctx.currentTime, bpm: DEFAULT_BPM },
    noiseBuffer: createNoiseBuffer(ctx, 1),
  };
}

/**
 * Must be called synchronously from inside a pointerdown/keydown handler —
 * awaiting anything first loses the user-gesture flag and Safari declines to
 * start. Idempotent, so two near-simultaneous first touches cannot race into
 * building two contexts.
 */
export function ensureAudio(): AudioRig {
  rig ??= createRig();
  if (rig.ctx.state === "suspended") void rig.ctx.resume();
  return rig;
}

export function currentRig(): AudioRig | null {
  return rig;
}
