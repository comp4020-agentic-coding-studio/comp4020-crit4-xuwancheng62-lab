import { beforeEach, describe, expect, it } from "vitest";
import type { BeatGrid } from "../src/beat-clock";
import { BeatPlayer } from "../src/beat-player";

const GRID: BeatGrid = { originTime: 0, bpm: 120 }; // 0.5s per beat

let time = 0;
let beats: { time: number; index: number }[];
let player: BeatPlayer;

beforeEach(() => {
  time = 0;
  beats = [];
  player = new BeatPlayer({
    now: () => time,
    grid: () => GRID,
    onBeat: (absoluteTime, index) => beats.push({ time: absoluteTime, index }),
  });
});

function pollUntil(untilTime: number, stepSeconds = 0.025) {
  while (time < untilTime) {
    player.tick();
    time += stepSeconds;
  }
  player.tick();
}

describe("BeatPlayer", () => {
  it("is off until started", () => {
    expect(player.isOn).toBe(false);
    pollUntil(3);
    expect(beats).toEqual([]);
  });

  it("books one beat per interval, in order, none missing", () => {
    player.start();
    pollUntil(2);
    // Started exactly on a grid beat, so beat 0 is inside the first window.
    expect(beats.map((beat) => beat.time)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(beats.map((beat) => beat.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it("misses no beat when polls arrive at irregular intervals", () => {
    player.start();
    for (const step of [0.01, 0.4, 0.02, 0.9, 0.05, 0.3, 0.7, 0.2]) {
      player.tick();
      time += step;
    }
    player.tick();
    const indices = beats.map((beat) => beat.index);
    expect(indices).toEqual([...indices].sort((left, right) => left - right));
    for (let index = 1; index < indices.length; index += 1) {
      expect(indices[index] - indices[index - 1]).toBe(1); // no gaps
    }
  });

  it("never books the same beat twice, however often it is polled", () => {
    player.start();
    for (let step = 0; step < 30; step += 1) player.tick(); // no time passing
    pollUntil(3);
    const indices = beats.map((beat) => beat.index);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("goes quiet when stopped", () => {
    player.start();
    pollUntil(1);
    const countWhenStopped = beats.length;
    player.stop();
    pollUntil(4);
    expect(beats.length).toBe(countWhenStopped);
  });

  it("resumes in phase after a stop, rather than restarting the bar", () => {
    // Beats come off the shared grid, so a loop running underneath stays
    // locked to the beat even if the player toggles it off and on again.
    player.start();
    pollUntil(1);
    player.stop();
    time = 3.3;
    player.start();
    pollUntil(5);
    for (const beat of beats) {
      expect(beat.time / 0.5).toBeCloseTo(Math.round(beat.time / 0.5));
    }
  });

  it("toggles and reports its new state", () => {
    expect(player.toggle()).toBe(true);
    expect(player.isOn).toBe(true);
    expect(player.toggle()).toBe(false);
    expect(player.isOn).toBe(false);
  });

  it("ignores a second start rather than resetting its cursor", () => {
    player.start();
    pollUntil(1);
    const before = beats.length;
    player.start();
    pollUntil(1.4);
    const indices = beats.map((beat) => beat.index);
    expect(new Set(indices).size).toBe(indices.length);
    expect(beats.length).toBeGreaterThanOrEqual(before);
  });
});
