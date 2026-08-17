// Mouse, touch and keyboard all end up as the same three events: a press, a
// drag, a release. Everything above this layer is input-agnostic.
//
// Pointer Events rather than mouse events, because each finger arrives with its
// own pointerId — two-handed play then costs nothing, where a single "current
// pointer" variable would make it impossible.

import {
  clientYToFraction,
  fractionToBrightness,
  fractionToContinuousSemitones,
  fractionToPentatonicSemitones,
} from "../mapping";
import { PADS, type PadId, padForKey } from "../pads";

export interface GestureParams {
  semitones: number;
  brightness: number;
}

export type GestureSource = "pointer" | "keyboard";

export interface PadControllerHandlers {
  /** Runs synchronously before the first onPress, to unlock audio in-gesture. */
  onFirstGesture?: () => void;
  onPress: (padId: PadId, params: GestureParams, source: GestureSource) => void;
  onDrag: (padId: PadId, params: GestureParams, source: GestureSource) => void;
  onRelease: (padId: PadId, source: GestureSource) => void;
}

/** The vertical middle of a pad: its root note, at middling brightness. */
export const NEUTRAL_FRACTION = 0.5;

export function paramsForFraction(padId: PadId, fraction: number): GestureParams {
  return {
    // Only the sustained pad gets continuous pitch. The percussive three snap
    // to the pentatonic ladder, which is what makes them impossible to play
    // out of tune; a glide that snapped would not be a glide.
    semitones: PADS[padId].sustained
      ? fractionToContinuousSemitones(fraction)
      : fractionToPentatonicSemitones(fraction),
    brightness: fractionToBrightness(fraction),
  };
}

function paramsForPointer(padId: PadId, element: Element, clientY: number): GestureParams {
  const rect = element.getBoundingClientRect();
  return paramsForFraction(padId, clientYToFraction(clientY, rect.top, rect.height));
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function attachPadController(
  root: ParentNode,
  handlers: PadControllerHandlers,
): () => void {
  const pads = new Map<PadId, HTMLElement>();
  for (const element of root.querySelectorAll<HTMLElement>("[data-pad]")) {
    const padId = element.dataset.pad as PadId | undefined;
    if (padId && padId in PADS) pads.set(padId, element);
  }

  /** Which pointers/keys are holding each pad, so one letting go does not cut
   * a pad another is still holding. */
  const holders = new Map<PadId, Set<string>>();
  const pointerPads = new Map<number, PadId>();
  const heldKeys = new Set<PadId>();
  let unlocked = false;

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    handlers.onFirstGesture?.();
  }

  function beginHold(padId: PadId, holder: string, params: GestureParams, source: GestureSource) {
    const current = holders.get(padId) ?? new Set<string>();
    const wasHeld = current.size > 0;
    current.add(holder);
    holders.set(padId, current);
    pads.get(padId)?.setAttribute("data-held", "true");
    if (wasHeld) handlers.onDrag(padId, params, source);
    else handlers.onPress(padId, params, source);
  }

  function endHold(padId: PadId, holder: string, source: GestureSource) {
    const current = holders.get(padId);
    if (!current?.delete(holder)) return;
    if (current.size > 0) return;
    holders.delete(padId);
    pads.get(padId)?.removeAttribute("data-held");
    handlers.onRelease(padId, source);
  }

  const onPointerDown = (event: PointerEvent) => {
    const element = event.currentTarget as HTMLElement;
    const padId = element.dataset.pad as PadId | undefined;
    if (!padId) return;
    event.preventDefault();
    unlock(); // synchronous, still inside the gesture — Safari checks for this
    // Capture keeps move/up coming here even once the finger leaves the pad,
    // so a long upward drag does not silently stop tracking.
    if (element.setPointerCapture) element.setPointerCapture(event.pointerId);
    pointerPads.set(event.pointerId, padId);
    beginHold(padId, `p${event.pointerId}`, paramsForPointer(padId, element, event.clientY), "pointer");
  };

  const onPointerMove = (event: PointerEvent) => {
    const padId = pointerPads.get(event.pointerId);
    if (!padId) return;
    const element = pads.get(padId);
    if (!element) return;
    event.preventDefault();
    handlers.onDrag(padId, paramsForPointer(padId, element, event.clientY), "pointer");
  };

  const endPointer = (event: PointerEvent) => {
    const padId = pointerPads.get(event.pointerId);
    if (!padId) return;
    pointerPads.delete(event.pointerId);
    endHold(padId, `p${event.pointerId}`, "pointer");
  };

  // Enter/Space on a focused pad, so the pads work for someone tabbing through
  // the page rather than reaching for A/S/D/F.
  const onPadKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const padId = (event.currentTarget as HTMLElement).dataset.pad as PadId | undefined;
    if (!padId || event.repeat || heldKeys.has(padId)) return;
    event.preventDefault(); // also stops the browser turning this into a click
    unlock();
    heldKeys.add(padId);
    beginHold(padId, "key", paramsForFraction(padId, NEUTRAL_FRACTION), "keyboard");
  };

  const onPadKeyUp = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const padId = (event.currentTarget as HTMLElement).dataset.pad as PadId | undefined;
    if (!padId || !heldKeys.delete(padId)) return;
    endHold(padId, "key", "keyboard");
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
    const padId = padForKey(event.key);
    // `repeat` and the held set both matter: the flag catches auto-repeat, and
    // the set is needed anyway to pair a keyup with the right keydown when
    // several pads are held at once.
    if (!padId || event.repeat || heldKeys.has(padId)) return;
    event.preventDefault();
    unlock();
    heldKeys.add(padId);
    // A keyboard has no vertical axis, so a key plays the pad's root note.
    beginHold(padId, "key", paramsForFraction(padId, NEUTRAL_FRACTION), "keyboard");
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const padId = padForKey(event.key);
    if (!padId || !heldKeys.delete(padId)) return;
    endHold(padId, "key", "keyboard");
  };

  // A held key whose keyup never arrives (window blurred mid-press) would
  // leave the glide voice droning forever.
  const onWindowBlur = () => {
    const stuck = Array.from(heldKeys);
    heldKeys.clear();
    for (const padId of stuck) endHold(padId, "key", "keyboard");
  };

  for (const element of pads.values()) {
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endPointer);
    element.addEventListener("pointercancel", endPointer);
    element.addEventListener("keydown", onPadKeyDown);
    element.addEventListener("keyup", onPadKeyUp);
  }
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onWindowBlur);

  return () => {
    for (const element of pads.values()) {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endPointer);
      element.removeEventListener("pointercancel", endPointer);
      element.removeEventListener("keydown", onPadKeyDown);
      element.removeEventListener("keyup", onPadKeyUp);
    }
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onWindowBlur);
  };
}
