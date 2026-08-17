// White noise for the clack pad. The sample generator is pure so it can be
// checked without an AudioContext; only the buffer wrapper needs one.

export function generateNoiseSamples(length: number): Float32Array<ArrayBuffer> {
  const samples = new Float32Array(Math.max(0, Math.floor(length)));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = Math.random() * 2 - 1;
  }
  return samples;
}

export function createNoiseBuffer(ctx: BaseAudioContext, durationSeconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * durationSeconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  buffer.copyToChannel(generateNoiseSamples(length), 0);
  return buffer;
}
