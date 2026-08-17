// Where you touch a pad decides what you hear. Pure on purpose: the rule that
// turns a gesture into a pitch is the part worth testing, and it needs neither
// a DOM rect nor an AudioContext to be checked.

export interface DragRange {
  semitonesBelow: number;
  semitonesAbove: number;
}

export const DEFAULT_RANGE: DragRange = { semitonesBelow: 12, semitonesAbove: 12 };

/** Major pentatonic, in semitones from the root. */
export const PENTATONIC_STEPS: readonly number[] = [0, 2, 4, 7, 9];

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/** 1 at the top of the pad, 0 at the bottom, clamped outside it. */
export function clientYToFraction(clientY: number, rectTop: number, rectHeight: number): number {
  if (rectHeight <= 0) return 0.5;
  return clamp01(1 - (clientY - rectTop) / rectHeight);
}

/** Every pentatonic degree inside the range, low to high. */
export function pentatonicLadder(range: DragRange = DEFAULT_RANGE): number[] {
  const rungs: number[] = [];
  const lowest = Math.floor(-range.semitonesBelow / 12) - 1;
  const highest = Math.ceil(range.semitonesAbove / 12) + 1;
  for (let octave = lowest; octave <= highest; octave += 1) {
    for (const step of PENTATONIC_STEPS) {
      const semitones = octave * 12 + step;
      if (semitones >= -range.semitonesBelow && semitones <= range.semitonesAbove) {
        rungs.push(semitones);
      }
    }
  }
  return rungs.sort((a, b) => a - b);
}

/**
 * Snapped pitch for the percussive pads. Snapping is what keeps a stranger
 * mashing pads from ever landing on something out of tune — the vertical
 * middle of a pad is always the root.
 */
export function fractionToPentatonicSemitones(
  fraction: number,
  range: DragRange = DEFAULT_RANGE,
): number {
  const ladder = pentatonicLadder(range);
  if (ladder.length === 0) return 0;
  return ladder[Math.round(clamp01(fraction) * (ladder.length - 1))];
}

/**
 * Unsnapped pitch, for the glide pad only. A sustained lead wants to slide
 * between notes the way a slide guitar does; quantising it would remove the
 * one gesture on the page that is continuous.
 */
export function fractionToContinuousSemitones(
  fraction: number,
  range: DragRange = DEFAULT_RANGE,
): number {
  const span = range.semitonesBelow + range.semitonesAbove;
  return -range.semitonesBelow + clamp01(fraction) * span;
}

export function fractionToBrightness(fraction: number): number {
  return clamp01(fraction);
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function semitonesToFrequency(rootMidi: number, semitones: number): number {
  return midiToFrequency(rootMidi + semitones);
}
