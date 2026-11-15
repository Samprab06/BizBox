"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
import {
  useContextIntake,
  useWorkspaceReport,
} from "@/lib/client/use-workspace-context";
import {
  FLOW_STEP_IDS,
  flowStepFromLocation,
  flowStepHref,
  readFlowState,
  hasReviewedInterior,
  InteriorFlowSchema,
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
import { profileFromIntake } from "@/lib/client/intake-business-profile";
import { applySpatialCommand, runSpatialExperiment } from "@/lib/spatial";
import type { SpatialCommand, SpatialScanContext } from "@/lib/contracts/spatial";
import { prepareScanFurnitureExperiment, FloorPlacementRequired } from "@/lib/interior/proposal-placement";
import { buildControlledExperimentFinding } from "@/lib/interior/controlled-experiment";
import type { WorkspaceObservation } from "@/lib/client/workspace-context";
import {
  createInteriorFlow,
  prepareInteriorFlow,
  matchesInteriorScope,
  matchesReferenceReview,
  finalizeWhileCurrent,
} from "./interior-experiment-state";
import type { InteriorRequestScope } from "@/components/interior/selected-interior-loader";
import { SelectedSiteInteriorStage } from "@/components/interior/selected-site-interior-stage";
import { fetchInteriorPolicies } from "@/lib/client/interior-policies";
import {
  fetchInteriorAffordability,
  interiorAffordabilityRequest,
} from "@/lib/client/interior-affordability";
import {
  interiorAffordabilityFingerprint,
  type InteriorAffordabilityAssessment,
} from "@/lib/contracts/interior-affordability";

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
  matterportSdkKey,
}: {
  projectId: string;
  project: PreviewProject | null;
  siteId?: string;
  navigation?: ReactNode;
  tilesetUrl?: string;
  matterportSdkKey?: string;
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
  const [interiorError, setInteriorError] = useState<string | null>(null);
  const [scanContextRecord, setScanContextRecord] = useState<{siteId:string;comparisonId:string;draftId:string;context:SpatialScanContext}>();
  const [pendingProposal, setPendingProposal] = useState<{action:Extract<WorkspaceEffect,{kind:"propose_interior_experiment"}>;modelId:string}>();
  const [interiorPreparing, setInteriorPreparing] = useState(false);
  const pendingNativeRun = useRef<{fingerprint:string;comparisonId:string;modelId:string;revision:number} | undefined>(undefined);
  const [affordabilityPreparing, setAffordabilityPreparing] = useState(false);
  const [affordabilityError, setAffordabilityError] = useState<string | null>(
    null,
  );
  const affordabilityJob = useRef<AbortController | null>(null);
  useEffect(() => () => affordabilityJob.current?.abort(), []);
  const preparation = useRef<{
    controller: AbortController;
    fingerprint: string;
    comparisonId: string;
  } | null>(null);
  useEffect(() => () => preparation.current?.controller.abort(), []);
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
  // Keep every current search result on the map and in the list. Top picks only
  // control the ranked summary, so old recommendations cannot hide alternatives.
  const shown = useMemo(
    () =>
      shownCandidates(candidates, candidateIds, controller.selectedIds, selectedId),
    [candidates, candidateIds, controller.selectedIds, selectedId],
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
  const currentComparisonId = useRef(matchingId);
  useEffect(() => {
    currentComparisonId.current = matchingId;
  }, [matchingId]);
  const interiorState = flow.state.interior;
  const scanContext = scanContextRecord?.siteId === interiorState?.siteId && scanContextRecord?.draftId === interiorState?.draft.id && scanContextRecord?.comparisonId === interiorState?.comparisonId
    ? scanContextRecord?.context : undefined;
  const interiorFingerprint = JSON.stringify(interiorState);
  const affordabilityVersion = JSON.stringify(
    interiorState
      ? {
          ...interiorState,
          affordability: undefined,
          affordabilityAccountId: undefined,
        }
      : null,
  );
  useEffect(() => {
    const active = affordabilityJob.current;
    if (active) {
      active.abort();
      affordabilityJob.current = null;
      setAffordabilityPreparing(false);
      setAffordabilityError(null);
    }
  }, [affordabilityVersion, matchingId]);
  useEffect(() => {
    const native = pendingNativeRun.current;
    if(native && (native.fingerprint!==interiorFingerprint || native.comparisonId!==matchingId)) {
      pendingNativeRun.current=undefined;
      setInteriorPreparing(false);
    }
    const active = preparation.current;
    if (
      active &&
      (active.fingerprint !== interiorFingerprint ||
        active.comparisonId !== matchingId)
    ) {
      active.controller.abort();
      preparation.current = null;
      setInteriorPreparing(false);
    }
  }, [interiorFingerprint, matchingId]);
  const interiorCurrent = Boolean(
    interiorState &&
    matchingId === interiorState.comparisonId &&
    interiorState.draft.projectId === projectId &&
    controller.selectedIds.includes(interiorState.siteId),
  );
  const spatialObservation = useMemo<WorkspaceObservation>(
    () => ({
      kind: "interior",
      phase: interiorCurrent ? "ready" : "missing",
      ...(interiorCurrent && interiorState
        ? {
            spatial: {
              comparisonId: interiorState.comparisonId,
              baseline: interiorState.baseline,
              draft: interiorState.draft,
              ranRevision: interiorState.ranRevision,
              ...(scanContext ? {scanContext} : {}),
              ...(interiorState.experimentQuestion ? {experimentQuestion:interiorState.experimentQuestion} : {}),
              ...(interiorState.finding ? {finding:interiorState.finding} : {}),
              ...(interiorState.source ? { source: interiorState.source } : {}),
              ...(interiorState.policies
                ? { policies: interiorState.policies }
                : {}),
              ...(interiorState.policyReceipt
                ? { policyReceipt: interiorState.policyReceipt }
                : {}),
              ...(interiorState.affordability
                ? { affordability: interiorState.affordability }
                : {}),
              ...(interiorState.affordabilityAccountId
                ? {
                    affordabilityAccountId:
                      interiorState.affordabilityAccountId,
                  }
                : {}),
              ...(interiorState.reference
                ? { reference: interiorState.reference }
                : {}),
              reviewed: hasReviewedInterior(interiorState, {
                projectId,
                siteId: interiorState.siteId,
                comparisonId: interiorState.comparisonId,
              }),
            },
          }
        : {}),
    }),
    [interiorCurrent, interiorState, projectId, scanContext],
  );
  useWorkspaceReport(projectId, spatialObservation);
  useEffect(() => {
    if (loaded && matchingId) {
      if (
        flow.state.interior &&
        flow.state.interior.comparisonId !== matchingId
      )
        flow.resetAfter("results");
      reach("results");
    }
  }, [loaded, matchingId, reach, flow]);

  // On the first arrival per project the consultant greets with the top 3. It waits for the
  // listings to reach the view context (or for the search to settle without any).
  const view = consultant?.conversation.view;
  const announcedFinding = useRef<string | undefined>(undefined);
  useEffect(() => {
    if(!sendEvent || !interiorState?.finding || interiorState.ranRevision!==interiorState.draft.revision || view?.spatial?.ranRevision!==interiorState.draft.revision || view.spatial.draft.id!==interiorState.draft.id || view.spatial.comparisonId!==interiorState.comparisonId)return;
    const key=`${interiorState.comparisonId}:${interiorState.draft.id}:${interiorState.draft.revision}`;
    if(announcedFinding.current===key)return;
    announcedFinding.current=key;
    void sendEvent({kind:"interior_experiment_finished",siteId:interiorState.siteId,comparisonId:interiorState.comparisonId,draftRevision:interiorState.draft.revision});
  }, [sendEvent,interiorState,view]);
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
      case "open_interior":
        openInterior(effect.siteId);
        return;
      case "set_reference_cafe": {
        const current = readFlowState(projectId).interior;
        if (
          current &&
          matchesInteriorScope(current, effect) &&
          matchesReferenceReview(current.reference, effect.expectedReference)
        )
          flow.setInterior({
            ...current,
            reference: {
              modelId: "qfmMbTLt4Bo",
              selectedPlan: effect.selectedPlan,
              reviewed: effect.reviewed,
            },
          });
        return;
      }
      case "propose_interior_experiment":
        void proposeInteriorExperiment(effect);
        return;
      case "spatial_edit":
        if (matchesInteriorScope(readFlowState(projectId).interior, effect))
          editInterior(effect.command);
        return;
      case "run_spatial_experiment":
        if (matchesInteriorScope(readFlowState(projectId).interior, effect))
          void runInterior(effect.behavior ?? "jev");
        return;
      case "review_interior":
        if (matchesInteriorScope(readFlowState(projectId).interior, effect))
          reviewInterior();
        return;
      case "set_interior_affordability":
        if (matchesInteriorScope(readFlowState(projectId).interior, effect))
          return acceptAffordability(effect.assessment, effect.accountId);
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
  function openInterior(siteId: string, rationale?: string) {
    setAffordabilityError(null);
    if (
      !matching ||
      !matching.result.sites.some((site) => site.siteId === siteId)
    ) {
      setInteriorError(
        "Finish a current exterior comparison before opening an interior experiment.",
      );
      return;
    }
    try {
      const existing = readFlowState(projectId).interior;
      if (
        !existing ||
        existing.siteId !== siteId ||
        existing.comparisonId !== matching.comparisonId
      ) {
        const { profile } = profileFromIntake(session, projectId);
        if (!profile)
          throw new Error(
            "Complete the business profile before modeling this interior.",
          );
        flow.setInterior(
          createInteriorFlow({
            projectId,
            siteId,
            comparisonId: matching.comparisonId,
            profile,
            selectionRationale: rationale,
          }),
        );
      } else if (rationale?.trim())
        flow.setInterior({ ...existing, selectionRationale: rationale.trim() });
      else flow.reach("interior");
      setInteriorError(null);
      goStep("interior", siteId);
    } catch (error) {
      setInteriorError(
        error instanceof Error ? error.message : "Interior unavailable",
      );
    }
  }
  async function proposeInteriorExperiment(effect: Extract<WorkspaceEffect,{kind:"propose_interior_experiment"}>, context = scanContext) {
    const current = readFlowState(projectId).interior;
    if(!current || !matchesInteriorScope(current,effect) || !matching || current.comparisonId!==matching.comparisonId)return;
    try {
      const proposal = prepareScanFurnitureExperiment({current:current.draft,source:current.source,scanContext:context,catalogId:effect.catalogId,question:effect.question,position:effect.position});
      setPendingProposal(undefined);
      const next=InteriorFlowSchema.parse({...current,baseline:proposal.baseline,draft:proposal.variant,experimentQuestion:proposal.question,finding:undefined,policies:undefined,policyReceipt:undefined,ranRevision:null,reviewedRevision:null,affordability:undefined,affordabilityAccountId:undefined});
      pendingNativeRun.current={fingerprint:JSON.stringify(next),comparisonId:current.comparisonId,modelId:current.source!.kind==="scan"?current.source!.modelId:"",revision:proposal.variant.revision};
      setInteriorPreparing(true);
      flow.setInterior(next);
    } catch(error) {
      if(error instanceof FloorPlacementRequired && current.source?.kind==="scan") {setPendingProposal({action:effect,modelId:current.source.modelId});setInteriorError(null);}
      else setInteriorError(error instanceof Error?error.message:"Could not place the proposal.");
    }
  }
  function receiveScanContext(context:SpatialScanContext, scope:InteriorRequestScope) {
    const current=readFlowState(projectId).interior;
    if(!current || scope.projectId!==projectId || scope.siteId!==current.siteId || scope.comparisonId!==current.comparisonId || scope.draftId!==current.draft.id || current.source?.kind!=="scan" || current.source.modelId!==context.modelId)return;
    setScanContextRecord(previous=>JSON.stringify(previous?.context)===JSON.stringify(context) && previous?.siteId===current.siteId && previous?.comparisonId===current.comparisonId && previous?.draftId===current.draft.id ? previous : {siteId:current.siteId,comparisonId:current.comparisonId,draftId:current.draft.id,context});
    if(pendingProposal && pendingProposal.modelId===context.modelId && matchesInteriorScope(current,pendingProposal.action) && context.placementAvailable) {
      setPendingProposal(undefined);
      void proposeInteriorExperiment(pendingProposal.action,context);
    }
  }
  function receiveProposalStatus(status:{revision:number;status:"loading"|"ready"|"failed"},scope:InteriorRequestScope,modelId:string) {
    const pending=pendingNativeRun.current,current=readFlowState(projectId).interior;
    if(!pending || !current || status.revision!==pending.revision || scope.projectId!==projectId || scope.siteId!==current.siteId || scope.comparisonId!==current.comparisonId || scope.draftId!==current.draft.id || modelId!==pending.modelId || JSON.stringify(current)!==pending.fingerprint)return;
    if(status.status==="ready") {pendingNativeRun.current=undefined;void runInterior("jev");}
    else if(status.status==="failed") {pendingNativeRun.current=undefined;setInteriorPreparing(false);setInteriorError("The furniture could not be loaded. The experiment has not run.");}
  }
  function undoInteriorExperiment() {
    const current=readFlowState(projectId).interior;
    if(!current)return;
    preparation.current?.controller.abort();
    pendingNativeRun.current=undefined;
    setInteriorPreparing(false);
    setPendingProposal(undefined);
    flow.setInterior({...current,draft:current.baseline,experimentQuestion:undefined,finding:undefined,policies:undefined,policyReceipt:undefined,ranRevision:null,reviewedRevision:null,affordability:undefined,affordabilityAccountId:undefined});
  }
  function editInterior(command: SpatialCommand) {
    setAffordabilityError(null);
    const current = readFlowState(projectId).interior;
    if (!current || !matching || current.comparisonId !== matching.comparisonId)
      return;
    try {
      if(command.type === "add" && current.source?.kind === "scan") {
        const proposal=prepareScanFurnitureExperiment({current:current.draft,source:current.source,scanContext,catalogId:command.catalogId,question:"Add furniture in this view"});
        const draft={...proposal.variant,items:proposal.variant.items.map((item,index)=>index===proposal.variant.items.length-1?{...item,id:command.id}:item)};
        flow.setInterior({...current,baseline:proposal.baseline,draft,experimentQuestion:undefined,finding:undefined,ranRevision:null,reviewedRevision:null,policies:undefined,policyReceipt:undefined,affordability:undefined,affordabilityAccountId:undefined});
        setInteriorError(null);
        return;
      }
      const draft = applySpatialCommand(current.draft, command);
      flow.setInterior({
        ...current,
        draft,
        finding: undefined,
        experimentQuestion: undefined,
        ranRevision: null,
        reviewedRevision: null,
        policies: undefined,
        policyReceipt: undefined,
        affordability: undefined,
        affordabilityAccountId: undefined,
      });
      setInteriorError(null);
    } catch (error) {
      setInteriorError(
        error instanceof Error
          ? error.message
          : "The edit could not be applied.",
      );
    }
  }
  async function runInterior(mode: "jev" | "assumed" = "jev") {
    const current = readFlowState(projectId).interior;
    if (!current || !matching || current.comparisonId !== matching.comparisonId)
      return;
    preparation.current?.controller.abort();
    const controller = new AbortController();
    const job = {
      controller,
      fingerprint: JSON.stringify(current),
      comparisonId: current.comparisonId,
    };
    preparation.current = job;
    setInteriorPreparing(mode === "jev");
    setInteriorError(null);
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const prepared =
        mode === "jev"
          ? await fetchInteriorPolicies(
              projectId,
              {
                comparisonId: current.comparisonId,
                baseline: current.baseline,
                variant: current.draft,
              },
              controller.signal,
            )
          : undefined;
      const policies = prepared?.policies;
      const result = runSpatialExperiment({
        baseline: current.baseline,
        variant: current.draft,
        policies,
      });
      const finding = current.experimentQuestion ? buildControlledExperimentFinding({question:current.experimentQuestion,baseline:current.baseline,variant:current.draft,result}) : undefined;
      if (
        controller.signal.aborted ||
        preparation.current !== job ||
        currentComparisonId.current !== current.comparisonId ||
        JSON.stringify(readFlowState(projectId).interior) !== job.fingerprint
      )
        return;
      flow.setInterior({
        ...current,
        policies,
        policyReceipt: prepared?.receipt,
        finding,
        affordability: undefined,
        affordabilityAccountId: undefined,
        ranRevision: current.draft.revision,
        reviewedRevision: null,
      });
      setInteriorError(null);
    } catch (error) {
      if (
        preparation.current !== job ||
        JSON.stringify(readFlowState(projectId).interior) !== job.fingerprint
      )
        return;
      setInteriorError(
        controller.signal.aborted
          ? "Jev preparation was canceled or timed out. No assumed run was substituted."
          : error instanceof Error
            ? error.message
            : "Experiment unavailable.",
      );
    } finally {
      clearTimeout(timer);
      if (preparation.current === job) {
        preparation.current = null;
        setInteriorPreparing(false);
      }
    }
  }
  function reviewInterior() {
    const current = readFlowState(projectId).interior;
    if (
      !current ||
      !matching ||
      current.comparisonId !== matching.comparisonId ||
      current.ranRevision !== current.draft.revision
    )
      return;
    flow.setInterior({ ...current, reviewedRevision: current.draft.revision });
  }
  async function acceptAffordability(
    assessment: InteriorAffordabilityAssessment,
    accountId?: string,
  ) {
    const current = readFlowState(projectId).interior;
    if (
      !current ||
      !hasReviewedInterior(current, {
        projectId,
        siteId: current.siteId,
        comparisonId: currentComparisonId.current ?? "",
      })
    )
      return;
    const version = JSON.stringify({
      ...current,
      affordability: undefined,
      affordabilityAccountId: undefined,
    });
    const expected = await interiorAffordabilityFingerprint(
      projectId,
      interiorAffordabilityRequest(current, accountId),
    );
    const latest = readFlowState(projectId).interior;
    if (
      expected !== assessment.fingerprint ||
      !latest ||
      version !==
        JSON.stringify({
          ...latest,
          affordability: undefined,
          affordabilityAccountId: undefined,
        }) ||
      currentComparisonId.current !== current.comparisonId
    )
      return;
    flow.setInterior({
      ...latest,
      affordability: assessment,
      affordabilityAccountId: accountId,
    });
  }
  async function checkAffordability(accountId?: string) {
    const current = readFlowState(projectId).interior;
    if (
      !current ||
      !hasReviewedInterior(current, {
        projectId,
        siteId: current.siteId,
        comparisonId: currentComparisonId.current ?? "",
      })
    )
      return;
    affordabilityJob.current?.abort();
    const controller = new AbortController();
    affordabilityJob.current = controller;
    setAffordabilityPreparing(true);
    setAffordabilityError(null);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const assessment = await fetchInteriorAffordability(
        projectId,
        interiorAffordabilityRequest(current, accountId),
        controller.signal,
      );
      if (!controller.signal.aborted && affordabilityJob.current === controller)
        await acceptAffordability(assessment, accountId);
    } catch (error) {
      if (affordabilityJob.current === controller)
        setAffordabilityError(
          error instanceof Error
            ? error.message
            : "Sandbox affordability unavailable.",
        );
    } finally {
      clearTimeout(timer);
      if (affordabilityJob.current === controller) {
        affordabilityJob.current = null;
        setAffordabilityPreparing(false);
      }
    }
  }
  async function finalize(chosenSiteId: string, rationale?: string) {
    const current = readFlowState(projectId).interior;
    if (
      !matching ||
      !hasReviewedInterior(current, {
        projectId,
        siteId: chosenSiteId,
        comparisonId: matching.comparisonId,
      })
    ) {
      openInterior(chosenSiteId, rationale);
      return;
    }
    setInteriorError(null);
    try {
    const summary = await finalizeWhileCurrent(
      current,
      () =>
        finalizeChosenSite({
          projectId,
          payload: finishedComparison(controller.payload),
          chosenSiteId,
          rationale: rationale ?? current.selectionRationale,
          addresses: Object.fromEntries(
            candidates.map((entry) => [
              entry.candidate.id,
              entry.candidate.address,
            ]),
          ),
          tweaks: readFlowState(projectId).siteTweaks,
          interior: current,
        }),
      () => readFlowState(projectId).interior,
      () => currentComparisonId.current,
    );
    if (!summary) {setInteriorError("The report could not be verified, or the experiment changed while preparing it. Your result is preserved; keep the current result and try again.");return;}
    flow.setFinalPlan(summary);
    goStep("finalize");
    } catch {setInteriorError("Report verification is temporarily unavailable. Your kept experiment is preserved; try Continue to report again.");}
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
    void (async () => {
      for (const effect of effects) await apply(effect);
    })().catch(() =>
      setInteriorError(
        "A workspace action could not be applied. The current experiment is preserved.",
      ),
    );
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
        <div
          className="absolute inset-0"
          style={{
            visibility:
              step === "interior" || step === "finalize" ? "hidden" : "visible",
          }}
          aria-hidden={step === "interior" || step === "finalize"}
        >
          <WorkspaceBackdrop
            city={header.city}
            interior={locations && interior}
            selected={selected}
            tilesetUrl={tilesetUrl}
            candidates={shown}
            onSelect={select}
            cameraRequest={cameraRequest}
          />
        </div>
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
                candidates={candidates}
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

      {interiorError && step !== "interior" && (
        <p
          role="alert"
          className="pointer-events-auto relative z-30 m-3 rounded-lg bg-panel p-3"
        >
          {interiorError}
        </p>
      )}
      {step === "interior" ? (
        interiorCurrent && interiorState ? (
          <SelectedSiteInteriorStage
            interior={interiorState}
            sdkKey={matterportSdkKey}
            onScanContext={receiveScanContext}
            onProposalStatus={receiveProposalStatus}
            awaitingPlacement={Boolean(pendingProposal && interiorState.source?.kind==="scan" && pendingProposal.modelId===interiorState.source.modelId && matchesInteriorScope(interiorState,pendingProposal.action))}
            onUndo={undoInteriorExperiment}
            canUndo={Boolean(interiorState.experimentQuestion)}
            address={
              candidates.find(
                (entry) => entry.candidate.id === interiorState.siteId,
              )?.candidate.address ?? interiorState.siteId
            }
            error={interiorError}
            onResolved={(response, scope) => {
              const current = readFlowState(projectId).interior;
              if (
                !current ||
                current.siteId !== scope.siteId ||
                current.comparisonId !== scope.comparisonId ||
                current.draft.id !== scope.draftId ||
                current.draft.revision !== scope.revision ||
                current.draft.projectId !== scope.projectId
              )
                return;
              try {
                const next = prepareInteriorFlow(current, response);
                if (next !== current) flow.setInterior(next);
              } catch (error) {
                setInteriorError(
                  error instanceof Error
                    ? error.message
                    : "Selected interior could not be prepared",
                );
              }
            }}
            onCommand={editInterior}
            onRun={runInterior}
            preparing={interiorPreparing}
            affordability={interiorState.affordability}
            affordabilityPreparing={affordabilityPreparing}
            affordabilityError={affordabilityError}
            onCheckAffordability={() => void checkAffordability()}
            onReview={reviewInterior}
            onFinalize={() => void finalize(interiorState.siteId)}
            onBack={() => goStep("results")}
          />
        ) : (
          <section className="pointer-events-auto relative z-20 m-4 rounded-xl bg-panel p-5">
            <h2>Interior experiment unavailable</h2>
            <p>Choose a location from the current exterior results to begin.</p>
            <button
              className={styles.primary}
              onClick={() => goStep("results")}
            >
              Return to exterior results
            </button>
          </section>
        )
      ) : (
        <LocationExperience
          key={projectId}
          projectId={projectId}
          controller={controller}
          candidates={candidates}
          shownCount={candidates.length}
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
          presented={Boolean(
            presented?.some((id) => candidateIds.includes(id)),
          )}
          onViewResults={() => {
            flow.reach("results");
            goStep("results");
          }}
          onChooseSite={(id) => openInterior(id)}
          onRerun={() => {
            goStep("compare");
            void controller.run();
          }}
        />
      )}
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
