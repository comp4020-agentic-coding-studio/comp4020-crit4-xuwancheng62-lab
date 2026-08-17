// Scheduled sound is booked ahead of real time, so a naive animation fires
// early and the page looks a beat out of step with itself. Anything booked
// ahead pushes its animation in here stamped with the *same* AudioContext time
// as the note, and a per-frame tick releases it when that time actually
// arrives. Directly-pressed pads bypass this entirely — they are already in
// sync, because nothing was scheduled.

export interface VisualEvent {
  time: number;
  fire: () => void;
}

export class VisualEventQueue {
  #pending: VisualEvent[] = [];

  push(event: VisualEvent): void {
    this.#pending.push(event);
  }

  /** Fires everything due at or before `currentAudioTime`, earliest first. */
  tick(currentAudioTime: number): void {
    if (this.#pending.length === 0) return;
    const due = this.#pending
      .filter((event) => event.time <= currentAudioTime)
      .sort((left, right) => left.time - right.time);
    if (due.length === 0) return;
    this.#pending = this.#pending.filter((event) => event.time > currentAudioTime);
    for (const event of due) event.fire();
  }

  clear(): void {
    this.#pending = [];
  }

  get pendingCount(): number {
    return this.#pending.length;
  }
}
