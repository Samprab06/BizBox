import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** A shared reading order; callers supply computed answers and real scene/actions. */
export function DecisionHeader({
  decision,
  answer,
  qualification,
  scene,
  nextAction,
}: {
  decision: string;
  answer: string;
  qualification: ReactNode;
  scene?: ReactNode;
  nextAction: ReactNode;
}) {
  return (
    <Card className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <h2 className="text-xl font-semibold leading-snug">{decision}</h2>
      <section aria-label="Recommendation robustness">
        <h3 className="text-base font-semibold leading-snug">{answer}</h3>
        <div className="mt-2 space-y-2 text-sm text-muted">{qualification}</div>
      </section>
      {scene && <div className="min-w-0">{scene}</div>}
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {nextAction}
      </div>
    </Card>
  );
}
