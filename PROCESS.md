# Process overview

## What I built

**Four Pads** — four voices that differ by construction, not by retuning one
oscillator: a swept-sine drum with a noise beater, an FM bell on an inharmonic
ratio, a resonant bandpass on noise, and a detuned sawtooth that sustains and
glides. Each pad carries a drawing of its instrument.
Where you touch a pad sets its pitch, so a tap is expressive before anyone
discovers dragging. The percussive three snap to a pentatonic ladder, which has
no semitone pairs — so no combination can clash and someone who reads no music
cannot land out of tune. A quiet unaccented pulse and a record/overdub/clear
loop sit underneath.

## The moments that mattered

1. **The loop and the beat would have drifted apart.** Independent clocks are
   simpler and sound fine until both are on: a loop that isn't a whole number of
   beats slides further off the pulse every cycle. Rather than quantise the
   notes — flattening the groove, the part a
   player feels — I snapped only the loop's start and length to a shared grid,
   and left the pulse unaccented so an odd-length loop has no bar to fight
   ([`0e6a618`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/0e6a618)).
   What told me it took: repeats land exactly one loop length apart, and a
   closed loop measures a whole number of beats.

2. **I can't hear this, so I made the harness listen.** I turned the jsdom
   AudioContext stub from scaffolding into a sensor: it rejects a ramp to zero
   (throws in a browser), a ramp *away* from zero (silent, throws nothing), a
   NaN reaching an AudioParam, and a node started twice. Then I swept every
   voice across every gesture through it. Proof it wasn't decorative — deleting
   one line so the drum's gain ramped from zero turned five tests red naming
   the fault, green again restored
   ([`6783b76`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/6783b76)).
   That failure makes no sound and logs no error.

Full arc:
[`0c5cba6...6783b76`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/compare/0c5cba6...6783b76).
