// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initInstrument } from "../src/app";
import { fakeAudioContextClass } from "./fake-audio-context";

// Input wiring, against a stub AudioContext. Pressing a pad really does build
// an audio graph — that is the point of the press — and jsdom has no Web Audio
// API, so the graph needs something inert to be built against. The behaviours
// asserted here are the input bugs that are painful to find by ear: a held key
// machine-gunning the pad, one hand's release cutting off the other's note, a
// keyup lost to a window blur leaving the glide voice droning.
//
// That audio is deferred until the gesture is asserted separately, in
// spec/audio-deferred.test.ts, where no stub is installed.
const HTML = readFileSync(resolve("dist/index.html"), "utf8");

let detach: () => void;

beforeEach(() => {
  vi.stubGlobal("AudioContext", fakeAudioContextClass());
  document.documentElement.innerHTML = HTML.replace(/<!doctype html>/i, "");
  detach = initInstrument(document);
  return () => {
    detach();
    vi.unstubAllGlobals();
  };
});

describe("initInstrument", () => {
  it("returns a teardown that runs cleanly", () => {
    expect(typeof detach).toBe("function");
    expect(() => detach()).not.toThrow();
  });

  it("labels the loop control with its next action", () => {
    const button = document.querySelector('[data-testid="loop-advance"]');
    expect(button?.textContent?.trim()).toBe("Record");
    expect((button as HTMLElement).dataset.loopState).toBe("empty");
  });

  it("leaves Clear disabled until there is a loop", () => {
    const clear = document.querySelector<HTMLButtonElement>('[data-testid="loop-clear"]');
    expect(clear?.disabled).toBe(true);
  });

  it("describes the loop state in words as well as on the button", () => {
    const status = document.querySelector('[data-testid="loop-status"]');
    expect(status?.textContent).toContain("Record");
  });

  it("finds all four pads", () => {
    expect(document.querySelectorAll("[data-pad]")).toHaveLength(4);
  });

  it("marks a pad held while a key is down, and lets go on keyup", () => {
    const pad = document.querySelector<HTMLElement>('[data-pad="a"]');
    expect(pad?.hasAttribute("data-held")).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(pad?.hasAttribute("data-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
    expect(pad?.hasAttribute("data-held")).toBe(false);
  });

  it("ignores auto-repeat, so a held key does not machine-gun the pad", () => {
    const pad = document.querySelector<HTMLElement>('[data-pad="s"]');
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    for (let index = 0; index < 20; index += 1) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", repeat: true, bubbles: true }),
      );
    }
    expect(pad?.hasAttribute("data-held")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "s", bubbles: true }));
    expect(pad?.hasAttribute("data-held")).toBe(false);
  });

  it("holds two pads at once, so both hands can play", () => {
    const first = document.querySelector<HTMLElement>('[data-pad="a"]');
    const second = document.querySelector<HTMLElement>('[data-pad="f"]');
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true }));
    expect(first?.hasAttribute("data-held")).toBe(true);
    expect(second?.hasAttribute("data-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "a", bubbles: true }));
    expect(first?.hasAttribute("data-held")).toBe(false);
    expect(second?.hasAttribute("data-held")).toBe(true); // the other is untouched
  });

  it("releases a stuck key when the window loses focus", () => {
    const pad = document.querySelector<HTMLElement>('[data-pad="d"]');
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(pad?.hasAttribute("data-held")).toBe(true);

    window.dispatchEvent(new Event("blur"));
    expect(pad?.hasAttribute("data-held")).toBe(false);
  });

  it("ignores keys that are not pads", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    expect(document.querySelectorAll("[data-held]")).toHaveLength(0);
  });

  it("stops listening after teardown", () => {
    detach();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(document.querySelectorAll("[data-held]")).toHaveLength(0);
  });
});
