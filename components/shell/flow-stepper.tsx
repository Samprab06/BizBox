"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { cn, focusRing } from "@/components/ui/cn";
import {
  FLOW_STEPS,
  flowStepFromLocation,
  flowStepHref,
  reachableSteps,
  useFlowProgress,
  type FlowState,
  type FlowStep,
} from "@/lib/client/flow-progress";

/**
 * Scene 1: the progress stepper at the top of every project page. It is the flow's only
 * back/forth navigation: reached steps are links, later steps stay locked until the founder
 * gets there (the workspace and the consultant unlock them through `useFlowProgress`).
 */

export type StepperStatus = "current" | "reached" | "locked";

export type StepperItem = {
  id: FlowStep;
  label: string;
  /** 1-based position shown in the badge. */
  number: number;
  status: StepperStatus;
  /** Null for a locked step: it is shown, not linked. */
  href: string | null;
};

/**
 * The stepper's five entries. The step the URL shows is `current` (and stays openable even
 * if the store has not recorded it yet); other reached steps are links; the rest are locked.
 */
export function stepperItems(
  projectId: string,
  state: Pick<FlowState, "reached">,
  current: FlowStep | null,
): StepperItem[] {
  const reachable = new Set(reachableSteps(state));
  return FLOW_STEPS.map(({ id, label }, index) => {
    const status: StepperStatus =
      id === current ? "current" : reachable.has(id) ? "reached" : "locked";
    return {
      id,
      label,
      number: index + 1,
      status,
      href: status === "locked" ? null : flowStepHref(projectId, id),
    };
  });
}

const badge: Record<StepperStatus, string> = {
  current: "border-accent bg-accent text-on-accent",
  reached: "border-glass-edge bg-white/10 text-ink",
  locked: "border-dashed border-line text-muted",
};

/** Presentational stepper: tested on its own, and the Suspense fallback before the URL is read. */
export function FlowStepperView({ items }: { items: readonly StepperItem[] }) {
  return (
    <nav aria-label="Progress" className="min-w-0" data-flow-stepper="">
      <ol className="flex min-w-0 items-center gap-1">
        {items.map((item, index) => {
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums",
                  badge[item.status],
                )}
              >
                {item.number}
              </span>
              <span
                className={cn(
                  "truncate",
                  item.status === "current"
                    ? "min-w-0 font-semibold text-ink"
                    : "sr-only lg:not-sr-only",
                )}
              >
                {item.label}
              </span>
              {item.status === "locked" && (
                <span className="sr-only"> (not reached yet)</span>
              )}
            </>
          );
          // Phones: bare number badges, so the current label has the room.
          const shape = cn(
            "inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-full py-1 text-[13px] sm:gap-2 sm:text-sm",
            item.status === "current"
              ? "pl-1 pr-2 sm:pr-2.5 lg:pl-1.5"
              : "px-0.5 sm:px-1.5 lg:px-2.5",
          );
          return (
            <li
              key={item.id}
              data-step={item.id}
              data-status={item.status}
              className={cn(
                "flex min-w-0 items-center gap-0.5 sm:gap-1",
                item.status === "current" ? "shrink" : "shrink-0",
              )}
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="hidden h-px w-4 shrink-0 bg-line xl:block"
                />
              )}
              {item.href ? (
                <Link
                  href={item.href}
                  aria-current={item.status === "current" ? "step" : undefined}
                  className={cn(
                    shape,
                    focusRing,
                    item.status === "current"
                      ? "border border-glass-edge bg-white/10"
                      : "text-muted hover:bg-white/10 hover:text-ink",
                  )}
                >
                  {content}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={cn(shape, "cursor-not-allowed text-muted opacity-60")}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function LiveFlowStepper({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { state } = useFlowProgress(projectId);
  const current = flowStepFromLocation(pathname ?? "", search?.toString() ?? "");
  return <FlowStepperView items={stepperItems(projectId, state, current)} />;
}

export function FlowStepper({ projectId }: { projectId: string }) {
  return (
    // useSearchParams needs a Suspense boundary for static rendering; the fallback is the
    // first-visit stepper (only the questions open), which the live one replaces at once.
    <Suspense
      fallback={
        <FlowStepperView items={stepperItems(projectId, { reached: [] }, null)} />
      }
    >
      <LiveFlowStepper projectId={projectId} />
    </Suspense>
  );
}
