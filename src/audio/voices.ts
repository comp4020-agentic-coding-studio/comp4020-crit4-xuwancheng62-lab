// Four voices, four different ways of making a sound, all from native nodes.
// They are distinct by construction rather than by tuning: a filtered
// triangle, an FM pair, filtered noise, and a detuned sawtooth that sustains.
//
// Every voice does two jobs. `press`/`moveTo`/`release` serve a finger on the
// screen right now. `playScheduled` plays a complete recorded gesture booked
// at a future time, which is how a loop repeat sounds identical to the live
// press that made it — same nodes, same code path, re-synthesised each cycle.

import type { ParamBreakpoint } from "../loop-model";
import { semitonesToFrequency } from "../mapping";
import { type PadSpec, type VoiceKind } from "../pads";

export interface VoiceParams {
  semitones: number;
  brightness: number;
}

export interface Gesture {
  breakpoints: readonly ParamBreakpoint[];
  heldSeconds: number | null;
}

export interface PadVoice {
  press(time: number, params: VoiceParams): void;
  /** A drag while held. */
  moveTo(time: number, params: VoiceParams): void;
  release(time: number): void;
  playScheduled(time: number, gesture: Gesture): void;
}

export interface VoiceEnvironment {
  ctx: AudioContext;
  out: AudioNode;
  noiseBuffer: AudioBuffer;
}

const SILENCE = 0.0001;
const DEFAULT_SUSTAIN = 0.35;

function firstParams(gesture: Gesture): VoiceParams {
  const first = gesture.breakpoints[0];
  return first
    ? { semitones: first.semitones, brightness: first.brightness }
    : { semitones: 0, brightness: 0.5 };
}

/** Rides an AudioParam through a recorded gesture's breakpoints. */
function rampThrough(
  param: AudioParam,
  startTime: number,
  gesture: Gesture,
  valueFor: (params: VoiceParams) => number,
): void {
  for (const breakpoint of gesture.breakpoints.slice(1)) {
    param.linearRampToValueAtTime(valueFor(breakpoint), startTime + breakpoint.offsetSeconds);
  }
}

// ----------------------------------------------------------------- drum (A)

function beaterCutoff(brightness: number): number {
  return 1300 + brightness * 2700;
}

function createDrumVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out, noiseBuffer } = env;
  let live: { beater: BiquadFilterNode } | null = null;

  function spawn(time: number, params: VoiceParams, gesture: Gesture | null) {
    const freq = semitonesToFrequency(root, params.semitones);

    // The body: a sine swept steeply down from several times its target. That
    // sweep is the whole trick — it is what the ear hears as a skin being
    // struck rather than a tone being switched on.
    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(freq * 4.5, time);
    body.frequency.exponentialRampToValueAtTime(freq, time + 0.06);

    const decay = 0.3 + params.brightness * 0.32;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0, time);
    bodyGain.gain.linearRampToValueAtTime(0.85, time + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(SILENCE, time + decay);

    body.connect(bodyGain);
    bodyGain.connect(out);
    body.start(time);
    body.stop(time + decay + 0.05);

    // The beater: a very short band of noise on top. Without it the drum is a
    // soft boom with no attack, and it stops cutting through a busy loop.
    const beat = ctx.createBufferSource();
    beat.buffer = noiseBuffer;
    const beater = ctx.createBiquadFilter();
    beater.type = "bandpass";
    beater.Q.value = 1.1;
    beater.frequency.setValueAtTime(beaterCutoff(params.brightness), time);
    if (gesture) rampThrough(beater.frequency, time, gesture, (p) => beaterCutoff(p.brightness));

    const beaterGain = ctx.createGain();
    beaterGain.gain.setValueAtTime(0, time);
    beaterGain.gain.linearRampToValueAtTime(0.32, time + 0.002);
    beaterGain.gain.exponentialRampToValueAtTime(SILENCE, time + 0.05);

    beat.connect(beater);
    beater.connect(beaterGain);
    beaterGain.connect(out);
    beat.start(time);
    beat.stop(time + 0.07);

    return { beater };
  }

  return {
    press(time, params) {
      live = spawn(time, params, null);
    },
    // A drum's pitch is set the instant it is struck; there is nothing left to
    // bend. The beater's colour is all a drag can still reach.
    moveTo(time, params) {
      live?.beater.frequency.setTargetAtTime(beaterCutoff(params.brightness), time, 0.02);
    },
    release() {
      live = null;
    },
    playScheduled(time, gesture) {
      spawn(time, firstParams(gesture), gesture);
    },
  };
}

// ----------------------------------------------------------------- bell (S)

function createBellVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out } = env;
  let live: { depth: GainNode; freq: number } | null = null;

  function modDepth(freq: number, brightness: number): number {
    return freq * (1.1 + brightness * 2.6);
  }

  function spawn(time: number, params: VoiceParams, gesture: Gesture | null) {
    const freq = semitonesToFrequency(root, params.semitones);

    const carrier = ctx.createOscillator();
    carrier.type = "sine";
    carrier.frequency.setValueAtTime(freq, time);

    // A non-integer ratio makes the partials inharmonic, which is what reads
    // as "metallic" rather than "flute".
    const modulator = ctx.createOscillator();
    modulator.type = "sine";
    modulator.frequency.setValueAtTime(freq * 2.4, time);

    const depth = ctx.createGain();
    const peak = modDepth(freq, params.brightness);
    depth.gain.setValueAtTime(peak, time);
    if (gesture) rampThrough(depth.gain, time, gesture, (p) => modDepth(freq, p.brightness));
    depth.gain.exponentialRampToValueAtTime(Math.max(1, peak * 0.02), time + 0.8);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.32, time + 0.004);
    gain.gain.exponentialRampToValueAtTime(SILENCE, time + 1.4);

    modulator.connect(depth);
    depth.connect(carrier.frequency);
    carrier.connect(gain);
    gain.connect(out);
    modulator.start(time);
    carrier.start(time);
    modulator.stop(time + 1.5);
    carrier.stop(time + 1.5);
    return { depth, freq };
  }

  return {
    press(time, params) {
      live = spawn(time, params, null);
    },
    moveTo(time, params) {
      if (!live) return;
      live.depth.gain.setTargetAtTime(modDepth(live.freq, params.brightness), time, 0.05);
    },
    release() {
      live = null;
    },
    playScheduled(time, gesture) {
      spawn(time, firstParams(gesture), gesture);
    },
  };
}

