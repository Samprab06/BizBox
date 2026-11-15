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
import { ConsultantPanel } from "@/components/ConsultantPanel";
import { FinishBriefNotice } from "@/components/shell/finish-brief-notice";

export function ComparisonWorkspace({
  project,
  comparisonId,
  investigationId,
  example,
}: {
  project: PreviewProject;
  comparisonId?: string;
  investigationId?: string;
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
      <ConsultantPanel
        investigationId={investigationId}
        projectId={project.id}
        cashContextStale={
          controller.phase === "loading" ||
          controller.phase === "running" ||
          Boolean(controller.payload?.outdated)
        }
        profile={
          controller.payload
            ? {
                id: controller.payload.result.profileId,
                version: controller.payload.result.profileVersion,
              }
            : undefined
        }
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
  if (stored.readiness?.status === "needs_brief")
    return (
      <div className="min-w-0 space-y-5">
        <FinishBriefNotice
          projectId={project.id}
          message={stored.readiness.message}
        />
        {project.sites.length > 0 && example}
      </div>
    );
  if (stored.phase === "example" || !stored.payload)
    return (
      <div className="min-w-0 space-y-5">
        <p role={stored.failed ? "alert" : "status"}>{stored.message}</p>
        <Link
          className="inline-block text-accent underline"
          href={workspaceHref(project.id, "comparison")}
        >
          Compare live sites
        </Link>
        {stored.failed && (
          <button
            type="button"
            className="ml-4 rounded bg-accent hover:bg-accent-hover px-3 py-2 text-on-accent"
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
