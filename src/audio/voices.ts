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

// ---------------------------------------------------------------- pluck (A)

function pluckCutoff(freq: number, brightness: number): number {
  return Math.max(freq * 1.5, 700 + brightness * 5200);
}

function createPluckVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out } = env;
  let live: { filter: BiquadFilterNode } | null = null;

  function spawn(time: number, params: VoiceParams, gesture: Gesture | null) {
    const freq = semitonesToFrequency(root, params.semitones);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, time);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 5;
    const peak = pluckCutoff(freq, params.brightness);
    filter.frequency.setValueAtTime(peak, time);
    if (gesture) {
      rampThrough(filter.frequency, time, gesture, (p) => pluckCutoff(freq, p.brightness));
    }
    filter.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.4), time + 0.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.5, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(SILENCE, time + 0.45);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(time);
    osc.stop(time + 0.5);
    return { filter };
  }

  return {
    press(time, params) {
      live = spawn(time, params, null);
    },
    // Pitch is fixed at the press: bending a plucked string mid-decay sounds
    // like a mistake, where opening the filter sounds like playing it.
    moveTo(time, params) {
      const freq = semitonesToFrequency(root, params.semitones);
      live?.filter.frequency.setTargetAtTime(pluckCutoff(freq, params.brightness), time, 0.04);
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
    gain.gain.linearRampToValueAtTime(0.4, time + 0.003);
    gain.gain.exponentialRampToValueAtTime(SILENCE, time + 0.28);

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
  pluck: createPluckVoice,
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
