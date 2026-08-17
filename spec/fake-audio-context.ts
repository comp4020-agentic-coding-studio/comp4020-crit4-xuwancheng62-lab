// jsdom implements no Web Audio API, so a test that presses a pad needs
// something for the audio layer to build against.
//
// It is not a passive stub, though. I cannot hear this instrument from here, so
// the two Web Audio mistakes that are invisible without ears are wired up as
// assertions instead: an exponential ramp *to* zero, which throws in a real
// browser, and an exponential ramp *from* zero, which throws nothing and simply
// produces silence. A NaN reaching an AudioParam behaves the same way — the node
// goes quiet and says nothing about why. Whether the graph sounds *good* is
// still a question for the ear; whether it sounds at all is checkable here.

function assertTime(method: string, time: number): void {
  if (!Number.isFinite(time) || time < 0) {
    throw new RangeError(`${method}: time must be finite and >= 0, got ${time}`);
  }
}

function assertValue(method: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${method}: value must be finite, got ${value}`);
  }
}

class FakeParam {
  value = 0;
  /** The value the timeline would hold at the last scheduled event. */
  #scheduled = 0;

  setValueAtTime(value: number, time: number): this {
    assertValue("setValueAtTime", value);
    assertTime("setValueAtTime", time);
    this.#scheduled = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    assertValue("linearRampToValueAtTime", value);
    assertTime("linearRampToValueAtTime", time);
    this.#scheduled = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    assertValue("exponentialRampToValueAtTime", value);
    assertTime("exponentialRampToValueAtTime", time);
    if (value === 0) {
      throw new RangeError(
        "exponentialRampToValueAtTime(0) throws in a browser — ramp to a small non-zero value",
      );
    }
    if (this.#scheduled === 0) {
      throw new RangeError(
        "exponentialRampToValueAtTime from a value of 0 is silent — set a non-zero value first",
      );
    }
    this.#scheduled = value;
    return this;
  }

  setTargetAtTime(target: number, time: number, timeConstant: number): this {
    assertValue("setTargetAtTime", target);
    assertTime("setTargetAtTime", time);
    if (!(timeConstant > 0)) {
      throw new RangeError(`setTargetAtTime: timeConstant must be > 0, got ${timeConstant}`);
    }
    this.#scheduled = target;
    return this;
  }

  cancelScheduledValues(time: number): this {
    assertTime("cancelScheduledValues", time);
    return this;
  }
}

class FakeNode {
  readonly frequency = new FakeParam();
  readonly detune = new FakeParam();
  readonly gain = new FakeParam();
  readonly Q = new FakeParam();
  readonly threshold = new FakeParam();
  readonly knee = new FakeParam();
  readonly ratio = new FakeParam();
  readonly attack = new FakeParam();
  readonly release = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;

  #startedAt: number | null = null;

  connect<T>(target: T): T {
    if (target === undefined || target === null) {
      throw new TypeError("connect() needs a destination node or param");
    }
    return target;
  }

  disconnect(): void {}

  start(when = 0): void {
    assertTime("start", when);
    if (this.#startedAt !== null) {
      // A real OscillatorNode throws on a second start(); reusing one instead of
      // building a fresh node per press is the easy way to write a pad that
      // plays exactly once and then goes quiet forever.
      throw new Error("start() called twice on the same source node");
    }
    this.#startedAt = when;
  }

  stop(when = 0): void {
    assertTime("stop", when);
    if (this.#startedAt !== null && when < this.#startedAt) {
      throw new RangeError(`stop(${when}) is before start(${this.#startedAt})`);
    }
  }
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  destination = new FakeNode();

  resume(): Promise<void> {
    return Promise.resolve();
  }

  createOscillator(): FakeNode {
    return new FakeNode();
  }

  createGain(): FakeNode {
    return new FakeNode();
  }

  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }

  createBufferSource(): FakeNode {
    return new FakeNode();
  }

  createDynamicsCompressor(): FakeNode {
    return new FakeNode();
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels,
      length,
      sampleRate,
      copyToChannel(): void {},
    };
  }
}

/** Install as globalThis.AudioContext for a test file. */
export function fakeAudioContextClass(): typeof AudioContext {
  return FakeAudioContext as unknown as typeof AudioContext;
}
