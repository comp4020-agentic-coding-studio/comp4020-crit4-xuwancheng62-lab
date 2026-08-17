// The page breathes on the beat. Driven from beat phase rather than from
// scheduled events, so it needs no queue and cannot fall out of step: every
// frame simply asks the shared grid where in the beat it currently is.

export const BREATH_PROPERTY = "--breath";

/**
 * A raised cosine peaking exactly on the beat, then sharpened by a power so the
 * peak is narrow and the trough long. A plain sinusoid spends most of its time
 * mid-swell, which reads as drifting rather than as a pulse — the exponent is
 * what makes the rhythm legible. Returns 0 when the beat is off, so switching it
 * off visibly settles the page rather than freezing it mid-breath.
 */
export const BREATH_SHARPNESS = 3.2;

export function breathLevel(phase: number, on: boolean): number {
  if (!on) return 0;
  const wrapped = ((phase % 1) + 1) % 1;
  const raised = (Math.cos(wrapped * Math.PI * 2) + 1) / 2;
  return raised ** BREATH_SHARPNESS;
}

export function paintBreath(target: HTMLElement, phase: number, on: boolean): void {
  target.style.setProperty(BREATH_PROPERTY, breathLevel(phase, on).toFixed(3));
}
