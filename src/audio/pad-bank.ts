// One voice per pad, all sharing the pad bus — including loop replays, which
// go through the very same voices as a live press. That is structural rather
// than a mixing decision: a repeat cannot drift out of balance with the hand
// that played it, because it is the same signal path.

import { PAD_IDS, PADS, type PadId } from "../pads";
import type { AudioRig } from "./context";
import { type Gesture, type PadVoice, type VoiceParams, createVoice } from "./voices";

export interface PadBank {
  press(padId: PadId, time: number, params: VoiceParams): void;
  moveTo(padId: PadId, time: number, params: VoiceParams): void;
  release(padId: PadId, time: number): void;
  playScheduled(padId: PadId, time: number, gesture: Gesture): void;
}

export function createPadBank(rig: AudioRig): PadBank {
  const env = { ctx: rig.ctx, out: rig.padBus, noiseBuffer: rig.noiseBuffer };
  const voices = new Map<PadId, PadVoice>(
    PAD_IDS.map((padId) => [padId, createVoice(PADS[padId], env)]),
  );

  return {
    press(padId, time, params) {
      voices.get(padId)?.press(time, params);
    },
    moveTo(padId, time, params) {
      voices.get(padId)?.moveTo(time, params);
    },
    release(padId, time) {
      voices.get(padId)?.release(time);
    },
    playScheduled(padId, time, gesture) {
      voices.get(padId)?.playScheduled(time, gesture);
    },
  };
}
