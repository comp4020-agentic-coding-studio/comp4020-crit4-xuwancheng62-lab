// The background pulse. Deliberately unaccented — every beat is the same
// weight — because a loop is snapped to whole beats, not whole bars, so there
// is no bar structure for an odd-length loop to fight with.

import { type BeatGrid, beatsInWindow } from "./beat-clock";
import { nextSchedulingWindow } from "./scheduler";

export interface BeatPlayerDeps {
  now: () => number;
  grid: () => BeatGrid;
  onBeat: (absoluteTime: number, beatIndex: number) => void;
}

export class BeatPlayer {
  readonly #deps: BeatPlayerDeps;
  #on = false;
  #scheduledUpTo = 0;

  constructor(deps: BeatPlayerDeps) {
    this.#deps = deps;
  }

  get isOn(): boolean {
    return this.#on;
  }

  start(): void {
    if (this.#on) return;
    this.#on = true;
    this.#scheduledUpTo = this.#deps.now();
  }

  stop(): void {
    this.#on = false;
  }

  toggle(): boolean {
    if (this.#on) this.stop();
    else this.start();
    return this.#on;
  }

  /** Call from the scheduling poll. */
  tick(): void {
    if (!this.#on) return;
    const window = nextSchedulingWindow(this.#deps.now(), this.#scheduledUpTo);
    if (!window) return;
    this.#scheduledUpTo = window.to;
    // Beats come off the shared grid rather than from a counter of our own, so
    // switching the beat off and on again resumes in phase instead of starting
    // a fresh "beat 1" that no longer lines up with a running loop.
    for (const beat of beatsInWindow(this.#deps.grid(), window.from, window.to)) {
      this.#deps.onBeat(beat.time, beat.index);
    }
  }
}
