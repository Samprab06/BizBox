"use client";

import { useMemo, useState, type ReactNode } from "react";
import { SimulatorDemo } from "@/components/simulator/demo";
import { demoPlan, makeDemo } from "@/components/simulator/fixture";
import type { SpatialDraft } from "@/lib/contracts/spatial";
import type { MatterportConfig } from "./matterport-view";
import styles from "@/components/workspace-screen/workspace-glass.module.css";

const REFERENCE_CONTEXT = {
  kind: "simulator",
  phase: "example",
  synthetic: true,
  siteId: "reference-cafe",
} as const;

export type ReferenceCafeReview = {
  modelId?: "qfmMbTLt4Bo";
  selectedPlan: 0 | 1;
  reviewed: boolean;
};
/** A public visual reference inside the selected project's flow; never selected-unit evidence. */
export function ReferenceCafeStage({
  projectId,
  selectedAddress,
  matterport,
  reference,
  onReferenceChange,
  onFinalize,
  canFinalize = false,
  proposal,
  children,
}: {
  projectId: string;
  selectedAddress: string;
  matterport?: MatterportConfig;
  reference: ReferenceCafeReview;
  onReferenceChange: (reference: ReferenceCafeReview) => void;
  onFinalize?: () => void;
  canFinalize?: boolean;
  proposal?: SpatialDraft;
  children: ReactNode;
}) {
  const data = useMemo(() => makeDemo(), []);
  const [view, setView] = useState<"reference" | "furniture">("reference");
  return (
    <section
      aria-label="Selected location interior stage"
      className={`${styles.glass} pointer-events-auto relative z-20 m-3 max-h-[calc(100dvh-170px)] overflow-auto rounded-2xl p-5`}
    >
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wider text-muted">
          Interior · {selectedAddress}
        </p>
        <h2 className="mt-1 text-xl font-semibold">
          Explore the café operation
        </h2>
        <p className="mt-2 text-sm text-muted">
          Reference café: The Coffee Port. This public Matterport scan is not
          the selected property. Your selected location and exterior economics
          stay unchanged. The counter replay uses 110 generated customers and
          authored behavior, not live Jev.
        </p>
      </header>
      <div
        role="group"
        aria-label="Interior workspace view"
        className="mb-4 flex flex-wrap gap-2"
      >
        <button
          className={styles.secondary}
          aria-pressed={view === "reference"}
          onClick={() => setView("reference")}
        >
          Reference café
        </button>
        <button
          className={styles.secondary}
          aria-pressed={view === "furniture"}
          onClick={() => setView("furniture")}
        >
          Edit furniture proposal{" "}
          {proposal?.items.length ? ` (${proposal.items.length})` : ""}
        </button>
      </div>
      <p className="mb-3 text-xs text-muted">
        Clear proposal removes added catalog objects. Photo defurnishing is
        unavailable: existing furniture captured in the scan stays visible.
      </p>
      <div hidden={view !== "reference"} data-reference-view>
        {!matterport && (
          <section className="mb-5 space-y-3">
            <p role="status" className="text-sm">
              SDK key is unavailable. The real public scan below is explorable;
              simulated people cannot be overlaid. The modeled counter replay
              remains available below.
            </p>
            <iframe
              title="The Coffee Port — public reference scan, not selected property"
              src="https://my.matterport.com/show/?m=qfmMbTLt4Bo&play=1&qs=1"
              allow="fullscreen; xr-spatial-tracking"
              allowFullScreen
              className="h-[420px] w-full rounded-xl border-0"
            />
          </section>
        )}
        <SimulatorDemo
          projectId={projectId}
          data={data}
          plan={demoPlan}
          context={REFERENCE_CONTEXT}
          matterport={matterport}
          furnitureProposal={proposal}
          selectedPlan={reference.selectedPlan}
          onSelectedPlanChange={(selectedPlan) =>
            onReferenceChange({
              modelId: "qfmMbTLt4Bo",
              selectedPlan,
              reviewed: false,
            })
          }
        />
        <section
          className="mt-5 space-y-3 rounded-xl border border-glass-edge p-4"
          aria-label="Reference café review"
        >
          <h3 className="font-medium">Review this reference experiment</h3>
          <p className="text-sm text-muted">
            One vs two staffed counters uses the same seeded workload. Reference
            outcomes stay separate from selected-site forecasts and furniture
            experiments.
          </p>
          <label className="text-sm">
            Reference operating plan{" "}
            <select
              aria-label="Reference operating plan"
              className="ml-2 rounded border border-glass-edge bg-field p-2"
              value={reference.selectedPlan}
              onChange={(event) =>
                onReferenceChange({
                  modelId: "qfmMbTLt4Bo",
                  selectedPlan: Number(event.target.value) as 0 | 1,
                  reviewed: false,
                })
              }
            >
              <option value="0">One staffed counter</option>
              <option value="1">Two staffed counters</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className={styles.secondary}
              onClick={() =>
                onReferenceChange({
                  ...reference,
                  modelId: "qfmMbTLt4Bo",
                  reviewed: true,
                })
              }
            >
              Review reference café result
            </button>
            {onFinalize && (
              <button
                className={styles.primary}
                disabled={!canFinalize}
                onClick={onFinalize}
              >
                Continue to final report
              </button>
            )}
          </div>
          <p className="text-xs text-muted">
            {reference.reviewed
              ? "Reference result reviewed. Furniture edits require their own run and review."
              : "Review the reference result before continuing, or open Furniture proposal to test a layout."}
          </p>
        </section>
      </div>
      <div hidden={view !== "furniture"} data-furniture-view>
        {children}
      </div>
    </section>
  );
}
