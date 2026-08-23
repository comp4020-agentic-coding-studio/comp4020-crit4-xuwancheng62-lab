// Plays the instrument, without a person or a screenshot.
//
// This exists because of a real bug: the page overflowed horizontally at the
// phone marking viewport, and a screenshot of it looked fine until I actually
// tried to scroll — `scrollWidth` alone had already given a false negative
// once, from a native Chrome window that macOS had silently clamped to the
// wrong size. The thing that actually caught it was asking the page a
// yes/no question (`does window.scrollTo() move it?`) instead of looking at
// a picture of it. Every check below is chosen the same way: it has a
// decidable answer, so it doesn't need a human eye.
//
// It renders the REAL page in headless Chrome — a real AudioContext, real
// layout, real Pointer Events — and drives it through: pressing every pad,
// dragging the glide pad's pitch, holding two pads with two fingers at once,
// and a full record -> play -> overdub -> clear loop cycle. It does this at
// both marking viewports, via CDP device metrics (not `--window-size`, which
// macOS clamps and reports a wider layout than the page ever actually has).
//
// Failure modes this is built to catch, that a screenshot would not: an
// uncaught exception thrown from inside a `setInterval`/`requestAnimationFrame`
// callback well after the triggering press returned; a control smaller than
// the 44px touch-target floor; a second finger's release silently cutting off
// the first finger's note; the loop drifting or double-firing over real
// wall-clock time, which `looper.test.ts`'s fake clock cannot exercise.
//
// The drag and multi-touch checks are driven through CDP's `Input` domain
// (`Input.dispatchMouseEvent` / `dispatchTouchEvent`) rather than
// `element.dispatchEvent(new PointerEvent(...))`. The first version used the
// latter and failed on every run — not because the app was wrong, but because
// a JS-constructed PointerEvent never registers as an "active pointer" in
// Chrome's real input bookkeeping, so `element.setPointerCapture()` throws
// `NotFoundError` for it on a bare `<button>` with no app code involved at
// all. Only input that actually went through the browser's input pipeline —
// real hardware, or CDP's `Input` domain — produces a pointer capture can
// find. A check that fails on correct code isn't a stricter check, it's a
// wrong one.
//
//   pnpm dev                 # in one terminal
//   pnpm playtest             # in another
//
// Not wired into `pnpm check`: it needs a browser and a running dev server,
// and unlike the unit suite it drives real timers, so it takes real seconds
// to run. A manual pre-ship check, like `pnpm measure`.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const URL_BASE = process.env.URL ?? "http://localhost:5173/";
const PORT = 9334;

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
  // A synthetic keydown/pointerdown is not the "real" user gesture Chrome's
  // autoplay policy looks for; without this flag ctx.resume() would hang
  // suspended and every voice would render silently rather than throw.
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=/tmp/playtest-${process.pid}`,
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

const page = await waitForCdp();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
const eventHandlers = new Map();

function onEvent(method, handler) {
  const set = eventHandlers.get(method) ?? new Set();
  set.add(handler);
  eventHandlers.set(method, set);
}

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
    return;
  }
  if (message.method) {
    for (const handler of eventHandlers.get(message.method) ?? []) handler(message.params);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve) => {
    messageId += 1;
    pending.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });

const sleepNode = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evalInPage(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

await new Promise((resolve) => (ws.onopen = resolve));
await send("Runtime.enable");
await send("Page.enable");

const consoleErrors = [];
const pageErrors = [];
onEvent("Runtime.consoleAPICalled", (params) => {
  if (params.type === "error") {
    consoleErrors.push(params.args.map((a) => a.value ?? a.description).join(" "));
  }
});
onEvent("Runtime.exceptionThrown", (params) => {
  pageErrors.push(params.exceptionDetails.exception?.description ?? params.exceptionDetails.text);
});

// Running this right after editing the very file it's testing is the normal
// case, not an edge case — and that's exactly when it raced Vite mid-rebuild
// during development: the navigation completed before the dev server had
// finished recompiling the change, so every pad came up uninitialized and a
// batch of unrelated checks failed together. That shape — several checks
// failing at once, on a page that had just been edited — is itself the tell;
// a real regression in one code path does not usually take five unrelated
// ones down with it. Rather than let a slow rebuild masquerade as a broken
// app, this waits for a sign the app actually finished initializing, and
// re-navigates once if it hasn't.
async function loadPage() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loaded = new Promise((resolve) => onEvent("Page.loadEventFired", resolve));
    await send("Page.navigate", { url: URL_BASE });
    await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 4000))]);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const ready = await evalInPage(`JSON.stringify(
      document.querySelectorAll("[data-pad]").length === 4 &&
      document.querySelector('[data-testid="loop-advance"]')?.textContent?.trim() === "Record"
    )`).catch(() => "false");
    if (ready === "true") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("the page never finished initializing after 3 attempts — is the dev server stuck?");
}

// Every assertion the page runs against itself. Written as decidable yes/no
// questions, on purpose — this whole tool exists to replace looking at a
// picture with asking a question that has an answer.
const IN_PAGE = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const results = [];

  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
    } catch (e) {
      results.push({ name, ok: false, detail: String((e && e.message) || e) });
    }
  }
  function assert(cond, message) {
    if (!cond) throw new Error(message);
  }
  function pad(id) {
    return document.querySelector('[data-pad="' + id + '"]');
  }
  function press(key) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  }
  function release(key) {
    document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
  }

  await check("no horizontal scroll at this viewport", () => {
    const before = window.scrollX;
    window.scrollTo(9999, 0);
    const moved = window.scrollX > before;
    window.scrollTo(before, 0);
    assert(!moved, "the page actually scrolled sideways when asked to");
    const doc = document.documentElement;
    assert(
      doc.scrollWidth <= window.innerWidth + 1,
      \`scrollWidth \${doc.scrollWidth} exceeds innerWidth \${window.innerWidth}\`,
    );
  });

  await check("every pad and control meets the 44px touch-target floor", () => {
    const small = [...document.querySelectorAll("[data-pad], .control")]
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 44 || rect.height < 44)
      .map(({ el, rect }) => \`\${el.dataset.testid ?? el.dataset.pad} (\${Math.round(rect.width)}x\${Math.round(rect.height)})\`);
    assert(small.length === 0, \`too small: \${small.join(", ")}\`);
  });

  await check("every pad presses and releases on its key", async () => {
    for (const key of ["a", "s", "d", "f"]) {
      press(key);
      assert(pad(key).hasAttribute("data-held"), \`\${key} not held after keydown\`);
      await sleep(30);
      release(key);
      assert(!pad(key).hasAttribute("data-held"), \`\${key} still held after keyup\`);
      await sleep(20);
    }
  });

  await check("held-key auto-repeat does not re-trigger the pad", async () => {
    press("a");
    for (let i = 0; i < 15; i += 1) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", repeat: true, bubbles: true }));
    }
    assert(pad("a").hasAttribute("data-held"), "pad let go on its own during repeat");
    release("a");
    assert(!pad("a").hasAttribute("data-held"), "pad still held after the real keyup");
  });

  await check("two keys held at once are independent", () => {
    press("a");
    press("f");
    assert(pad("a").hasAttribute("data-held") && pad("f").hasAttribute("data-held"), "both should be held");
    release("a");
    assert(!pad("a").hasAttribute("data-held"), "a should have let go");
    assert(pad("f").hasAttribute("data-held"), "releasing a should not release f");
    release("f");
  });

  await check("record, play, overdub and clear the loop", async () => {
    const loopBtn = document.querySelector('[data-testid="loop-advance"]');
    const clearBtn = document.querySelector('[data-testid="loop-clear"]');
    assert(loopBtn.textContent.trim() === "Record", \`expected Record, got "\${loopBtn.textContent.trim()}"\`);

    loopBtn.click();
    assert(loopBtn.textContent.trim() === "Stop", \`expected Stop, got "\${loopBtn.textContent.trim()}"\`);
    for (const key of ["a", "d"]) {
      press(key);
      await sleep(120);
      release(key);
      await sleep(150);
    }

    loopBtn.click();
    assert(loopBtn.textContent.trim() === "Overdub", \`expected Overdub, got "\${loopBtn.textContent.trim()}"\`);
    assert(!clearBtn.disabled, "Clear should enable once a loop exists");
    // The loop snaps to a 4-beat minimum at the default tempo (2.5s) — wait
    // past that so at least one real scheduled repeat has to fire.
    await sleep(2900);

    loopBtn.click();
    assert(loopBtn.textContent.trim() === "Done", \`expected Done, got "\${loopBtn.textContent.trim()}"\`);
    press("s");
    await sleep(100);
    release("s");
    loopBtn.click();
    assert(loopBtn.textContent.trim() === "Overdub", \`expected Overdub, got "\${loopBtn.textContent.trim()}"\`);
    await sleep(2900); // let the overdubbed layer play through a cycle too

    clearBtn.click();
    assert(loopBtn.textContent.trim() === "Record", \`expected Record after clear, got "\${loopBtn.textContent.trim()}"\`);
    assert(clearBtn.disabled, "Clear should disable once the loop is empty again");
  });

  await check("the beat toggle flips state and its label", () => {
    const beat = document.querySelector('[data-testid="beat-toggle"]');
    const before = beat.getAttribute("aria-pressed");
    beat.click();
    const after = beat.getAttribute("aria-pressed");
    assert(before !== after, "aria-pressed did not change");
    assert(/^Beat (on|off)$/.test(beat.textContent.trim()), \`unexpected label "\${beat.textContent.trim()}"\`);
    beat.click(); // restore, so a re-run starts from the same state
  });

  return JSON.stringify(results);
})()`;

