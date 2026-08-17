# Process overview

## What I built

**Four Pads** — four voices that differ by construction, not by retuning one
oscillator: a swept-sine drum with a noise beater, an FM bell on an inharmonic
ratio, a band of filtered noise, and a detuned sawtooth that sustains and
glides. Each pad carries a drawing of its instrument. Where you touch a pad sets
its pitch, so a tap is already expressive, and the percussive three snap to a
pentatonic ladder, which has no semitone pairs — so someone who reads no music
cannot land out of tune. Under it, a background pulse and a record/overdub/clear
loop snapped to its beat grid.

## The moments that mattered

1. **I cannot hear this, so I made the harness listen.** jsdom has no Web Audio
   API, so my tests run against a stub `AudioContext`. I turned it from
   scaffolding into a sensor: it rejects an exponential ramp to zero, which
   throws in a browser, and a ramp *away* from zero, which throws nothing and is
   merely silent. Then I broke the drum's envelope so its gain ramped from zero.
   Five tests went red naming the fault, green again restored
   ([`6783b76`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/6783b76)).
   A check I have never seen fail is not a check.

2. **Then "too quiet" showed gain was the wrong knob.** I had already raised the
   clack's gain. Rendering the real voices through an `OfflineAudioContext`
   found why: a bandpass with a Q of 2.4 discarded most of the noise energy, so
   a gain of `0.72` reached the ear as a peak of `0.17`.
   Rebuilt as a wide band with a bounded top, its level rose ninefold
   ([`1566476...d9ef629`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/compare/1566476...d9ef629)).
   I kept the instrument as `pnpm measure`, and it repaid that at once —
   catching the clack clipping and fizzing only at the *top* of the pad, where I
   hadn't looked.

Full arc:
[`0c5cba6...d9ef629`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/compare/0c5cba6...d9ef629).
