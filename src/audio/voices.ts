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

// A clave, in three layers. The first version was a single bandpass, which is
// why it sat dull and quiet however far I pushed its gain: a Q of 2.4 throws
// away everything outside a narrow band, its centre sat down in the midrange,
// and it swept *downward*, so the hit got duller as it died. All three are
// backwards for a clack.
//
//  - body    highpass, not bandpass. Passing everything above the corner keeps
//            most of the noise energy instead of a sliver, which is where the
//            loudness and the brightness both come from. Sweeps upward as it
//            decays, so it thins rather than dulls.
//  - ring    a high-Q band up where a clave actually sings, so the hit still
//            has a pitch on the pentatonic ladder.
//  - tick    two hundredths of a second of raw noise at full level, no attack
//            ramp at all. This is what the ear uses to place the hit in time,
//            and it is the whole of "immediate".

/** Where the body's band stops. A highpass alone passes everything up to
 * Nyquist, which is why lowering its corner made the clack fuller without
 * making it any less fizzy — the hiss lives above 6kHz and a highpass never
 * touches it. Bounding the top is what removes sizzle. */
function clackTop(brightness: number): number {
  return 3400 + brightness * 1700;
}

/** Always in the treble, and rising with pitch — never muddy at the bottom. */
function clackRing(freq: number, brightness: number): number {
  return Math.min(7000, 1250 + freq * 3.2 + brightness * 650);
}

function clackBody(brightness: number): number {
  return 1100 + brightness * 1500;
}

function createNoiseVoice(env: VoiceEnvironment, root: number): PadVoice {
  const { ctx, out, noiseBuffer } = env;
  let live: {
    body: BiquadFilterNode;
    top: BiquadFilterNode;
    ring: BiquadFilterNode;
    freq: number;
  } | null = null;

  function spawn(time: number, params: VoiceParams, gesture: Gesture | null) {
    const freq = semitonesToFrequency(root, params.semitones);

    // -- body ------------------------------------------------------------
    const bodySource = ctx.createBufferSource();
    bodySource.buffer = noiseBuffer;
    bodySource.loop = true;

    const body = ctx.createBiquadFilter();
    body.type = "highpass";
    body.Q.value = 0.8;
    const corner = clackBody(params.brightness);
    body.frequency.setValueAtTime(corner, time);
    if (gesture) rampThrough(body.frequency, time, gesture, (p) => clackBody(p.brightness));
    body.frequency.exponentialRampToValueAtTime(Math.min(6000, corner * 1.25), time + 0.1);

    // Highpass and lowpass in series: a wide band, so it keeps the energy a
    // narrow one would throw away, but with a ceiling so it reads as wood
    // rather than hiss.
    const top = ctx.createBiquadFilter();
    top.type = "lowpass";
    top.Q.value = 0.7;
    top.frequency.setValueAtTime(clackTop(params.brightness), time);
    if (gesture) rampThrough(top.frequency, time, gesture, (p) => clackTop(p.brightness));

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0, time);
    bodyGain.gain.linearRampToValueAtTime(0.8, time + 0.0012);
    // Ramping to a near-zero floor sounds like it should give an 85ms decay and
    // does not: an exponential to 0.0001 has already fallen below hearing in a
    // quarter of that, which is why the first attempt measured 26ms and read as
    // a thin tick with no level. Ramping to 2% of peak and finishing with a
    // short linear fade gives the hit a body the ear can actually register.
    bodyGain.gain.exponentialRampToValueAtTime(0.012, time + 0.14);
    bodyGain.gain.linearRampToValueAtTime(0, time + 0.18);

    bodySource.connect(body);
    body.connect(top);
    top.connect(bodyGain);
    bodyGain.connect(out);
    bodySource.start(time);
    bodySource.stop(time + 0.2);

    // -- ring ------------------------------------------------------------
    const ringSource = ctx.createBufferSource();
    ringSource.buffer = noiseBuffer;
    ringSource.loop = true;

    const ring = ctx.createBiquadFilter();
    ring.type = "bandpass";
    ring.Q.value = 5;
    ring.frequency.setValueAtTime(clackRing(freq, params.brightness), time);
    if (gesture) rampThrough(ring.frequency, time, gesture, (p) => clackRing(freq, p.brightness));

    const ringGain = ctx.createGain();
    ringGain.gain.setValueAtTime(0, time);
    ringGain.gain.linearRampToValueAtTime(0.78, time + 0.001);
    // Outlasts the body a little: the pitched part is what stops a bright hit
    // sounding like a burst of static.
    ringGain.gain.exponentialRampToValueAtTime(0.012, time + 0.24);
    ringGain.gain.linearRampToValueAtTime(0, time + 0.29);

    ringSource.connect(ring);
    ring.connect(ringGain);
    ringGain.connect(out);
    ringSource.start(time);
    ringSource.stop(time + 0.31);

    // -- tick ------------------------------------------------------------
    const tickSource = ctx.createBufferSource();
    tickSource.buffer = noiseBuffer;

    const tickTone = ctx.createBiquadFilter();
    tickTone.type = "lowpass";
    tickTone.Q.value = 0.7;
    tickTone.frequency.setValueAtTime(5000, time);

    const tickGain = ctx.createGain();
    // Straight in at full level: an attack ramp, even a millisecond of one,
    // is what made the old version feel soft.
    tickGain.gain.setValueAtTime(0.42, time);
    tickGain.gain.exponentialRampToValueAtTime(0.01, time + 0.016);
    tickGain.gain.linearRampToValueAtTime(0, time + 0.022);

    tickSource.connect(tickTone);
    tickTone.connect(tickGain);
    tickGain.connect(out);
    tickSource.start(time);
    tickSource.stop(time + 0.03);

    return { body, top, ring, freq };
  }

  return {
    press(time, params) {
      live = spawn(time, params, null);
    },
    moveTo(time, params) {
      if (!live) return;
      live.body.frequency.setTargetAtTime(clackBody(params.brightness), time, 0.02);
      live.top.frequency.setTargetAtTime(clackTop(params.brightness), time, 0.02);
      live.ring.frequency.setTargetAtTime(clackRing(live.freq, params.brightness), time, 0.02);
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
