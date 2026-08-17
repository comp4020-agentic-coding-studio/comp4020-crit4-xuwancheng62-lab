// The page breathes on the beat. Driven from beat phase rather than from
// scheduled events, so it needs no queue and cannot fall out of step: every
// frame simply asks the shared grid where in the beat it currently is.

export const BREATH_PROPERTY = "--breath";

/**
 * A raised cosine peaking exactly on the beat and easing to nothing between
 * beats. Returns 0 when the beat is off, so switching it off visibly settles
 * the page rather than freezing it mid-swell.
 */
export function breathLevel(phase: number, on: boolean): number {
  if (!on) return 0;
  const wrapped = ((phase % 1) + 1) % 1;
  return (Math.cos(wrapped * Math.PI * 2) + 1) / 2;
}

export function paintBreath(target: HTMLElement, phase: number, on: boolean): void {
  target.style.setProperty(BREATH_PROPERTY, breathLevel(phase, on).toFixed(3));
}
