# Crit 4 — An instrument

## What was the breakthrough that moved the work forward?

Accepting that I could not hear the thing I was building, and treating that as a
harness problem rather than a reason to guess.

I know almost no music theory, so my first instinct was that I could only make
noise. Two decisions fixed that without me needing to learn to read music. The
pads are tuned to a pentatonic scale, which has no semitone pairs, so no two
pads can clash — the instrument is forgiving by construction rather than because
I played it well. And where you touch a pad sets its pitch, snapped to that same
scale, so the expressive gesture cannot land out of tune either.

The second half was the checks. I cannot verify a synth by listening once, so I
made the fake AudioContext my tests run against reject the Web Audio mistakes
that are silent — a gain ramping exponentially from zero produces nothing at all
and throws no error. Then I broke my own pluck envelope on purpose to confirm
the check would actually catch it. Five tests went red naming the fault.

## What did this work change about who I want to be as a software developer?

That deliberately breaking my own code to see whether a check notices is worth
more than the check passing first time. A green suite I have never seen fail
tells me nothing about whether it is watching anything.

It also changed what I think "I can't test this" means. My real constraint was
that I have no ears in the loop — and most of what mattered turned out to be
arithmetic I could check anyway, once I stopped mixing it into the audio code.