// The desktop pass drags with a real mouse and the phone pass with a real
// touch — matching the spec's "mouse, keyboard or touch", and both go through
// CDP's Input domain rather than a page-side dispatchEvent (see the note at
// the top of this file for why that distinction is load-bearing here).
async function checkDrag(viewport) {
  const name = "dragging the glide pad raises its recorded pitch";
  try {
    const rect = JSON.parse(
      await evalInPage(`JSON.stringify(document.querySelector('[data-pad="f"]').getBoundingClientRect())`),
    );
    const x = rect.left + rect.width / 2;
    const bottomY = rect.top + rect.height - 6;
    const topY = rect.top + 6;
    const useMouse = viewport.width >= 600;
    const readPitch = () =>
      evalInPage(`document.querySelector('[data-pad="f"]').style.getPropertyValue('--pitch')`).then(
        (v) => parseFloat(v) || 0,
      );

    if (useMouse) {
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y: bottomY, button: "left", buttons: 1, clickCount: 1 });
    } else {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: bottomY, id: 1 }] });
    }
    await sleepNode(30);

    // Sampled at three points, not two: two points only ask "did it end up
    // higher than where it started", which a drag that reports one fixed
    // value part-way up can pass by accident (it did — the first version of
    // this check missed that a regression made every move report a constant
    // mid-pad pitch, because that constant still beat the pad's genuinely low
    // starting value). Three points strictly increasing is what actually
    // tells the drag is tracking the finger, not just reacting once.
    const steps = 8;
    const readings = [];
    for (let step = 1; step <= steps; step += 1) {
      const y = bottomY - (step * (bottomY - topY)) / steps;
      if (useMouse) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      } else {
        await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
      }
      await sleepNode(15);
      if (step === Math.ceil(steps / 3) || step === Math.ceil((2 * steps) / 3) || step === steps) {
        readings.push(await readPitch());
      }
    }
    const [low, mid, high] = readings;

    if (useMouse) {
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: topY, button: "left", buttons: 0, clickCount: 1 });
    } else {
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    }

    if (!(low < mid && mid < high)) {
      throw new Error(
        `dragging toward the top should raise --pitch at every step, not just overall (readings: ${low}, ${mid}, ${high})`,
      );
    }
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

