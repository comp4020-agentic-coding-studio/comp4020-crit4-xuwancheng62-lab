import { describe, expect, it } from "vitest";
import { VisualEventQueue } from "../src/visual-queue";

describe("VisualEventQueue", () => {
  it("holds an event back until its audio time arrives", () => {
    const queue = new VisualEventQueue();
    const fired: string[] = [];
    queue.push({ time: 1, fire: () => fired.push("beat") });

    queue.tick(0.5);
    expect(fired).toEqual([]);
    expect(queue.pendingCount).toBe(1);

    queue.tick(1);
    expect(fired).toEqual(["beat"]);
    expect(queue.pendingCount).toBe(0);
  });

  it("fires events in time order however they were pushed", () => {
    const queue = new VisualEventQueue();
    const fired: string[] = [];
    queue.push({ time: 3, fire: () => fired.push("third") });
    queue.push({ time: 1, fire: () => fired.push("first") });
    queue.push({ time: 2, fire: () => fired.push("second") });

    queue.tick(5);
    expect(fired).toEqual(["first", "second", "third"]);
  });

  it("fires an event exactly once even if ticked repeatedly past its time", () => {
    const queue = new VisualEventQueue();
    let count = 0;
    queue.push({ time: 1, fire: () => (count += 1) });

    queue.tick(2);
    queue.tick(3);
    queue.tick(4);
    expect(count).toBe(1);
  });

  it("fires everything sharing a time on the same tick", () => {
    const queue = new VisualEventQueue();
    const fired: string[] = [];
    queue.push({ time: 1, fire: () => fired.push("a") });
    queue.push({ time: 1, fire: () => fired.push("b") });

    queue.tick(1);
    expect(fired).toHaveLength(2);
  });

  it("drops everything pending on clear, so a cleared loop stops animating", () => {
    const queue = new VisualEventQueue();
    let fired = false;
    queue.push({ time: 1, fire: () => (fired = true) });

    queue.clear();
    queue.tick(10);
    expect(fired).toBe(false);
    expect(queue.pendingCount).toBe(0);
  });
});
