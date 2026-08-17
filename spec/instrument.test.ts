import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

// This week's published spec, as far as it can be checked mechanically. The
// lines about feel — latency, whether a gesture is expressive or exhausting,
// whether anyone finds music in it uninstructed — are for the crit, not for
// here. What a test can hold is the contract: that the sound is synthesised in
// the page, that every input reaches every pad, and that nothing on the page
// keeps score.
//
// Runs against dist/ for the same reason the invariants do: it checks what
// actually ships.
const DIST = resolve("dist");
const PADS = [
  { id: "a", key: "A", name: "Drum" },
  { id: "s", key: "S", name: "Bell" },
  { id: "d", key: "D", name: "Clack" },
  { id: "f", key: "F", name: "Glide" },
];

const html = readFileSync(join(DIST, "index.html"), "utf8");
const doc = new JSDOM(html).window.document;

function bundledScript(): string {
  const assets = join(DIST, "assets");
  return readdirSync(assets)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(join(assets, name), "utf8"))
    .join("\n");
}

function everyFile(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? everyFile(path) : [path];
  });
}

describe("the browser is the instrument, not a player", () => {
  it("synthesises with the Web Audio API", () => {
    const script = bundledScript();
    expect(script).toContain("AudioContext");
    expect(script).toContain("createOscillator");
    expect(script).toContain("createBiquadFilter");
  });

  it("ships no audio files to play back", () => {
    // The spec line is "sound is made live in the page by the player, not
    // played back". Shipping a sample would be the way to break it without
    // noticing, so the absence is worth asserting rather than assuming.
    const audio = everyFile(DIST).filter((path) =>
      /\.(mp3|wav|ogg|m4a|aac|flac|webm|opus|mid|midi)$/i.test(path),
    );
    expect(audio).toEqual([]);
  });

  it("has no audio or video element to play one from", () => {
    expect(doc.querySelectorAll("audio")).toHaveLength(0);
    expect(doc.querySelectorAll("video")).toHaveLength(0);
  });

  it("references no remote audio source", () => {
    expect(bundledScript()).not.toMatch(/https?:\/\/[^"']*\.(mp3|wav|ogg|m4a)/i);
  });
});

describe("a stranger can play it uninstructed", () => {
  it("opens with an invitation, not a manual", () => {
    const invite = doc.querySelector('[data-testid="invite"]');
    expect(invite?.textContent?.trim()).toBeTruthy();
  });

  it("needs no start button, splash or dialogue before the first sound", () => {
    expect(doc.querySelector("dialog")).toBeNull();
    const blocking = [...doc.querySelectorAll("button")].filter((button) =>
      /^(start|begin|enable|enter|play)\b/i.test(button.textContent?.trim() ?? ""),
    );
    expect(blocking).toEqual([]);
  });

  it("says on the page which keys play it", () => {
    const text = doc.body.textContent ?? "";
    for (const pad of PADS) expect(text).toContain(pad.key);
  });
});

describe("playable with whatever is at hand", () => {
  it("offers all four pads", () => {
    expect(doc.querySelectorAll("[data-pad]")).toHaveLength(PADS.length);
  });

  for (const pad of PADS) {
    describe(`pad ${pad.key}`, () => {
      const element = doc.querySelector(`[data-pad="${pad.id}"]`);

      it("is on the page", () => {
        expect(element).toBeTruthy();
      });

      it("is a real button, so it can be reached by keyboard and touch alike", () => {
        expect(element?.tagName).toBe("BUTTON");
        expect(element?.getAttribute("type")).toBe("button");
        expect(element?.hasAttribute("disabled")).toBe(false);
      });

      it("names its voice", () => {
        expect(element?.textContent).toContain(pad.name);
      });

      it("declares which voice it is, for the audio layer to build", () => {
        expect(element?.getAttribute("data-voice")).toBeTruthy();
      });

      it("shows a picture of the instrument, hidden from screen readers", () => {
        // The name is already the accessible label, so the icon must not be
        // announced a second time.
        const icon = element?.querySelector("svg.pad-icon");
        expect(icon).toBeTruthy();
        expect(icon?.getAttribute("aria-hidden")).toBe("true");
      });
    });
  }

  it("stops the browser from scrolling instead of tracking a drag", () => {
    const css = readdirSync(join(DIST, "assets"))
      .filter((name) => name.endsWith(".css"))
      .map((name) => readFileSync(join(DIST, "assets", name), "utf8"))
      .join("\n");
    expect(css).toContain("touch-action:none");
  });
});

describe("there is no way to play it wrong", () => {
  it("keeps no score and sets no target", () => {
    const text = (doc.body.textContent ?? "").toLowerCase();
    for (const word of ["score", "points", "streak", "level", "high score", "lives"]) {
      expect(text).not.toContain(word);
    }
  });

  it("tells nobody they failed", () => {
    const text = (doc.body.textContent ?? "").toLowerCase();
    for (const word of ["wrong", "incorrect", "failed", "try again", "game over", "missed"]) {
      expect(text).not.toContain(word);
    }
  });

  it("has no form to submit and nothing to get right", () => {
    expect(doc.querySelectorAll("form")).toHaveLength(0);
    expect(doc.querySelectorAll("input")).toHaveLength(0);
  });
});

describe("the beat and the looping layer", () => {
  it("offers a beat toggle that reports its state to assistive tech", () => {
    const toggle = doc.querySelector('[data-testid="beat-toggle"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.hasAttribute("aria-pressed")).toBe(true);
    expect(toggle?.textContent?.trim()).toBeTruthy();
  });

  it("offers one cycling loop control and a clear, rather than three buttons", () => {
    expect(doc.querySelector('[data-testid="loop-advance"]')).toBeTruthy();
    expect(doc.querySelector('[data-testid="loop-clear"]')).toBeTruthy();
    expect(doc.querySelectorAll('[data-testid^="loop-"]')).toHaveLength(3); // + status
  });

  it("starts with nothing to clear", () => {
    expect(doc.querySelector('[data-testid="loop-clear"]')?.hasAttribute("disabled")).toBe(true);
  });

  it("announces what the loop is doing", () => {
    const status = doc.querySelector('[data-testid="loop-status"]');
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.textContent?.trim()).toBeTruthy();
  });
});
