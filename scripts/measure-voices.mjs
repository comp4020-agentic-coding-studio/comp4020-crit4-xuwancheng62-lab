// Measure what each pad actually sounds like, in numbers.
//
// The problem this exists to solve: I cannot hear this instrument, and "the
// clack is too quiet" turned out to be true for a reason no amount of raising
// its gain could fix — a narrow bandpass was discarding most of the noise
// energy, so a gain of 0.72 was reaching the ear as a peak of 0.17. Guessing
// cost two rounds. Measuring found it immediately.
//
// It renders the REAL voice modules through an OfflineAudioContext in headless
// Chrome — Vite serves the TS sources in dev, so this imports the same code the
// page runs rather than a reimplementation of it.
//
//   pnpm dev                 # in one terminal
//   pnpm measure             # in another
//
// Columns:
//   peak      loudest sample, measured at the voice's own output. The pad bus
//             attenuates by PAD_LEVEL before the limiter, so the number that
//             matters is peak * PAD_LEVEL < 1. Noise voices vary run to run,
//             so leave margin rather than tuning to the edge.
//   rms       average energy: the best single proxy for how loud it *feels*,
//             though treble reads louder than bass at equal rms.
//   hi>2kHz   fraction of energy above 2kHz. This is "brightness".
//   zcr       zero crossings per second. Also brightness; catches fizz.
//   attack    time to reach 90% of peak. This is "immediacy".
//   decay     time until it falls below 5% of peak. This is "length".
//
// Not a pass/fail check, so it is deliberately not wired into `pnpm check`:
// it needs a browser and a running dev server, and what counts as a good
// number here is a judgement for the ear. It is a measuring instrument.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const URL_BASE = process.env.URL ?? "http://localhost:5173/";
const PORT = 9333;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((path) => existsSync(path));
if (!chromePath) {
  console.error("No Chrome found. Set CHROME=/path/to/chrome and retry.");
  process.exit(1);
}