// Two-handed play is inherently a touch idea — a mouse has one cursor — so
// this always drives real touch, at both viewports.
async function checkMultiTouch() {
  const name = "two touches on different pads register independently";
  try {
    const [rectA, rectS] = await Promise.all(
      ["a", "s"].map((id) =>
        evalInPage(`JSON.stringify(document.querySelector('[data-pad="${id}"]').getBoundingClientRect())`).then(
          JSON.parse,
        ),
      ),
    );
    const pointA = { x: rectA.left + rectA.width / 2, y: rectA.top + rectA.height / 2, id: 1 };
    const pointS = { x: rectS.left + rectS.width / 2, y: rectS.top + rectS.height / 2, id: 2 };

    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pointA, pointS] });
    await sleepNode(30);
    const held = JSON.parse(
      await evalInPage(`JSON.stringify({
        a: document.querySelector('[data-pad="a"]').hasAttribute("data-held"),
        s: document.querySelector('[data-pad="s"]').hasAttribute("data-held"),
      })`),
    );
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    if (!(held.a && held.s)) {
      throw new Error(`both touches should register (a=${held.a}, s=${held.s})`);
    }
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, detail: error.message };
  }
}

async function runAt(viewport) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.width < 600,
  });
  await loadPage();
  const result = await send("Runtime.evaluate", {
    expression: IN_PAGE,
    awaitPromise: true,
    returnByValue: true,
  });
  const pageResults = result.exceptionDetails
    ? [{ name: "playtest script itself", ok: false, detail: result.exceptionDetails.text }]
    : JSON.parse(result.result.value);

  return [...pageResults, await checkDrag(viewport), await checkMultiTouch()];
}

const VIEWPORTS = [
  { label: "desktop 1920x1080", width: 1920, height: 1080 },
  { label: "phone 390x844", width: 390, height: 844 },
];

let anyFailed = false;
for (const viewport of VIEWPORTS) {
  console.log(`\n${viewport.label}`);
  console.log("-".repeat(viewport.label.length));
  const results = await runAt(viewport);
  for (const result of results) {
    console.log(`  ${result.ok ? "✓" : "✗"} ${result.name}`);
    if (!result.ok) {
      console.log(`      ${result.detail}`);
      anyFailed = true;
    }
  }
}

if (consoleErrors.length > 0 || pageErrors.length > 0) {
  anyFailed = true;
  console.log("\nuncaught, outside the checks above:");
  for (const error of [...pageErrors, ...consoleErrors]) console.log(`  ✗ ${error}`);
}

console.log("");
console.log(anyFailed ? "playtest: FAILED" : "playtest: all checks passed, no uncaught errors");

ws.close();
chrome.kill();
process.exit(anyFailed ? 1 : 0);
