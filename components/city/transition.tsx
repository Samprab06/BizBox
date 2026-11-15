"use client";

/**
 * HAC-99 (SIM-15): switches the workspace between the street (city) view and the
 * selected space's interior.
 *
 * It owns only which view is shown, the Follow flag and focus. The clock, run and
 * selection stay with the host, which passes the same values to both views, so time
 * does not jump and the selected customer survives the switch. Only one view is
 * mounted at a time, so the street renderer stops while the interior draws (no second
 * graphics loop). The switch is immediate: no camera flight or crossfade, which keeps
 * it safe under reduced motion.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  HANDOFF_LABELS,
  switchView,
  type HandoffState,
  type HandoffView,
} from "./transition-state";

export type ViewHandoff = {
  view: HandoffView;
  following: boolean;
  setFollowing: (following: boolean) => void;
  enter: () => void;
  back: () => void;
};

/** View and Follow state for one workspace. */
export function useViewHandoff(initial: HandoffView = "city"): ViewHandoff {
  const [state, setState] = useState<Pick<HandoffState, "view" | "following">>({
    view: initial,
    following: false,
  });
  // switchView keeps every other field (here, Follow); only the view changes.
  const enter = useCallback(
    () => setState((current) => switchView(current, "interior")),
    [],
  );
  const back = useCallback(
    () => setState((current) => switchView(current, "city")),
    [],
  );
  const setFollowing = useCallback(
    (following: boolean) =>
      setState((current) =>
        current.following === following ? current : { ...current, following },
      ),
    [],
  );
  return { ...state, setFollowing, enter, back };
}

export function CityInteriorTransition({
  handoff,
  siteLabel,
  city,
  interior,
  className = "",
}: {
  handoff: ViewHandoff;
  /** The selected site, named in the view status. */
  siteLabel: string;
  city: ReactNode;
  interior: ReactNode;
  className?: string;
}) {
  const { view, enter, back } = handoff;
  const enterRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    // Entering lands on "Back to street"; going back returns to "Enter the space".
    (view === "interior" ? backRef : enterRef).current?.focus();
  }, [view]);
  return (
    <section
      aria-label="Street and interior"
      data-handoff-view={view}
      className={`min-w-0 space-y-2 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          role="status"
          aria-label="Current view"
          className="text-sm font-medium text-ink"
        >
          {HANDOFF_LABELS[view]} · {siteLabel}
        </p>
        {view === "city" ? (
          <button
            ref={enterRef}
            type="button"
            onClick={enter}
            className="min-h-11 rounded-lg border border-pine bg-pine px-4 text-sm font-semibold text-on-pine"
          >
            Enter the space
          </button>
        ) : (
          <button
            ref={backRef}
            type="button"
            onClick={back}
            className="min-h-11 rounded-lg border border-pine bg-surface px-4 text-sm font-semibold text-pine"
          >
            Back to street
          </button>
        )}
      </div>
      {view === "city" ? city : interior}
    </section>
  );
}
