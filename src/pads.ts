// The four pads, and what each one is. Kept separate from the audio and DOM
// layers so both can agree on tuning and labels without importing either.

export type PadId = "a" | "s" | "d" | "f";

export const PAD_IDS: readonly PadId[] = ["a", "s", "d", "f"];

export type VoiceKind = "pluck" | "bell" | "noise" | "glide";

export interface PadSpec {
  id: PadId;
  /** The key that plays it, lowercase. */
  key: string;
  label: string;
  voice: VoiceKind;
  /** MIDI note at the pad's neutral (vertical middle) position. */
  rootMidi: number;
  /** True if the voice sounds for as long as it is held, rather than decaying. */
  sustained: boolean;
}

// C, D, E, G — four degrees of a C major pentatonic. Chosen so that any
// combination of pads is consonant: pentatonic has no semitone pairs, so
// there is no two-pad clash to stumble into. That is most of what makes this
// playable by someone who does not read music.
export const PADS: Record<PadId, PadSpec> = {
  a: { id: "a", key: "a", label: "Pluck", voice: "pluck", rootMidi: 60, sustained: false },
  s: { id: "s", key: "s", label: "Bell", voice: "bell", rootMidi: 62, sustained: false },
  d: { id: "d", key: "d", label: "Clack", voice: "noise", rootMidi: 64, sustained: false },
  f: { id: "f", key: "f", label: "Glide", voice: "glide", rootMidi: 67, sustained: true },
};

export function padForKey(key: string): PadId | null {
  const lower = key.toLowerCase();
  return PAD_IDS.find((id) => PADS[id].key === lower) ?? null;
}
