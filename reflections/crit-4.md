# Crit 4 — An instrument

## What was the breakthrough that moved the work forward?

I have no background in music or audio engineering, so when something sounded
wrong I could not explain why — only describe it: "the clack is too quiet". But
I did not need to diagnose the cause. My role was to identify the direction; the
agent's was to make it measurable.

The clack showed this clearly. Its gain was already 0.72, so the parameter said
it was loud enough, but I could hear it was not. Claude Code built an offline
measurement and found a filter discarding most of the sound energy: the real peak
was far below what the gain implied. The same measurement verified the fix.

So the loop became: I hear a problem → I describe the direction → the agent
builds a way to measure it → the check verifies it → I listen again.

## What did this work change about who I want to be as a software developer?

I used to assume that not understanding a domain would stop me supervising an
agent in it. I may not know which filter or envelope needs to change, but I can
still recognise that the experience is moving the wrong way, and that judgement
is worth something.

Subjective judgement alone is not enough, though. "It sounds too quiet"
identifies a problem but cannot be verified. The agent can turn that observation
into a measurement — a stronger harness than either of us could build alone.

So I see this as shared control: I provide direction, perception and push-back;
the agent provides implementation speed, and can build the instruments that make
subjective problems measurable. I do not want to hand a problem over and wait for
the answer. I want to stay responsible for where the product is going, and use
the agent to build the checks that tell us whether we are.
