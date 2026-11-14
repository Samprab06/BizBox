"use client";

import dynamic from "next/dynamic";
import { useId, useRef, useState } from "react";
import type { SiteInsights } from "@/lib/contracts/insights";
import { StationCalloutController } from "./station-callout-controller";

const LazyInsightsPanel = dynamic(
  () => import("./insights-panel").then((module) => module.InsightsPanel),
  { loading: () => <p role="status">Loading insights charts…</p> },
);

/** Native modal semantics keep the city inert, trap focus and support Escape. */
export function InsightsDrawer({
  siteId,
  projectId,
  comparisonId,
  data,
  unavailableReason,
  onOpen,
  outdated = false,
  profileVersionUnknown = false,
  profileVersion,
  synthetic,
}: {
  siteId: string;
  projectId?: string;
  comparisonId?: string;
  data?: SiteInsights;
  unavailableReason?: string;
  onOpen?: () => void;
  outdated?: boolean;
  profileVersionUnknown?: boolean;
  profileVersion?: number;
  synthetic?: boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const matching = data?.siteId === siteId ? data : undefined;
  const stationController =
    open && projectId && comparisonId ? (
      <StationCalloutController
        key={comparisonId}
        projectId={projectId}
        comparisonId={comparisonId}
        siteId={siteId}
        profileVersion={profileVersion}
        synthetic={matching?.synthetic ?? synthetic}
      />
    ) : undefined;
  return (
    <>
      <button
        type="button"
        ref={trigger}
        aria-haspopup="dialog"
        aria-controls={id}
        className="mt-3 min-h-10 rounded border border-[var(--sw-baseline)] px-3 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--sw-baseline)]"
        onClick={() => {
          onOpen?.();
          setOpen(true);
          dialog.current?.showModal();
          if (dialog.current) dialog.current.scrollTop = 0;
        }}
      >
        Open site insights
      </button>
      <dialog
        ref={dialog}
        id={id}
        aria-labelledby={id + "-title"}
        aria-describedby={`${id}-description${outdated ? ` ${id}-stale` : ""}${profileVersionUnknown ? ` ${id}-freshness` : ""}`}
        data-surface="viewport"
        className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-full max-w-3xl overflow-y-auto overscroll-contain border-l border-viewport-line bg-viewport-surface p-4 text-viewport-ink backdrop:bg-black/50 sm:p-6"
        onKeyDown={(event) => {
          // Let the dialog close natively without the viewport exiting fullscreen.
          if (event.key === "Escape") event.stopPropagation();
        }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-viewport-line bg-viewport-surface pb-3">
          <div className="min-w-0">
            <h2 id={id + "-title"} className="text-xl font-semibold">
              Site insights
            </h2>
            <p
              id={id + "-description"}
              className="mt-1 break-words text-sm text-viewport-muted"
            >
              Selected site: {siteId}.{" "}
              {matching
                ? "Retained aggregates describe the saved scenario across seeds; the replay shows one representative day."
                : "Cross-seed data is not available for this selection."}
            </p>
            {profileVersion !== undefined && (
              <p className="mt-1 text-xs text-viewport-muted">
                Saved profile v{profileVersion}
              </p>
            )}
          </div>
          <button
            type="button"
            className="min-h-10 shrink-0 rounded border border-viewport-muted px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-viewport-baseline"
            onClick={() => dialog.current?.close()}
          >
            Close insights
          </button>
        </header>
        {outdated && (
          <p
            id={id + "-stale"}
            role="status"
            className="mt-4 text-sm text-[var(--sw-assumption-ink)]"
          >
            Outdated comparison: these insights retain an earlier profile
            snapshot and its assumptions.
          </p>
        )}
        {profileVersionUnknown && (
          <p
            id={id + "-freshness"}
            role="status"
            className="mt-4 text-sm text-[var(--sw-assumption-ink)]"
          >
            The current profile version could not be checked. These insights
            describe the saved snapshot.
          </p>
        )}
        {open && matching ? (
          <LazyInsightsPanel
            data={matching}
            sourceLabel={
              comparisonId
                ? `Saved comparison ${comparisonId}`
                : "Saved modeled scenario"
            }
            stationSlot={stationController}
          />
        ) : (
          <>
            <p role="status" className="mt-5 text-sm text-viewport-muted">
              {unavailableReason ??
                "This saved comparison has no retained cross-seed insights. Representative replay data cannot supply honest seed bands."}
            </p>
            {stationController && (
              <div className="mt-5 rounded-card border border-viewport-line p-4">
                {stationController}
              </div>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
