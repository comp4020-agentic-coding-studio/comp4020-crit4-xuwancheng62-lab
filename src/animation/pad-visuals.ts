// Each pad looks like it sounds. The transient hit is a one-shot Web Animation
// (a ripple for the pluck, a slow bloom for the bell, a hard jitter for the
// clack); anything continuous is a CSS custom property the stylesheet reads, so
// a glide's pitch can be reflected without animating from script every frame.

import { clamp01 } from "../mapping";
import { PADS, type PadId, type VoiceKind } from "../pads";

export interface VisualParams {
  semitones: number;
  brightness: number;
}

const PITCH_RANGE = 12;

type Flash = (pad: HTMLElement, ink: HTMLElement | null) => void;

const FLASHES: Record<VoiceKind, Flash> = {
  // A single sharp ripple, and the pad gives a little.
  pluck: (pad, ink) => {
    pad.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.94)" }, { transform: "scale(1)" }],
      { duration: 300, easing: "cubic-bezier(.2,.85,.25,1)" },
    );
    ink?.animate([{ transform: "scale(0.25)", opacity: 0.9 }, { transform: "scale(1.1)", opacity: 0 }], {
      duration: 430,
      easing: "cubic-bezier(.15,.7,.2,1)",
    });
  },
  // Slower, wider, and it lingers — a struck bell rings on.
  bell: (pad, ink) => {
    pad.animate(
      [{ filter: "brightness(1)" }, { filter: "brightness(1.55)" }, { filter: "brightness(1)" }],
      { duration: 900, easing: "ease-out" },
    );
    ink?.animate([{ transform: "scale(0.4)", opacity: 0.55 }, { transform: "scale(1.7)", opacity: 0 }], {
      duration: 1150,
      easing: "ease-out",
    });
  },
  // No expansion at all: a flat flash and a mechanical judder.
  noise: (pad, ink) => {
    pad.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-5px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(-2px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 190, easing: "steps(5, end)" },
    );
    ink?.animate([{ opacity: 0.95 }, { opacity: 0 }], { duration: 200, easing: "linear" });
  },
  // The glide's visual lives in its held state, not in a hit.
  glide: (pad, ink) => {
    ink?.animate([{ opacity: 0.5 }, { opacity: 0.2 }], { duration: 280, easing: "ease-out" });
  },
};

function ink(pad: HTMLElement): HTMLElement | null {
  return pad.querySelector<HTMLElement>("[data-ink]");
}

export function flashPad(pad: HTMLElement, padId: PadId): void {
  // jsdom has no Element.animate, and a missing animation is never worth an
  // exception that stops the sound.
  if (typeof pad.animate !== "function") return;
  FLASHES[PADS[padId].voice](pad, ink(pad));
}

/** Continuous state, for as long as a pad is held. */
export function paintHold(pad: HTMLElement, params: VisualParams): void {
  const pitch = clamp01((params.semitones + PITCH_RANGE) / (PITCH_RANGE * 2));
  pad.style.setProperty("--pitch", pitch.toFixed(3));
  pad.style.setProperty("--brightness", clamp01(params.brightness).toFixed(3));
}

export function clearHold(pad: HTMLElement): void {
  pad.style.removeProperty("--pitch");
  pad.style.removeProperty("--brightness");
}
