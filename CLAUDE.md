# COMP4020 prototype

Your starter repo for a COMP4020 prototype: a static site in HTML/CSS/TypeScript
that builds to plain HTML/CSS/JS and deploys to GitHub Pages. The deployed site
is what gets marked, not this repo.

The
[course website](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/)
publishes this deliverable's brief and spec, and this repo's name tells you
which deliverable applies. Read both before you plan or build.

## How to work in here

- Keep the dev server running (`pnpm dev`) so you see changes as you make them.
- Run `pnpm check` before you push.
- Open the page in a browser and look at it. The rendered page is the truth;
  your mental model of it isn't.
- When a check fails, read its output before you change anything.
- Never commit a red state.

## The checks

`typecheck`, `build`, `deploy`, `spec`, `lint`, `tests`, `evidence`, `links`,
`secrets`. Run `pnpm check`. Read the failure.

`spec/README.md`, `PROCESS.md` and `reflections/README.md` are in this repo and
say what they are for.

## This file is yours

A starting point, not a rulebook. As you learn what your prototype needs --- a
convention the work has to hold to, a sensor that keeps catching you out, a fact
about the stack that is easy to get wrong --- write it down here. Growing this
file is the work.

## Audio in this repo

- **jsdom implements no Web Audio API at all.** Never construct an
  `AudioContext` at module scope — keep it lazy, inside a function, or merely
  importing the module crashes every test that touches it. This is why the
  timing, tuning and loop logic live in modules that take `now()` as a
  dependency instead of reading `AudioContext.currentTime` themselves.
- **Create and `resume()` the context synchronously inside the
  `pointerdown`/`keydown` handler.** Any `await` before `resume()` loses the
  user-gesture flag and Safari declines to start. Make the unlock idempotent:
  two near-simultaneous first touches must not build two contexts.
- **Never `exponentialRampToValueAtTime` to zero or away from zero.** To zero
  throws `RangeError` in a browser; *from* zero throws nothing and is simply
  silent, which is far worse. Ramp to a small non-zero floor, and set a non-zero
  value before ramping. `spec/fake-audio-context.ts` enforces both, plus NaN
  values and double-`start()` on a source node — it is a sensor, not a stub, so
  do not loosen it to make a test pass.
- **A source node's `start()` can only be called once.** Percussive voices build
  fresh nodes per press; they never reuse one.
- **Schedule ahead, animate off the same clock.** Notes are booked into a
  lookahead window, so a visual fired immediately would run early. Anything
  booked ahead pushes its animation into `VisualEventQueue` stamped with the
  same audio time as the note. Directly-pressed pads skip the queue — nothing
  was scheduled, so they are already in sync.

## Checks and tooling gotchas

- **Import paths are extensionless.** `allowImportingTsExtensions` is off, so
  `./beat-clock`, never `./beat-clock.ts`.
- **`tsconfig.json` `include` must list `src`.** The starter only includes
  `*.ts` and `spec`, so a new directory is silently untypechecked otherwise.
- **stylelint-config-standard rejects BEM.** Class names must be kebab-case, so
  no `pad__ink` or `control--loop`. It also wants `opacity` as a number (`0.4`)
  but `rgb()` alpha as a percentage (`/ 40%`), and enforces ascending
  specificity: put `:hover:not(:disabled)` *after* the plainer selectors.
- **Headless Chrome's `--window-size` is not the marking viewport.** macOS
  clamps the window, so `--window-size=390,844` renders a ~500px-wide page and
  invents overflow bugs that do not exist. To check 390x844 honestly, drive CDP
  and set `Emulation.setDeviceMetricsOverride`. Better still, open real Chrome
  DevTools at the iPhone preset and look.
- **A decorative element sized in `vw` can widen the page.** `overflow-x: clip`
  on `body` is the guard; the glow needed it at the phone viewport.
