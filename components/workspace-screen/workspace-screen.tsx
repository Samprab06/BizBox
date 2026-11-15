"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useLiveComparison,
  type FlowEventInfo,
} from "@/lib/client/live-comparison";
import type { PreviewProject } from "@/lib/contracts/workspace-preview";
import {
  useConsultant,
  useConsultantActions,
  useConsultantVoice,
} from "@/components/shell/consultant-shell";
import { isBriefComplete } from "@/components/shell/entry-flow";
import { useContextIntake } from "@/lib/client/use-workspace-context";
import {
  FLOW_STEP_IDS,
  flowStepFromLocation,
  flowStepHref,
  readFlowState,
  useFlowProgress,
} from "@/lib/client/flow-progress";
import { finalizeChosenSite } from "@/lib/client/finalize";
import {
  planWorkspaceActions,
  type WorkspaceEffect,
} from "@/lib/client/agent-jobs";
import type {
  FlowEvent,
  FlowStep,
  HighlightTarget,
  UiAction,
} from "@/lib/contracts/agent";
import { MAX_COMPARE_UNITS, type SiteTweaks } from "@/lib/contracts/evaluation";
import { VOICE_LIMITS } from "@/lib/voice/contracts";
import { WorkspaceShell } from "./workspace-shell";
import { workspaceHeader } from "./model";
import { parseIntakeSession } from "./intake-conversation";
import {
  realCandidates,
  comparisonMatchesSelection,
  finishedComparison,
  toggleComparisonUnit,
} from "./client-model";
import { LocationExperience } from "./location-experience";
import { shownCandidates } from "./shown-candidates";
import { WorkspaceBackdrop } from "./workspace-backdrop";
import type { ListingCameraRequest } from "@/components/city/listing-markers";
import { PropertyDetails, ListingList } from "./property-details";
import {
  greetedKey,
  readFlag,
  readIds,
  resolveWorkspaceStep,
  topSiteIds,
  topSitesKey,
  withoutTweak,
  writeFlag,
  writeIds,
} from "./workspace-flow";
import styles from "./workspace-glass.module.css";

/** Consultant actions already carried out, so a replayed reply does nothing twice. */
const handledActions = new Set<string>();
const subscribeNever = () => () => {};

