// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initInstrument } from "../src/app";
import { currentRig } from "../src/audio/context";

// Its own file because it depends on nothing having touched audio yet, and
// vitest gives each file a fresh module registry. Browsers refuse to start
// audio outside a user gesture, so a context built at load time is not a
// tidiness problem — it is a page that never makes a sound. jsdom having no
// Web Audio API at all makes that failure loud here rather than silent in the
// crit.
const HTML = readFileSync(resolve("dist/index.html"), "utf8");

describe("audio is deferred until a gesture", () => {
  it("builds no AudioContext just from loading and initialising", () => {
    document.documentElement.innerHTML = HTML.replace(/<!doctype html>/i, "");
    const detach = initInstrument(document);
    try {
      expect(currentRig()).toBeNull();
      // Proof this is a real assertion rather than a tautology: jsdom has no
      // AudioContext to build with, so had init tried, it would have thrown.
      expect("AudioContext" in globalThis).toBe(false);
    } finally {
      detach();
    }
  });
});
