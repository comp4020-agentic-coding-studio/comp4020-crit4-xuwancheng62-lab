# Process overview

## What I built

**Four Pads** — four voices built differently, not one oscillator retuned: a
swept-sine drum, an FM bell, a band of filtered noise, and a sustaining sawtooth
that glides. Touch position sets pitch, and the percussive three snap to a
pentatonic ladder — no semitone pairs, so nothing can clash. A background pulse
and a record/overdub/clear loop sit underneath, snapped to its beat grid.

## The moments that mattered

1. **I cannot hear this, so I made the harness listen.** jsdom has no Web Audio
   API, so my tests run against a stub `AudioContext`. I turned it from
   scaffolding into a sensor: it rejects an exponential ramp to zero, which
   throws in a browser, and a ramp *away* from zero, which throws nothing and is
   merely silent. Then I broke the drum's envelope so its gain ramped from zero.
   Five tests went red naming the fault, green again restored
   ([`6783b76`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/6783b76)).
   A check I have never seen fail is not a check.

2. **The checker was wrong before the app was.** `pnpm playtest` drives a real
   browser instead of judging screenshots, but its first drag/multi-touch
   checks failed on correct code: a JS-constructed `PointerEvent` never
   registers as an active pointer, so real `setPointerCapture` throws for it.
   Fixed to drive CDP's real input, then broke the drag handler on purpose to
   test the fix — the two-point version passed anyway, fooled by a constant
   that merely beat the pad's low starting value. A three-point check caught
   it ([`3409665`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/3409665)).
   Then a crashed run left Chrome's real audio looping the beat through actual
   speakers for half an hour, caught only by someone's earbuds still playing
   it. `--mute-audio` is now the guarantee that needs no other code to run
   correctly
   ([`3e7010b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/commit/3e7010b)).

Full arc:
[`0c5cba6...3e7010b`](https://github.com/comp4020-agentic-coding-studio/comp4020-crit4-xuwancheng62-lab/compare/0c5cba6...3e7010b).
