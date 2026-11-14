import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** A shared reading order; callers supply computed answers and real scene/actions. */
export function DecisionHeader({
  decision,
  answer,
  qualification,
  scene,
  nextAction,
  compact = false,
}: {
  decision: string;
  answer: string;
  qualification: ReactNode;
  scene?: ReactNode;
  nextAction: ReactNode;
  compact?: boolean;
}) {
  return (
    <Card
      className={
        compact
          ? "min-w-0 !p-3 space-y-2 [overflow-wrap:anywhere]"
          : "min-w-0 space-y-3 [overflow-wrap:anywhere]"
      }
    >
      <h2
        className={
          compact
            ? "text-base font-semibold leading-snug"
            : "text-xl font-semibold leading-snug"
        }
      >
        {decision}
      </h2>
      <section aria-label="Recommendation robustness">
        <h3
          className={
            compact
              ? "text-sm font-semibold leading-snug"
              : "text-base font-semibold leading-snug"
          }
        >
          {answer}
        </h3>
        <div
          className={
            compact
              ? "mt-1 space-y-1 text-xs text-muted"
              : "mt-2 space-y-2 text-sm text-muted"
          }
        >
          {qualification}
        </div>
      </section>
      {scene && <div className="min-w-0">{scene}</div>}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {nextAction}
      </div>
    </Card>
  );
}