try {
  const probe = await fetch(URL_BASE, { signal: AbortSignal.timeout(2500) });
  if (!probe.ok) throw new Error(String(probe.status));
} catch {
  console.error(`No dev server at ${URL_BASE}. Run \`pnpm dev\` first`);
  console.error("(or point this at another port with URL=http://localhost:5180/).");
  process.exit(1);
}

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/measure-voices-${process.pid}`,
  "about:blank",
]);
chrome.on("error", (error) => {
  console.error("Could not start Chrome:", error.message);
  process.exit(1);
});

async function waitForCdp() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await r.json();
      const page = targets.find((t) => t.type === "page");
      if (page) return page;
    } catch {
      // Chrome is still coming up.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Chrome never exposed a debugging target");
}

const IN_PAGE = `(async () => {
  const voices = await import('/src/audio/voices.ts');
  const pads = await import('/src/pads.ts');
  const noise = await import('/src/audio/noise.ts');

  const RATE = 48000;
  const WINDOW = 2.0;          // long enough for the bell's tail
  const SPLIT = 2000;          // the treble/bass boundary for hi>2kHz

  async function render(padId, brightness) {
    const off = new OfflineAudioContext(1, Math.floor(RATE * WINDOW), RATE);
    const out = off.createGain();
    out.connect(off.destination);
    const voice = voices.createVoice(pads.PADS[padId], {
      ctx: off, out, noiseBuffer: noise.createNoiseBuffer(off, 1),
    });
    voice.press(0, { semitones: 0, brightness });
    voice.release(0.4);        // sustained voices need letting go of
    const data = (await off.startRendering()).getChannelData(0);

    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));

    // Where it stops being audible. Everything below is measured over the span
    // the sound is actually sounding — averaging over a fixed window instead
    // would just reward whichever voice rings longest, which is a different
    // question from how loud a hit is.
    let end = 0;
    for (let i = data.length - 1; i >= 0; i -= 1) {
      if (Math.abs(data[i]) > peak * 0.05) { end = i; break; }
    }
    const span = Math.max(end + 1, Math.floor(RATE * 0.02));

    let sumSq = 0, crossings = 0, previous = 0, lowpass = 0, hiSq = 0, loSq = 0;
    const alpha = 1 - Math.exp((-2 * Math.PI * SPLIT) / RATE);
    for (let i = 0; i < span; i += 1) {
      const sample = data[i];
      sumSq += sample * sample;
      if ((sample >= 0) !== (previous >= 0)) crossings += 1;
      previous = sample;
      lowpass += alpha * (sample - lowpass);
      loSq += lowpass * lowpass;
      hiSq += (sample - lowpass) ** 2;
    }

    let attack = 0;
    for (let i = 0; i < data.length; i += 1) {
      if (Math.abs(data[i]) >= peak * 0.9) { attack = i / RATE; break; }
    }
    return {
      pad: padId,
      label: pads.PADS[padId].label,
      peak,
      rms: Math.sqrt(sumSq / span),
      hi: hiSq / (hiSq + loSq),
      zcr: crossings / (span / RATE) / 2,
      attackMs: attack * 1000,
      decayMs: (end / RATE) * 1000,
    };
  }

  // Three heights on the pad, because the drag changes the timbre and a
  // problem can hide at one end of it — the clack turned out fizzy only once
  // its band reached far enough up.
  const rows = [];
  for (const padId of pads.PAD_IDS) {
    for (const brightness of [0.1, 0.5, 0.9]) {
      rows.push({ ...(await render(padId, brightness)), brightness });
    }
  }
  return JSON.stringify(rows);
})()`;

const page = await waitForCdp();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    messageId += 1;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

await new Promise((resolve) => (ws.onopen = resolve));
await send("Runtime.enable");
await send("Page.navigate", { url: URL_BASE });
await new Promise((resolve) => setTimeout(resolve, 1500));

const result = await send("Runtime.evaluate", {
  expression: IN_PAGE,
  awaitPromise: true,
  returnByValue: true,
});

ws.close();
chrome.kill();

if (result.exceptionDetails) {
  console.error("Measurement failed in the page:");
  console.error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  process.exit(1);
}

const rows = JSON.parse(result.result.value);
const pad = (text, width) => String(text).padEnd(width);
const num = (value, digits, width) => String(value.toFixed(digits)).padStart(width);

console.log("");
console.log(`  ${pad("pad", 8)}${pad("drag", 7)}${pad("peak", 8)}${pad("rms", 9)}${pad("hi>2kHz", 10)}${pad("zcr", 9)}${pad("attack", 9)}decay`);
console.log(`  ${"-".repeat(67)}`);
let previousPad = null;
for (const row of rows) {
  if (previousPad && previousPad !== row.pad) console.log("");
  previousPad = row.pad;
  const where = row.brightness < 0.3 ? "low" : row.brightness > 0.7 ? "high" : "mid";
  console.log(
    `  ${pad(row.label, 8)}${pad(where, 7)}${num(row.peak, 3, 5)}   ${num(row.rms, 4, 6)}   ${num(row.hi * 100, 1, 6)}%   ${num(row.zcr, 0, 6)}Hz  ${num(row.attackMs, 1, 6)}ms ${num(row.decayMs, 0, 5)}ms`,
  );
}
console.log("");

// The one thing here that is genuinely a fault rather than a matter of taste.
// Compared against the pad bus, not against 1.0 — measuring the voice in
// isolation and warning at 1.0 had me tuning levels down for no reason.
const PAD_LEVEL = 0.85;
const CEILING = 1 / PAD_LEVEL;
const hot = [...new Set(rows.filter((row) => row.peak > CEILING).map((row) => row.label))];
if (hot.length > 0) {
  console.log(`  note: ${hot.join(", ")} peaks above ${CEILING.toFixed(2)} —`);
  console.log("  that clips once the pad bus is applied. The limiter will catch it,");
  console.log("  but nothing above this is headroom you actually have.");
  console.log("");
}
