// jsdom implements no Web Audio API, so a test that presses a pad needs
// something for the audio layer to build against. This is deliberately inert:
// it records nothing and asserts nothing, it just exists so the node graph can
// be constructed. Whether the graph *sounds* right is a question for the ear,
// not for jsdom.

class FakeParam {
  value = 0;

  setValueAtTime(): this {
    return this;
  }

  linearRampToValueAtTime(): this {
    return this;
  }

  exponentialRampToValueAtTime(): this {
    return this;
  }

  setTargetAtTime(): this {
    return this;
  }

  cancelScheduledValues(): this {
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

  connect<T>(target: T): T {
    return target;
  }

  disconnect(): void {}

  start(): void {}

  stop(): void {}
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
