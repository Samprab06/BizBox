/**
 * HAC-99 (SIM-15): city ↔ interior handoff, as pure state.
 *
 * The workspace holds one context (site, run, playback minute, playing, selected
 * customer, follow). Switching views changes only `view`: it never writes the clock,
 * the selection or the follow flag, so the street view and the interior read the same
 * values on both sides of the switch. The switch is immediate (no camera flight or
 * crossfade), which is also what reduced motion asks for.
 */

export type HandoffView = "city" | "interior";

export type HandoffContext = {
  siteId?: string;
  /** Index of the run (scenario) shown in both views. */
  runIndex: number;
  /** The one shared playback minute. Each view clamps it for display only. */
  minute: number;
  playing: boolean;
  /** Selected customer or employee ID, or "" for none. */
  selected: string;
  /** Whether the inspector's Follow is on. The interior keeps it for the return trip. */
  following: boolean;
};

export type HandoffState = HandoffContext & { view: HandoffView };

/** Moves to `to`. Returns the same object when already there, so nothing re-renders. */
export function switchView<T extends { view: HandoffView }>(
  state: T,
  to: HandoffView,
): T {
  return state.view === to ? state : { ...state, view: to };
}

/**
 * The minute a view draws. The city covers the whole day; the interior only has
 * activity between opening and closing, so it clamps for display. The shared minute
 * itself is never rewritten, so returning to the street resumes at the same time.
 */
export function viewMinute(
  view: HandoffView,
  minute: number,
  hours: { openMin: number; closeMin: number },
): number {
  if (view === "city") return minute;
  return Math.min(hours.closeMin, Math.max(hours.openMin, minute));
}

export const HANDOFF_LABELS: Record<HandoffView, string> = {
  city: "Street view",
  interior: "Interior view",
};
