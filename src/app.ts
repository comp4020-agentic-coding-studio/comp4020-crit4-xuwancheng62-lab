// Top-level wiring, and the only place allowed to touch an AudioContext, a
// timer or requestAnimationFrame. Everything it wires together is either pure
// or takes its clock as a dependency, which is what keeps the parts testable.

import { paintBreath } from "./animation/breathing";
import { clearHold, flashPad, paintHold } from "./animation/pad-visuals";
import { type AudioRig, ensureAudio } from "./audio/context";
import { type PadBank, createPadBank } from "./audio/pad-bank";
import { playBeatTick } from "./audio/voices";
import { beatPhase } from "./beat-clock";
import { BeatPlayer } from "./beat-player";
import { attachPadController } from "./input/pad-controller";
import { type LoopState, Looper, advanceLabel } from "./looper";
import { PAD_IDS, type PadId } from "./pads";
import { POLL_INTERVAL_MS } from "./scheduler";
import { VisualEventQueue } from "./visual-queue";

// Written as invitations rather than instructions: the brief wants a stranger
// to find the instrument, not read a manual. Nothing here scores or scolds.
const STATUS: Record<LoopState, string> = {
  empty: "Press Record when you want to keep a phrase.",
  recording: "Recording. Press Stop when your phrase is done.",
  playing: "Looping. Press Overdub to layer another pass on top.",
  overdubbing: "Overdubbing. Play along, then press Done.",
};

interface Engine {
  rig: AudioRig;
  bank: PadBank;
  looper: Looper;
  beat: BeatPlayer;
  queue: VisualEventQueue;
}

export function initInstrument(root: ParentNode = document): () => void {
  const pads = new Map<PadId, HTMLElement>();
  for (const padId of PAD_IDS) {
    const element = root.querySelector<HTMLElement>(`[data-pad="${padId}"]`);
    if (element) pads.set(padId, element);
  }

  const loopButton = root.querySelector<HTMLButtonElement>('[data-testid="loop-advance"]');
  const clearButton = root.querySelector<HTMLButtonElement>('[data-testid="loop-clear"]');
  const beatButton = root.querySelector<HTMLButtonElement>('[data-testid="beat-toggle"]');
  const status = root.querySelector<HTMLElement>('[data-testid="loop-status"]');
  const stage = root.querySelector<HTMLElement>('[data-testid="stage"]');
  const beatDot = root.querySelector<HTMLElement>('[data-testid="beat-dot"]');

  let engine: Engine | null = null;
  let pollTimer: number | undefined;
  let frameHandle: number | undefined;

  function renderLoop(state: LoopState): void {
    if (loopButton) {
      loopButton.textContent = advanceLabel(state);
      loopButton.dataset.loopState = state;
    }
    if (clearButton) clearButton.disabled = state === "empty";
    if (status) status.textContent = STATUS[state];
  }

  function renderBeat(on: boolean): void {
    if (!beatButton) return;
    beatButton.setAttribute("aria-pressed", String(on));
    beatButton.textContent = on ? "Beat on" : "Beat off";
  }

  function pulse(element: HTMLElement): void {
    if (typeof element.animate !== "function") return;
    element.animate([{ opacity: 1, transform: "scale(1.5)" }, { opacity: 0.25, transform: "scale(1)" }], {
      duration: 220,
      easing: "ease-out",
    });
  }

  /**
   * Built on the first gesture, never at load: browsers will not start audio
   * outside one. Called from every control as well as the pads, so whichever
   * the player touches first is the thing that brings the page to life.
   */
  function ensureEngine(): Engine {
    if (engine) return engine;
    const rig = ensureAudio();
    const now = () => rig.ctx.currentTime;
    const grid = () => rig.grid;
    const queue = new VisualEventQueue();
    const bank = createPadBank(rig);

    const looper = new Looper({
      now,
      grid,
      trigger: (event, absoluteTime) => {
        bank.playScheduled(event.padId, absoluteTime, event);
        const pad = pads.get(event.padId);
        // Stamped with the same audio time as the note, so a replay booked
        // ahead lights up when it sounds rather than when it was booked.
        if (pad) queue.push({ time: absoluteTime, fire: () => flashPad(pad, event.padId) });
      },
      onStateChange: renderLoop,
    });

    const beat = new BeatPlayer({
      now,
      grid,
      onBeat: (absoluteTime) => {
        playBeatTick(rig.ctx, rig.beatBus, absoluteTime);
        if (beatDot) queue.push({ time: absoluteTime, fire: () => pulse(beatDot) });
      },
    });

    engine = { rig, bank, looper, beat, queue };

    pollTimer = window.setInterval(() => {
      looper.tick();
      beat.tick();
    }, POLL_INTERVAL_MS);

    const step = () => {
      queue.tick(rig.ctx.currentTime);
      if (stage) paintBreath(stage, beatPhase(rig.grid, rig.ctx.currentTime), beat.isOn);
      frameHandle = requestAnimationFrame(step);
    };
    frameHandle = requestAnimationFrame(step);

    // The pulse arrives with the first sound, so the page starts moving the
    // moment it starts sounding.
    beat.start();
    renderBeat(true);
    return engine;
  }

  const detachPads = attachPadController(root, {
    onFirstGesture: () => {
      ensureEngine();
    },
    onPress: (padId, params) => {
      const { rig, bank, looper } = ensureEngine();
      bank.press(padId, rig.ctx.currentTime, params);
      looper.recordPress(padId, params);
      const pad = pads.get(padId);
      if (pad) {
        flashPad(pad, padId);
        paintHold(pad, params);
      }
    },
    onDrag: (padId, params) => {
      if (!engine) return;
      engine.bank.moveTo(padId, engine.rig.ctx.currentTime, params);
      engine.looper.recordDrag(padId, params);
      const pad = pads.get(padId);
      if (pad) paintHold(pad, params);
    },
    onRelease: (padId) => {
      if (!engine) return;
      engine.bank.release(padId, engine.rig.ctx.currentTime);
      engine.looper.recordRelease(padId);
      const pad = pads.get(padId);
      if (pad) clearHold(pad);
    },
  });

  const onLoopClick = () => {
    ensureEngine().looper.advance();
  };
  const onClearClick = () => {
    const { looper, queue } = ensureEngine();
    looper.clear();
    queue.clear(); // drop replay flashes already booked for a loop that is gone
  };
  const onBeatClick = () => {
    renderBeat(ensureEngine().beat.toggle());
  };

  loopButton?.addEventListener("click", onLoopClick);
  clearButton?.addEventListener("click", onClearClick);
  beatButton?.addEventListener("click", onBeatClick);

  renderLoop("empty");

  return () => {
    detachPads();
    loopButton?.removeEventListener("click", onLoopClick);
    clearButton?.removeEventListener("click", onClearClick);
    beatButton?.removeEventListener("click", onBeatClick);
    if (pollTimer !== undefined) window.clearInterval(pollTimer);
    if (frameHandle !== undefined) cancelAnimationFrame(frameHandle);
    engine = null;
  };
}
