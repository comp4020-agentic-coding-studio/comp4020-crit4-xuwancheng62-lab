import { describe, expect, it } from "vitest";
import { nextSchedulingWindow } from "../src/scheduler";

describe("nextSchedulingWindow", () => {
  it("books from where the last window stopped to the lookahead horizon", () => {
    expect(nextSchedulingWindow(1, 0.5, 0.1)).toEqual({ from: 0.5, to: 1.1 });
  });

  it("returns null when the horizon is already covered", () => {
    expect(nextSchedulingWindow(1, 1.5, 0.1)).toBeNull();
    expect(nextSchedulingWindow(1, 1.1, 0.1)).toBeNull();
  });

  it("never books the same instant twice across a run of polls", () => {
    // The bug this guards against is audible as a doubled note, so it is worth
    // asserting on the arithmetic rather than trusting the ear.
    const covered: { from: number; to: number }[] = [];
    let scheduledUpTo = 0;
    for (let poll = 0; poll < 40; poll += 1) {
      const now = poll * 0.025;
      const window = nextSchedulingWindow(now, scheduledUpTo, 0.1);
      if (!window) continue;
      covered.push(window);
      scheduledUpTo = window.to;
    }
    for (let index = 1; index < covered.length; index += 1) {
      expect(covered[index].from).toBe(covered[index - 1].to);
    }
  });

  it("leaves no gap when a poll arrives late", () => {
    const first = nextSchedulingWindow(0, 0, 0.1);
    expect(first).not.toBeNull();
    // A long stall between polls: the next window must still start where the
    // last one ended, or everything in between is silently dropped.
    const second = nextSchedulingWindow(5, first!.to, 0.1);
    expect(second).toEqual({ from: first!.to, to: 5.1 });
  });
});
