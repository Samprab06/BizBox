"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLiveComparison } from "@/lib/client/live-comparison";
import { TaskNav } from "@/components/shell/task-nav";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import { AssistantPanel } from "./assistant-panel";
import { WorkspaceShell } from "./workspace-shell";
import { workspaceHeader } from "./model";
import {
  realCandidates,
  comparisonMatchesSelection,
  toggleComparisonUnit,
} from "./client-model";
import { useIntakeConversation } from "./use-intake-conversation";
import { LocationExperience } from "./location-experience";
import { WorkspaceBackdrop } from "./workspace-backdrop";
import type { ListingCameraRequest } from "@/components/city/listing-markers";
import { PropertyDetails, ListingList } from "./property-details";
import styles from "./workspace-glass.module.css";

/** Reuses the current service controllers and one conversation; no alternate store. */
export function WorkspaceScreen({
  projectId,
  project,
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
  const controller = useLiveComparison(projectId, undefined, {
    manualSelection: true,
  });
  const [view, setView] = useState<"locations" | "interior" | "results">(
    "locations",
  );
  const search = useSearchParams();
  const [pane, setPane] = useState<"property" | "list" | "chat">("property");
  const [cameraRequest, setCameraRequest] = useState<ListingCameraRequest>({
    kind: "overview",
    revision: 0,
  });
  const candidates = useMemo(
    () => realCandidates(controller.candidates),
    [controller.candidates],
  );
  const requested = search.get("site") ?? undefined;
  const selected = candidates.find((entry) => entry.candidate.id === requested);
  const selectedId = selected?.candidate.id;
  useEffect(() => {
    // A criteria change must close an ineligible listing, never choose another
    // property without the founder's intent.
    if (
      !["ready", "empty", "needs_brief"].includes(
        controller.search?.status ?? "",
      ) ||
      !requested ||
      selectedId
    )
      return;
    const url = new URL(window.location.href);
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Keep local tabs consistent with this guarded external URL reset.
    setView("locations");
    setPane("property");
  }, [controller.search?.status, requested, selectedId]);
  const header = workspaceHeader(conversation.session, project);
  useEffect(() => {
    if (selectedId && pane === "property")
      document
        .querySelector<HTMLElement>('[aria-label="Selected location"]')
        ?.focus({ preventScroll: true });
    if (
      (pane !== "list" && (!selectedId || pane !== "property")) ||
      !window.matchMedia("(min-width:480px) and (max-width:850px)").matches
    )
      return;
    document
      .querySelector<HTMLElement>(
        pane === "list"
          ? '[aria-label="Location list"]'
          : '[aria-label="Selected location"]',
      )
      ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selectedId, pane]);
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
    setView("locations");
    setPane("property");
    setCameraRequest((request) => ({
      kind: "selection",
      revision: request.revision + 1,
    }));
  }
  function toggleUnit(id: string) {
    if (!candidates.some((entry) => entry.candidate.id === id)) return;
    controller.setSelectedIds(toggleComparisonUnit(controller.selectedIds, id));
    setCameraRequest((request) => ({
      ...request,
      revision: request.revision + 1,
    }));
  }
  function closeDetails() {
    const url = new URL(window.location.href);
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url);
    setPane("property");
    setView("locations");
    setCameraRequest((request) => ({
      kind: "overview",
      revision: request.revision + 1,
    }));
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-show-location-list]")
        ?.focus({ preventScroll: true }),
    );
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
            siteId={selected?.candidate.id}
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
      assistant={
        <div className={styles.sidePane} data-pane={pane}>
          <button
            className={styles.compactChatToggle}
            onClick={() =>
              setPane((value) => (value === "chat" ? "property" : "chat"))
            }
            aria-expanded={pane === "chat"}
          >
            Chat
          </button>
          {(selected || pane === "list") && (
            <div
              className={styles.paneTabs}
              role="group"
              aria-label="Side panel"
            >
              {selected && (
                <button
                  aria-pressed={pane === "property"}
                  onClick={() => setPane("property")}
                >
                  Property
                </button>
              )}
              {pane === "list" && <span>Locations</span>}
              <button
                aria-pressed={pane === "chat"}
                onClick={() => setPane("chat")}
              >
                Chat
              </button>
            </div>
          )}
          {selected && pane === "property" && (
            <PropertyDetails
              selected={selected}
              candidates={candidates}
              search={controller.search}
              projectId={projectId}
              fullDetailsHref={null}
              onSelect={select}
              onClose={closeDetails}
              onInterior={() => setView("interior")}
              onCompare={() => toggleUnit(selected.candidate.id)}
              comparisonAdded={controller.selectedIds.includes(
                selected.candidate.id,
              )}
              comparisonFull={controller.selectedIds.length >= 2}
              onChooseAnother={() => {
                setPane("list");
                setView("locations");
              }}
              compareDisabled={
                controller.phase === "loading" || controller.phase === "running"
              }
            />
          )}
          {pane === "list" && (
            <ListingList
              candidates={candidates}
              selectedIds={controller.selectedIds}
              selectedId={selected?.candidate.id}
              running={controller.phase === "running"}
              search={controller.search}
              onSelect={select}
              onCompareIds={controller.setSelectedIds}
              maxSelected={2}
              onClose={() => {
                setPane("property");
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLButtonElement>(
                      "[data-show-location-list]",
                    )
                    ?.focus({ preventScroll: true }),
                );
              }}
            />
          )}
          <div
            className={styles.paneChat}
            hidden={
              pane === "list" || (Boolean(selected) && pane === "property")
            }
          >
            <AssistantPanel
              projectId={projectId}
              conversation={conversation}
              selectedSiteId={selected?.candidate.id}
              summary={summary}
            />
          </div>
        </div>
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
        onViewChange={(next) => {
          setView(next);
          if (next === "results") setPane("chat");
        }}
        onShowList={() =>
          setPane((value) => (value === "list" ? "property" : "list"))
        }
        listOpen={pane === "list"}
        onToggleUnit={toggleUnit}
        onEditChoices={() => {
          setPane("list");
          setView("locations");
        }}
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