/**
 * HAC-128/HAC-130: the client workspace over real listings and the Cesium location layer.
 * HAC-143: the assistant (Text / Voice over one conversation) is the consultant shell's dock
 * in the project layout, so it is not mounted here; this screen reuses that conversation and
 * only supplies the selected listing to the dock's voice context. No alternate store.
 *
 * Scene 1: the workspace is the guided flow's `locations`, `compare`, `results` and
 * `finalize` steps (`?step=`). The consultant's UI actions are carried out here, against the
 * same comparison controller this screen renders, and the comparison's progress is told back
 * to the consultant as flow events.
 */
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
  const consultant = useConsultant();
  // Outside a project layout (no shell) the saved session is read directly.
  const raw = useContextIntake(projectId);
  const session = consultant?.conversation.session ?? parseIntakeSession(raw);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const flow = useFlowProgress(projectId);
  // Flow progress lives in localStorage: decide redirects only once the client has it.
  const loaded = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const requestedStep = flowStepFromLocation(pathname, search) ?? "locations";
  const step = resolveWorkspaceStep(
    requestedStep,
    loaded ? flow.reachable : FLOW_STEP_IDS,
  );
  /**
   * Moves between the workspace's steps. They are one page, so the URL changes through the
   * history API (which Next syncs with useSearchParams) without a server round trip; only
   * the questionnaire is a real navigation.
   */
  const goStep = useCallback(
    (next: FlowStep, siteId?: string, replace = false) => {
      const href =
        flowStepHref(projectId, next) +
        (siteId && next !== "questions"
          ? `&site=${encodeURIComponent(siteId)}`
          : "");
      if (next === "questions") return router.push(href);
      if (replace) window.history.replaceState(null, "", href);
      else window.history.pushState(null, "", href);
    },
    [projectId, router],
  );
  const sendEvent = consultant?.conversation.sendEvent;
  const onFlowEvent = useCallback(
    (event: FlowEvent, info?: FlowEventInfo) => {
      // Open results only for a run that matches the choices still on screen; otherwise
      // the compare step shows the run with a "changed since" note and a rerun.
      if (event.kind === "comparison_finished" && info?.matches !== false) {
        flow.reach("results");
        goStep("results");
      }
      // Never awaited: an offline consultant cannot slow or break the run.
      void sendEvent?.(event);
    },
    [flow, goStep, sendEvent],
  );
  // HAC-162: the founder picks units explicitly; nothing is preselected.
  const controller = useLiveComparison(projectId, undefined, {
    manualSelection: true,
    onFlowEvent,
  });
  const [interior, setInterior] = useState(false);
  // HAC-162 side pane: the selected property or the location list. The chat itself is the
  // consultant dock (one conversation), so "none" just closes this pane.
  const [pane, setPane] = useState<"property" | "list" | "none">("property");
  const [cameraRequest, setCameraRequest] = useState<ListingCameraRequest>({
    kind: "overview",
    revision: 0,
  });
  const candidates = useMemo(
    () => realCandidates(controller.candidates),
    [controller.candidates],
  );
  const candidateIds = useMemo(
    () => candidates.map((entry) => entry.candidate.id),
    [candidates],
  );
  const requested = search.get("site") ?? undefined;
  const selected = candidates.find((entry) => entry.candidate.id === requested);
  const selectedId = selected?.candidate.id;
  const [presented, setPresented] = useState<string[] | null>(null);
  useEffect(() => {
    // Read after mount so the server render and first client render agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPresented(readIds(topSitesKey(projectId)));
  }, [projectId]);
  const topIds = topSiteIds(presented, candidateIds);
  // The map and list show the top three plus anything chosen or open; lookups use all.
  const shown = useMemo(
    () =>
      shownCandidates(candidates, topIds, controller.selectedIds, selectedId),
    [candidates, topIds, controller.selectedIds, selectedId],
  );
  const siteTweaks = flow.state.siteTweaks;
  const matching =
    controller.phase === "ready" &&
    comparisonMatchesSelection(
      controller.payload,
      controller.selectedIds,
      controller.tweaksKey,
    )
      ? controller.payload
      : null;

  // A locked step (e.g. results after a tweak) shows the furthest step the founder may open.
  useEffect(() => {
    if (loaded && step !== requestedStep) goStep(step, undefined, true);
  }, [loaded, step, requestedStep, goStep]);
  // The questionnaire marks `locations` reached; a brief completed elsewhere counts too.
  const briefComplete = isBriefComplete(session?.profile);
  const { reach } = flow;
  useEffect(() => {
    if (loaded && briefComplete) reach("locations");
  }, [loaded, briefComplete, reach]);
  // A finished comparison of exactly these units and tweaks unlocks results.
  const matchingId = matching?.comparisonId;
  useEffect(() => {
    if (loaded && matchingId) reach("results");
  }, [loaded, matchingId, reach]);

  // On the first arrival per project the consultant greets with the top 3. It waits for the
  // listings to reach the view context (or for the search to settle without any).
  const view = consultant?.conversation.view;
  const settled = ["ready", "empty", "error", "needs_brief"].includes(
    controller.search?.status ?? "",
  );
  const viewReady =
    settled && (candidates.length === 0 || Boolean(view?.candidates?.length));
  const atLocations = flow.state.reached.includes("locations");
  useEffect(() => {
    if (!loaded || !sendEvent || !atLocations || !viewReady) return;
    if (readFlag(greetedKey(projectId))) return;
    writeFlag(greetedKey(projectId));
    void sendEvent({ kind: "arrived_workspace" });
  }, [loaded, sendEvent, atLocations, viewReady, projectId]);

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
    setInterior(false);
    setPane("property");
  }, [controller.search?.status, requested, selectedId]);
  const header = workspaceHeader(session, project);
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
    matching
      ? "Comparison: " + matching.comparisonId
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

  function bumpCamera(kind: ListingCameraRequest["kind"]) {
    setCameraRequest((request) => ({ kind, revision: request.revision + 1 }));
  }
  function select(id: string) {
    if (!candidates.some((entry) => entry.candidate.id === id)) return;
    setInterior(false);
    setPane("property");
    bumpCamera("selection");
    if (step !== "locations") {
      goStep("locations", id);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("site", id);
    // Let Next publish this user-driven URL change to useSearchParams. Passing
    // its private history state marks the call as internal and skips that update.
    window.history.replaceState(null, "", url);
  }
  /** A new selection invalidates later steps; two or three units unlock `compare`. */
  function applySelection(ids: string[]) {
    controller.setSelectedIds(ids);
    flow.resetAfter("locations");
    if (ids.length >= 2) flow.reach("compare");
  }
  function chooseUnits(ids: string[]) {
    const next = [...new Set(ids)]
      .filter((id) => candidateIds.includes(id))
      .slice(0, MAX_COMPARE_UNITS);
    const current = controller.selectedIds;
    if (
      next.length === current.length &&
      next.every((id) => current.includes(id))
    )
      return;
    applySelection(next);
  }
  function toggleUnit(id: string) {
    if (!candidateIds.includes(id)) return;
    chooseUnits(toggleComparisonUnit(controller.selectedIds, id));
    setCameraRequest((request) => ({
      ...request,
      revision: request.revision + 1,
    }));
  }
  function removeTweak(candidateId: string, field: keyof SiteTweaks) {
    const current = flow.state.siteTweaks[candidateId];
    if (!current) return;
    flow.setSiteTweaks(candidateId, withoutTweak(current, field));
    flow.resetAfter("compare");
  }
  function closeDetails() {
    const url = new URL(window.location.href);
    url.searchParams.delete("site");
    window.history.replaceState(null, "", url);
    setPane("property");
    setInterior(false);
    bumpCamera("overview");
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>("[data-show-location-list]")
        ?.focus({ preventScroll: true }),
    );
  }
  function editChoices() {
    setPane("list");
    setInterior(false);
    if (step !== "locations") goStep("locations");
  }

  function apply(effect: WorkspaceEffect) {
    switch (effect.kind) {
      case "present":
        setPresented(effect.siteIds);
        writeIds(topSitesKey(projectId), effect.siteIds);
        return;
      case "select":
        applySelection(effect.siteIds);
        return;
      case "run":
        void controller.run(effect.siteIds);
        return;
      case "tweaks":
        flow.setSiteTweaks(effect.candidateId, effect.tweaks);
        flow.resetAfter("compare");
        return;
      case "step":
        if (effect.step !== step) goStep(effect.step);
        return;
      case "highlight":
        pulseAnchor(effect.target);
        return;
      case "open_site":
        select(effect.siteId);
        return;
      case "focus_map":
        if (effect.siteIds.length === 1) return select(effect.siteIds[0]);
        setInterior(false);
        setPane("list");
        bumpCamera("overview");
        if (step !== "locations") goStep("locations");
        return;
      case "finalize":
        void finalize(effect.chosenSiteId, effect.rationale);
        return;
    }
  }
  /**
   * Builds the final plan from the latest finished comparison (even when the selection has
   * changed since) and opens the final step. Shared by the consultant's `finalize_plan`
   * action and the "Choose this location" button.
   */
  async function finalize(chosenSiteId: string, rationale?: string) {
    const summary = await finalizeChosenSite({
      projectId,
      payload: finishedComparison(controller.payload),
      chosenSiteId,
      rationale,
      addresses: Object.fromEntries(
        candidates.map((entry) => [
          entry.candidate.id,
          entry.candidate.address,
        ]),
      ),
      tweaks: readFlowState(projectId).siteTweaks,
    });
    if (!summary) return;
    flow.setFinalPlan(summary);
    goStep("finalize");
  }
  useConsultantActions((actions: UiAction[]) => {
    const effects = planWorkspaceActions(actions, {
      candidateIds,
      selectedIds: controller.selectedIds,
      flow: readFlowState(projectId),
      handled: handledActions,
      step,
    });
    for (const action of actions) handledActions.add(action.id);
    for (const effect of effects) apply(effect);
  });

  const locations = step === "locations";
  const sidePaneOpen =
    locations &&
    (pane === "list" || (Boolean(selected) && pane === "property"));
  const running = controller.phase === "running";
  return (
    <WorkspaceShell
      header={header}
      projectId={projectId}
      selectedSiteId={selected?.candidate.id}
      // Scene 1: the header stepper is the only flow navigation, so the workspace has no
      // views menu or "Edit brief" link of its own; only the photo credits remain.
      editBriefHref={null}
      navigation={
        navigation ?? (
          <Link href="/workspace/credits.html" className="text-xs underline">
            Photo credits
          </Link>
        )
      }
      backdrop={
        <WorkspaceBackdrop
          city={header.city}
          interior={locations && interior}
          selected={selected}
          tilesetUrl={tilesetUrl}
          candidates={shown}
          onSelect={select}
          cameraRequest={cameraRequest}
        />
      }
      assistant={
        sidePaneOpen ? (
          <div className={styles.sidePane} data-pane={pane}>
            {selected && pane === "list" && (
              <div
                className={styles.paneTabs}
                role="group"
                aria-label="Side panel"
              >
                <button
                  aria-pressed={false}
                  onClick={() => setPane("property")}
                >
                  Property
                </button>
                <span>Locations</span>
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
                onInterior={() => setInterior(true)}
                onCompare={() => toggleUnit(selected.candidate.id)}
                comparisonAdded={controller.selectedIds.includes(
                  selected.candidate.id,
                )}
                comparisonFull={
                  controller.selectedIds.length >= MAX_COMPARE_UNITS
                }
                onChooseAnother={() => {
                  setPane("list");
                  setInterior(false);
                }}
                compareDisabled={controller.phase === "loading" || running}
              />
            )}
            {pane === "list" && (
              <ListingList
                candidates={shown}
                selectedIds={controller.selectedIds}
                selectedId={selected?.candidate.id}
                running={running}
                search={controller.search}
                onSelect={select}
                onCompareIds={chooseUnits}
                maxSelected={MAX_COMPARE_UNITS}
                topIds={topIds}
                onClose={() => {
                  setPane(selected ? "property" : "none");
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
          </div>
        ) : undefined
      }
    >
      <LocationExperience
        key={projectId}
        projectId={projectId}
        controller={controller}
        candidates={candidates}
        shownCount={shown.length}
        selected={selected}
        onSelect={select}
        step={step}
        interior={interior}
        onInteriorChange={setInterior}
        onShowList={() =>
          setPane((value) => (value === "list" ? "property" : "list"))
        }
        listOpen={pane === "list"}
        onToggleUnit={toggleUnit}
        onCompare={() => {
          flow.reach("compare");
          goStep("compare");
        }}
        onEditChoices={editChoices}
        onOverview={() => {
          setInterior(false);
          bumpCamera("overview");
        }}
        matching={matching}
        tweaks={siteTweaks}
        onRemoveTweak={removeTweak}
        topIds={topIds}
        presented={Boolean(presented?.some((id) => candidateIds.includes(id)))}
        onViewResults={() => {
          flow.reach("results");
          goStep("results");
        }}
        onChooseSite={(id) => void finalize(id)}
        onRerun={() => {
          goStep("compare");
          void controller.run();
        }}
      />
    </WorkspaceShell>
  );
}

/** Scrolls to the consultant's anchor and pulses it (a single highlight under reduced motion). */
function pulseAnchor(target: HighlightTarget) {
  const element = [
    ...document.querySelectorAll<HTMLElement>(
      `[data-agent-anchor="${target}"]`,
    ),
  ].find((entry) => entry.getClientRects().length > 0);
  if (!element) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  element.scrollIntoView({
    block: "nearest",
    behavior: reduce ? "auto" : "smooth",
  });
  element.setAttribute("data-agent-highlight", "");
  const ring = "0 0 0 3px rgb(255 255 255 / 0.85)";
  const clear = "0 0 0 10px rgb(255 255 255 / 0)";
  element.animate?.(
    reduce
      ? [{ boxShadow: ring }, { boxShadow: ring }]
      : [{ boxShadow: ring }, { boxShadow: clear }],
    { duration: reduce ? 1600 : 900, iterations: reduce ? 1 : 2 },
  );
  window.setTimeout(
    () => element.removeAttribute("data-agent-highlight"),
    2000,
  );
}
