"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveComparison } from "@/lib/client/live-comparison";
import { TaskNav } from "@/components/shell/task-nav";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { AssistantPanel } from "./assistant-panel";
import { WorkspaceShell } from "./workspace-shell";
import { workspaceHeader } from "./model";
import { realCandidates, comparisonMatchesSelection } from "./client-model";
import { useIntakeConversation } from "./use-intake-conversation";
import { LocationExperience } from "./location-experience";
import { WorkspaceBackdrop } from "./workspace-backdrop";

/** Reuses the current service controllers and one conversation; no alternate store. */
export function WorkspaceScreen({
  projectId,
  project,
  siteId,
  navigation,
  tilesetUrl,
}: {
  projectId: string;
  project: PreviewProject | null;
  siteId?: string;
  navigation?: ReactNode;
  tilesetUrl?: string;
}) {
  const conversation = useIntakeConversation(projectId);
  const controller = useLiveComparison(projectId);
  const [view, setView] = useState<"locations" | "interior" | "results">(
    "locations",
  );
  const search = useSearchParams();
  const candidates = realCandidates(controller.candidates);
  const requested = search.get("site") ?? siteId;
  const selected =
    candidates.find((entry) => entry.candidate.id === requested) ??
    candidates[0];
  const header = workspaceHeader(conversation.session, project);
  const summary = [
    "City: " + header.city,
    "Business: " + header.business,
    header.budget,
    selected
      ? "Selected listing: " +
        selected.candidate.address +
        ". Site ID: " +
        selected.candidate.id
      : "No listing selected",
    comparisonMatchesSelection(controller.payload, controller.selectedIds) &&
    controller.payload
      ? "Comparison: " + controller.payload.comparisonId
      : "No saved location comparison",
  ].join(". ");
  function select(id: string) {
    if (!candidates.some((entry) => entry.candidate.id === id)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("site", id);
    // Let Next publish this user-driven URL change to useSearchParams. Passing
    // its private history state marks the call as internal and skips that update.
    window.history.replaceState(null, "", url);
  }
  return (
    <WorkspaceShell
      header={header}
      projectId={projectId}
      selectedSiteId={selected?.candidate.id}
      navigation={
        navigation ?? (
          <TaskNav
            projectId={projectId}
            route="workspace"
            siteId={selected?.candidate.id ?? siteId ?? project?.sites[0]?.id}
            compact
            disclosureLabel="Views"
            footer={
              <Link
                href="/workspace/credits.html"
                className="mt-4 inline-block text-xs underline"
              >
                Photo credits
              </Link>
            }
          />
        )
      }
      backdrop={
        <WorkspaceBackdrop
          city={header.city}
          interior={view === "interior"}
          selected={selected}
          tilesetUrl={tilesetUrl}
        />
      }
      assistant={
        <AssistantPanel
          projectId={projectId}
          conversation={conversation}
          selectedSiteId={selected?.candidate.id}
          summary={summary}
        />
      }
    >
      <LocationExperience
        key={projectId}
        projectId={projectId}
        controller={controller}
        candidates={candidates}
        selected={selected}
        onSelect={select}
        view={view}
        onViewChange={setView}
      />
    </WorkspaceShell>
  );
}
