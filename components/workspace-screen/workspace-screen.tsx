"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveComparison } from "@/lib/client/live-comparison";
import { TaskNav } from "@/components/shell/task-nav";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import {
  useConsultant,
  useConsultantVoice,
} from "@/components/shell/consultant-shell";
import { useContextIntake } from "@/lib/client/use-workspace-context";
import { VOICE_LIMITS } from "@/lib/voice/contracts";
import { WorkspaceShell } from "./workspace-shell";
import { workspaceHeader } from "./model";
import { parseIntakeSession } from "./intake-conversation";
import { realCandidates, comparisonMatchesSelection } from "./client-model";
import { LocationExperience } from "./location-experience";
import { WorkspaceBackdrop } from "./workspace-backdrop";
import type { ListingCameraRequest } from "@/components/city/listing-markers";

/**
 * HAC-128/HAC-130: the client workspace over real listings and the Cesium location layer.
 * HAC-143: the assistant (Text / Voice over one conversation) is the consultant shell's dock
 * in the project layout, so it is not mounted here; this screen reuses that conversation and
 * only supplies the selected listing to the dock's voice context. No alternate store.
 */
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
  const consultant = useConsultant();
  // Outside a project layout (no shell) the saved session is read directly.
  const raw = useContextIntake(projectId);
  const session = consultant?.conversation.session ?? parseIntakeSession(raw);
  const controller = useLiveComparison(projectId);
  const [view, setView] = useState<"locations" | "interior" | "results">(
    "locations",
  );
  const search = useSearchParams();
  const [cameraRequest, setCameraRequest] = useState<ListingCameraRequest>({
    kind: "overview",
    revision: 0,
  });
  const candidates = useMemo(
    () => realCandidates(controller.candidates),
    [controller.candidates],
  );
  const requested = search.get("site") ?? siteId;
  const selected =
    candidates.find((entry) => entry.candidate.id === requested) ??
    candidates[0];
  const selectedId = selected?.candidate.id;
  useEffect(() => {
    // If changed criteria exclude the old space, its URL must follow the new
    // eligible selection just like the details, map and consultant context.
    if (
      controller.search?.status !== "ready" ||
      !requested ||
      !selectedId ||
      requested === selectedId
    )
      return;
    const url = new URL(window.location.href);
    url.searchParams.set("site", selectedId);
    window.history.replaceState(null, "", url);
  }, [controller.search?.status, requested, selectedId]);
  const header = workspaceHeader(session, project);
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
  // The dock's voice reads the selected real listing from this screen while it is mounted.
  useConsultantVoice({
    readContext: () => ({
      projectId,
      mode: "chat",
      ...(selectedId && selectedId.length <= 200
        ? { selectedSiteId: selectedId }
        : {}),
      summary: summary.slice(0, VOICE_LIMITS.summaryChars),
    }),
    submitTranscript: async (text) =>
      consultant ? consultant.conversation.submit(text) : null,
  });
  function select(id: string) {
    if (!candidates.some((entry) => entry.candidate.id === id)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("site", id);
    // Let Next publish this user-driven URL change to useSearchParams. Passing
    // its private history state marks the call as internal and skips that update.
    window.history.replaceState(null, "", url);
    setCameraRequest((request) => ({
      kind: "selection",
      revision: request.revision + 1,
    }));
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
          candidates={candidates}
          onSelect={select}
          cameraRequest={cameraRequest}
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
        onOverview={() => {
          setView("locations");
          setCameraRequest((request) => ({
            kind: "overview",
            revision: request.revision + 1,
          }));
        }}
      />
    </WorkspaceShell>
  );
}
