// Record a phrase, loop it, overdub on top, clear it — as a state machine that
// never touches an AudioContext. It asks an injected clock what time it is and
// hands finished gestures to an injected trigger, so the whole record/overdub
// lifecycle can be driven by a fake clock in a test.

import { type BeatGrid, snapToNearestBeat } from "./beat-clock";
import {
  EMPTY_RECORDING,
  type LoopRecording,
  type PadEvent,
  isEmpty,
  loopEventsInWindow,
  overdub,
  snapLoopLength,
  wrapOffset,
} from "./loop-model";
import type { PadId } from "./pads";
import { nextSchedulingWindow } from "./scheduler";

export type LoopState = "empty" | "recording" | "playing" | "overdubbing";

export interface GestureParams {
  semitones: number;
  brightness: number;
}

export interface LooperDeps {
  /** AudioContext.currentTime in production. */
  now: () => number;
  grid: () => BeatGrid;
  /** Book a replay of a recorded gesture at an absolute audio time. */
  trigger: (event: PadEvent, absoluteTime: number) => void;
  onStateChange?: (state: LoopState) => void;
}

/** What the one cycling loop button does next, given where it is. */
export function advanceLabel(state: LoopState): string {
  switch (state) {
    case "empty":
      return "Record";
    case "recording":
      return "Stop";
    case "playing":
      return "Overdub";
    case "overdubbing":
      return "Done";
  }
}

interface OpenGesture {
  event: PadEvent;
  pressTime: number;
}

export class Looper {
  readonly #deps: LooperDeps;
  #state: LoopState = "empty";
  #recording: LoopRecording = EMPTY_RECORDING;
  #loopStartTime = 0;
  #scheduledUpTo = 0;
  /** Time that offsets are measured from while capturing. */
  #captureOrigin = 0;
  #captured: PadEvent[] = [];
  #open = new Map<PadId, OpenGesture>();

  constructor(deps: LooperDeps) {
    this.#deps = deps;
  }

  get state(): LoopState {
    return this.#state;
  }

  get hasLoop(): boolean {
    return !isEmpty(this.#recording);
  }

  get loopLengthSeconds(): number {
    return this.#recording.loopLengthSeconds;
  }

  get isCapturing(): boolean {
    return this.#state === "recording" || this.#state === "overdubbing";
  }

  /** The single cycling control: Record -> Stop -> Overdub -> Done -> ... */
  advance(): void {
    switch (this.#state) {
      case "empty":
        this.#beginRecording();
        break;
      case "recording":
        this.#closeRecording();
        break;
      case "playing":
        this.#beginOverdub();
        break;
      case "overdubbing":
        this.#closeOverdub();
        break;
    }
  }

  clear(): void {
    this.#recording = EMPTY_RECORDING;
    this.#captured = [];
    this.#open.clear();
    this.#setState("empty");
  }

  recordPress(padId: PadId, params: GestureParams): void {
    if (!this.isCapturing) return;
    const now = this.#deps.now();
    this.#open.set(padId, {
      pressTime: now,
      event: {
        padId,
        pressOffsetSeconds: this.#offsetFor(now),
        heldSeconds: null,
        breakpoints: [{ offsetSeconds: 0, ...params }],
      },
    });
  }

  recordDrag(padId: PadId, params: GestureParams): void {
    const open = this.#open.get(padId);
    if (!open) return;
    open.event.breakpoints.push({
      offsetSeconds: this.#deps.now() - open.pressTime,
      ...params,
    });
  }

  recordRelease(padId: PadId): void {
    const open = this.#open.get(padId);
    if (!open) return;
    this.#open.delete(padId);
    open.event.heldSeconds = this.#deps.now() - open.pressTime;
    this.#captured.push(open.event);
  }

  /** Call from the scheduling poll. */
  tick(): void {
    if (this.#state !== "playing" && this.#state !== "overdubbing") return;
    if (isEmpty(this.#recording)) return;
    const window = nextSchedulingWindow(this.#deps.now(), this.#scheduledUpTo);
    if (!window) return;
    this.#scheduledUpTo = window.to;
    const due = loopEventsInWindow(
      this.#recording,
      this.#loopStartTime,
      window.from,
      window.to,
    );
    for (const { event, absoluteTime } of due) this.#deps.trigger(event, absoluteTime);
  }

  #beginRecording(): void {
    // Snapping the origin to a beat is half of what keeps the finished loop
    // locked to the background beat; snapping the length is the other half.
    this.#captureOrigin = snapToNearestBeat(this.#deps.grid(), this.#deps.now());
    this.#captured = [];
    this.#open.clear();
    this.#setState("recording");
  }

  #closeRecording(): void {
    const now = this.#deps.now();
    this.#closeOpenGestures(now);
    if (this.#captured.length === 0) {
      // Nothing was played, so there is no loop to show. Falling back to empty
      // is honest; offering an Overdub button over silence is not.
      this.#setState("empty");
      return;
    }
    const length = snapLoopLength(now - this.#captureOrigin, this.#deps.grid());
    this.#recording = {
      loopLengthSeconds: length,
      events: this.#captured
        .map((event) => ({
          ...event,
          pressOffsetSeconds: wrapOffset(event.pressOffsetSeconds, length),
        }))
        .sort((left, right) => left.pressOffsetSeconds - right.pressOffsetSeconds),
    };
    this.#captured = [];
    this.#loopStartTime = this.#captureOrigin;
    this.#scheduledUpTo = now;
    this.#setState("playing");
  }

  #beginOverdub(): void {
    this.#captureOrigin = this.#loopStartTime;
    this.#captured = [];
    this.#open.clear();
    this.#setState("overdubbing");
  }

  #closeOverdub(): void {
    this.#closeOpenGestures(this.#deps.now());
    this.#recording = overdub(this.#recording, this.#captured);
    this.#captured = [];
    this.#setState("playing");
  }

  #closeOpenGestures(now: number): void {
    for (const [padId, open] of this.#open) {
      open.event.heldSeconds = now - open.pressTime;
      this.#captured.push(open.event);
      this.#open.delete(padId);
    }
  }

  /**
   * While recording the loop length is not known yet, so offsets are raw and
   * get wrapped when it closes. While overdubbing the length is fixed, so a
   * press lands in the cycle it was played against.
   */
  #offsetFor(now: number): number {
    if (this.#state === "overdubbing") {
      return wrapOffset(now - this.#loopStartTime, this.#recording.loopLengthSeconds);
    }
    return now - this.#captureOrigin;
  }

  #setState(state: LoopState): void {
    this.#state = state;
    this.#deps.onStateChange?.(state);
  }
}