// ---------------------------------------------------------------- clack (D)

function createNoiseVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out, noiseBuffer } = env;
  let live: { filter: BiquadFilterNode; freq: number } | null = null;

  function centre(freq: number, brightness: number): number {
    return freq * (1.8 + brightness * 3.4);
  }

  function spawn(time: number, params: VoiceParams, gesture: Gesture | null) {
    const freq = semitonesToFrequency(root, params.semitones);

    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    // Noise has no pitch of its own; a resonant bandpass gives it one, so the
    // clack still lands on the pentatonic ladder with the other three.
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2.4;
    const peak = centre(freq, params.brightness);
    filter.frequency.setValueAtTime(peak, time);
    if (gesture) rampThrough(filter.frequency, time, gesture, (p) => centre(freq, p.brightness));
    filter.frequency.exponentialRampToValueAtTime(Math.max(120, peak * 0.45), time + 0.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.72, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(SILENCE, time + 0.3);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(time);
    source.stop(time + 0.32);
    return { filter, freq };
  }

  return {
    press(time, params) {
      live = spawn(time, params, null);
    },
    moveTo(time, params) {
      if (!live) return;
      live.filter.frequency.setTargetAtTime(centre(live.freq, params.brightness), time, 0.03);
    },
    release() {
      live = null;
    },
    playScheduled(time, gesture) {
      spawn(time, firstParams(gesture), gesture);
    },
  };
}

// ---------------------------------------------------------------- glide (F)

const GLIDE_SECONDS = 0.07;

function createGlideVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out } = env;
  let live: {
    oscs: OscillatorNode[];
    filter: BiquadFilterNode;
    gain: GainNode;
  } | null = null;

  function cutoff(brightness: number): number {
    return 420 + brightness * 3800;
  }

  function build(time: number, params: VoiceParams) {
    const freq = semitonesToFrequency(root, params.semitones);
    // Two saws a few cents apart beat against each other, which is what stops
    // a held note sounding like a test tone.
    const oscs = [0, 9].map((detune) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(freq, time);
      return osc;
    });

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 3.5;
    filter.frequency.setValueAtTime(cutoff(params.brightness), time);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.26, time + 0.05);

    for (const osc of oscs) {
      osc.connect(filter);
      osc.start(time);
    }
    filter.connect(gain);
    gain.connect(out);
    return { oscs, filter, gain };
  }

  function fadeOut(
    node: { oscs: OscillatorNode[]; gain: GainNode },
    time: number,
  ): void {
    node.gain.gain.cancelScheduledValues(time);
    node.gain.gain.setTargetAtTime(0, time, 0.07);
    for (const osc of node.oscs) osc.stop(time + 0.5);
  }

  return {
    press(time, params) {
      // Monophonic while played by hand: a second press retunes the note it is
      // already holding rather than stacking another sawtooth on top of it.
      if (live) {
        this.moveTo(time, params);
        return;
      }
      live = build(time, params);
    },
    moveTo(time, params) {
      if (!live) return;
      const freq = semitonesToFrequency(root, params.semitones);
      for (const osc of live.oscs) osc.frequency.setTargetAtTime(freq, time, GLIDE_SECONDS);
      live.filter.frequency.setTargetAtTime(cutoff(params.brightness), time, 0.04);
    },
    release(time) {
      if (!live) return;
      fadeOut(live, time);
      live = null;
    },
    // A replayed glide gets its own nodes and its own scheduled release, so it
    // never fights the live monophonic voice for the same slot.
    playScheduled(time, gesture) {
      const params = firstParams(gesture);
      const node = build(time, params);
      for (const breakpoint of gesture.breakpoints.slice(1)) {
        const at = time + breakpoint.offsetSeconds;
        const freq = semitonesToFrequency(root, breakpoint.semitones);
        for (const osc of node.oscs) osc.frequency.linearRampToValueAtTime(freq, at);
        node.filter.frequency.linearRampToValueAtTime(cutoff(breakpoint.brightness), at);
      }
      fadeOut(node, time + (gesture.heldSeconds ?? DEFAULT_SUSTAIN));
    },
  };
}

const BUILDERS: Record<VoiceKind, (env: VoiceEnvironment, root: number) => PadVoice> = {
  drum: createDrumVoice,
  bell: createBellVoice,
  noise: createNoiseVoice,
  glide: createGlideVoice,
};

export function createVoice(spec: PadSpec, env: VoiceEnvironment): PadVoice {
  return BUILDERS[spec.voice](env, spec.rootMidi);
}

/** The background pulse: a short, soft, unaccented thump. */
export function playBeatTick(ctx: AudioContext, out: AudioNode, time: number): void {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(58, time + 0.09);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.5, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(SILENCE, time + 0.16);

  osc.connect(gain);
  gain.connect(out);
  osc.start(time);
  osc.stop(time + 0.2);
}
