"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import {
  useLiveComparison,
  useStoredComparison,
} from "@/lib/client/live-comparison";
import { workspaceHref } from "@/lib/client/workspace-routes";
import { LiveComparisonScreen } from "@/components/comparison/live-comparison-screen";
import { LiveReplayScreen } from "@/components/replay/live-replay-screen";
import { NessieCashFlowPanel } from "@/components/nessie/nessie-cash-flow-panel";

export function ComparisonWorkspace({
  project,
  comparisonId,
  example,
}: {
  project: PreviewProject;
  comparisonId?: string;
  example: ReactNode;
}) {
  const controller = useLiveComparison(project.id, comparisonId);
  return (
    <>
      <LiveComparisonScreen
        project={project}
        controller={controller}
        example={example}
      />
      <NessieCashFlowPanel
        projections={(controller.payload?.result.sites ?? []).map((site) => ({
          siteId: site.siteId,
          label:
            controller.candidates.find(
              ({ candidate }) => candidate.id === site.siteId,
            )?.candidate.address ?? site.siteId,
          monthlyContributionUsd: site.monthlyContributionUsd,
        }))}
        outdated={Boolean(
          controller.payload &&
          (controller.payload.outdated || controller.phase !== "ready"),
        )}
      />
    </>
  );
}

export function ReplayWorkspace({
  project,
  comparisonId,
  siteId,
  dayType,
  example,
}: {
  project: PreviewProject;
  comparisonId?: string;
  siteId?: string;
  dayType: "weekday" | "weekend";
  example: ReactNode;
}) {
  const stored = useStoredComparison(project.id, comparisonId);
  if (stored.phase === "loading")
    return <p role="status">Loading stored comparison…</p>;
  if (stored.phase === "example" || !stored.payload)
    return (
      <div className="min-w-0 space-y-5">
        <p role={stored.failed ? "alert" : "status"}>{stored.message}</p>
        <Link
          className="inline-block text-pine underline"
          href={workspaceHref(project.id, "comparison")}
        >
          Compare live sites
        </Link>
        {stored.failed && (
          <button
            type="button"
            className="ml-4 rounded bg-pine px-3 py-2 text-white"
            onClick={stored.retry}
          >
            Retry comparison
          </button>
        )}
        {example}
      </div>
    );
  return (
    <LiveReplayScreen
      project={project}
      payload={stored.payload}
      siteId={siteId}
      dayType={dayType}
      example={example}
    />
  );
}
