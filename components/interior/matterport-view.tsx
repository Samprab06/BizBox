"use client";
import {
  watchNativeFloorContext,
  type NativeFloorSdk,
} from "./native-floor-context";
import type { SpatialScanContext } from "@/lib/contracts/spatial";
import { Button } from "@/components/ui/button";

import { useEffect, useMemo, useRef, useState } from "react";
import { spatialScanReplay } from "./spatial-scan-replay";
import {
  watchDefurnishedViews,
  INITIAL_DEFURNISH_STATE,
  type DefurnishSdk,
} from "./matterport-defurnish";
import type { InteriorCalibration } from "@/lib/interior/proposal-state";
import type { SpatialRun } from "@/lib/contracts/spatial";
import type { SpatialDraft } from "@/lib/contracts/spatial";
import { buildInteriorProposal } from "@/lib/interior/proposal-state";
import {
  attachFurnitureScene,
  type FurnitureSceneSdk,
} from "./matterport-furniture";
import type { DayResult } from "@/lib/sim/contracts";
import { interiorFrame } from "../simulator/interior-state";
import { useSceneVisibility } from "../simulator/use-scene-visibility";
import type { ScanPlacement } from "./matterport-scene";
import type { ServiceViewpoint, ShowcaseWindow } from "./matterport-bridge";
import {
  CameraController,
  connectMatterportCamera,
  scanTargets,
  type CameraSdk,
} from "./camera";
import { pickAnchorEnabled, type PointerSdk } from "./pick-anchor";
import PickAnchorPanel from "./pick-anchor-panel";
import {
  createViewerSession,
  failureStatus,
  publicEmbedUrl,
  initialViewerState,
  type ViewerSession,
  type ViewerState,
} from "./matterport-session";

export type MatterportConfig = {
  sdkKey: string;
  modelId: string;
  placement?: ScanPlacement;
  viewpoint?: ServiceViewpoint;
};

export default function MatterportView({
  config,
  run,
  minute,
  employeeCount,
  selected,
  select,
  seek,
  onCamera,
  furnitureProposal,
  proposalCalibration,
  spatialReplay,
  mode = "reference",
  onScanContext,
  onProposalStatus,
}: {
  mode?: "reference" | "selected";
  onScanContext?: (context: SpatialScanContext) => void;
  onProposalStatus?: (state: {
    revision: number;
    status: "loading" | "ready" | "failed";
  }) => void;
  proposalCalibration?: InteriorCalibration;
  spatialReplay?: {
    draft: SpatialDraft;
    run: SpatialRun;
    calibration: InteriorCalibration;
  };
  config: MatterportConfig;
  furnitureProposal?: SpatialDraft;
  run: DayResult;
  minute: number;
  employeeCount?: number;
  selected: string;
  select: (id: string) => void;
  /** The shared playback clock's setter, for the camera bridge's `seek`. */
  seek?: (minute: number) => void;
  /** Receives the agent's camera bridge once the scan connects, and null after. */
  onCamera?: (camera: CameraController | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { hasBeenVisible } = useSceneVisibility(container);
  const [viewer, setViewer] = useState<ViewerState>(initialViewerState);
  const [frameKey, setFrameKey] = useState(0);
  const session = useRef<ViewerSession | null>(null);
  const [layer, setLayer] = useState<"original" | "defurnished" | "proposal">(
    "proposal",
  );
  const [viewEpoch, setViewEpoch] = useState(0);
  const [defurnish, setDefurnish] = useState(INITIAL_DEFURNISH_STATE);
  const viewController = useRef<ReturnType<
    typeof watchDefurnishedViews
  > | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const replay = useMemo(() => {
    if (mode === "selected") {
      if (spatialReplay && layer === "proposal")
        return spatialScanReplay(
          spatialReplay.draft,
          spatialReplay.run,
          minute,
          selected,
        );
      return {
        frame: interiorFrame(run, minute, 0),
        stationCount: 0,
        selected,
        projectedLayout: { people: [], stations: [] },
      };
    }
    return {
      frame: interiorFrame(run, minute, employeeCount),
      stationCount: run.metrics.stations,
      selected,
    };
  }, [run, minute, employeeCount, selected, mode, spatialReplay, layer]);
  const latest = useRef({ replay, select, config, seek, onCamera });
  const camera = useRef<CameraController | null>(null);
  useEffect(() => {
    latest.current = { replay, select, config, seek, onCamera };
    session.current?.update(replay);
    camera.current?.tick();
  }, [replay, select, config, seek, onCamera]);

  useEffect(() => {
    const created = createViewerSession({
      config: () => latest.current.config,
      replay: () => latest.current.replay,
      select: (id) => latest.current.select(id),
      onChange: setViewer,
    });
    session.current = created;
    return () => {
      created.dispose();
      if (session.current === created) session.current = null;
    };
  }, []);

  const { connection, failure, overlay, sdk, focusFailed } = viewer;
  const captureContext = useRef(onScanContext);
  useEffect(() => {
    captureContext.current = onScanContext;
  }, [onScanContext]);
  useEffect(() => {
    if (!sdk || mode !== "selected") return;
    return watchNativeFloorContext(
      sdk as unknown as NativeFloorSdk,
      config.modelId,
      (context) => captureContext.current?.(context),
    );
  }, [sdk, mode, config.modelId]);

  useEffect(() => {
    if (!sdk || mode !== "selected") return;
    const controller = watchDefurnishedViews(
      sdk as unknown as DefurnishSdk,
      setDefurnish,
    );
    viewController.current = controller;
    return () => {
      controller.dispose();
      viewController.current = null;
    };
  }, [sdk, mode]);
  async function switchLayer(next: "original" | "defurnished" | "proposal") {
    try {
      const target =
        next === "proposal"
          ? defurnish.availability === "available"
            ? "defurnished"
            : "original"
          : next;
      if (target === "defurnished" || defurnish.originalAvailable)
        await viewController.current?.activate(target);
      setLayer(next);
      setViewError(null);
      setViewEpoch((value) => value + 1);
      session.current?.retryOverlay();
    } catch (error) {
      setViewError(
        error instanceof Error ? error.message : "View switch failed",
      );
    }
  }
  // HAC-139 camera bridge. The session resets `sdk` to null on every teardown
  // (reconnect, retry, failure, unmount), so the bridge never outlives its SDK.
  useEffect(() => {
    if (!sdk) return;
    const bridge = connectMatterportCamera(sdk as CameraSdk, {
      seek: (minute) => {
        const setMinute = latest.current.seek;
        if (!setMinute) throw new Error("Shared playback unavailable");
        setMinute(minute);
      },
      onFounderInput: () => controller.founderInput(),
    });
    const motion =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const controller = new CameraController(bridge.port, {
      targets: () => {
        const placement = latest.current.config.placement;
        return placement
          ? scanTargets(latest.current.replay, placement)
          : { stations: [], agents: new Map() };
      },
      reducedMotion: () => motion?.matches ?? false,
    });
    camera.current = controller;
    latest.current.onCamera?.(controller);
    // Scrubbing shared playback is founder input too; agent seeks fire no input event.
    const scrub = (event: Event) => {
      if (
        event.isTrusted &&
        event.target instanceof HTMLInputElement &&
        event.target.type === "range"
      )
        controller.founderInput();
    };
    document.addEventListener("input", scrub, true);
    return () => {
      document.removeEventListener("input", scrub, true);
      controller.dispose();
      try {
        bridge.dispose();
      } catch {
        // The session may already have disconnected this SDK.
      }
      camera.current = null;
      latest.current.onCamera?.(null);
    };
  }, [sdk]);
  const proposal = useMemo(
    () =>
      furnitureProposal &&
      config.placement &&
      (mode !== "selected" || (proposalCalibration && layer === "proposal"))
        ? buildInteriorProposal(
            furnitureProposal,
            proposalCalibration ?? {
              modelId: config.modelId,
              origin: config.placement.origin,
              rotationY: config.placement.rotationY,
              roomAnchor: furnitureProposal.servicePoint,
              source: "illustrative-reference",
            },
          )
        : null,
    [
      furnitureProposal,
      config.modelId,
      config.placement,
      proposalCalibration,
      mode,
      layer,
    ],
  );
  const [furnitureState, setFurnitureState] = useState<{
    revision: number;
    status: "loaded" | "failed";
    sdk: typeof sdk;
    scope: string | null;
  } | null>(null);
  type FurnitureBridge = Awaited<ReturnType<typeof attachFurnitureScene>>;
  const furnitureBridge = useRef<FurnitureBridge | null>(null);
  const desiredProposal = useRef(proposal);
  useEffect(() => {
    desiredProposal.current = proposal;
  }, [proposal]);
  const furnitureScope = proposal
    ? `${proposal.projectId}:${proposal.siteId}:${proposal.draftId}:${proposal.calibration.modelId}:${viewEpoch}`
    : null;
  useEffect(() => {
    const initial = desiredProposal.current;
    if (!sdk || !initial) return;
    const controller = new AbortController();
    let local: FurnitureBridge | null = null;
    void attachFurnitureScene(
      sdk as unknown as FurnitureSceneSdk,
      initial,
      controller.signal,
    )
      .then(async (bridge) => {
        if (controller.signal.aborted) {
          bridge.dispose();
          return;
        }
        local = bridge;
        furnitureBridge.current = bridge;
        const current = desiredProposal.current;
        if (current && current !== initial) await bridge.update(current);
        if (
          !controller.signal.aborted &&
          current &&
          desiredProposal.current === current
        )
          setFurnitureState({
            revision: current.revision,
            status: "loaded",
            sdk,
            scope: furnitureScope,
          });
      })
      .catch(() => {
        const current = desiredProposal.current;
        if (!controller.signal.aborted && current)
          setFurnitureState({
            revision: current.revision,
            status: "failed",
            sdk,
            scope: furnitureScope,
          });
      });
    return () => {
      controller.abort();
      local?.dispose();
      if (furnitureBridge.current === local) furnitureBridge.current = null;
    };
  }, [sdk, furnitureScope]);
  useEffect(() => {
    const bridge = furnitureBridge.current;
    if (!bridge || !proposal) return;
    const requested = proposal;
    void bridge
      .update(requested)
      .then(() => {
        if (
          furnitureBridge.current !== bridge ||
          desiredProposal.current !== requested
        )
          return;
        setFurnitureState({
          revision: requested.revision,
          status: "loaded",
          sdk,
          scope: furnitureScope,
        });
      })
      .catch(() => {
        if (
          furnitureBridge.current === bridge &&
          desiredProposal.current === requested
        )
          setFurnitureState({
            revision: requested.revision,
            status: "failed",
            sdk,
            scope: furnitureScope,
          });
      });
  }, [proposal, sdk, furnitureScope]);
  const proposalStatusCallback = useRef(onProposalStatus);
  useEffect(() => {
    proposalStatusCallback.current = onProposalStatus;
  }, [onProposalStatus]);
  const nativeStatus =
    connection === "failed"
      ? "failed"
      : proposal &&
          sdk &&
          furnitureState?.sdk === sdk &&
          furnitureState.scope === furnitureScope &&
          furnitureState.revision === proposal.revision
        ? furnitureState.status === "loaded"
          ? "ready"
          : "failed"
        : "loading";
  const proposalRevision = proposal?.revision;
  useEffect(() => {
    if (mode === "selected" && proposalRevision !== undefined)
      proposalStatusCallback.current?.({
        revision: proposalRevision,
        status: nativeStatus,
      });
  }, [mode, proposalRevision, nativeStatus, furnitureScope]);
  const failed = connection === "failed";
  // Never leave a blank or broken frame: fall back to the keyless embed, or
  // to a labelled placeholder when the model itself is unavailable.
  const embed = failed && failure !== "model";
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const localhostUrl =
    host === "127.0.0.1"
      ? window.location.href.replace("127.0.0.1", "localhost")
      : null;
  const params = new URLSearchParams({
    m: config.modelId,
    applicationKey: config.sdkKey,
    play: "1",
    qs: "1",
  });
  const status =
    mode === "selected"
      ? failed
        ? "This interior could not be opened. Retry below."
        : !sdk
          ? "Opening interior…"
          : overlay === "failed"
            ? "The proposal could not be displayed. Retry below."
            : ""
      : failed
        ? failureStatus(failure, host)
        : !sdk
          ? "Connecting to the Matterport café…"
          : !config.placement
            ? "Scanned interior connected. This scan has no placement calibration, so the simulation overlay uses Modeled layout."
            : overlay === "failed"
              ? "The scan connected, but simulation dots could not start. Retry the dots or choose Modeled layout to inspect the replay."
              : overlay === "ready"
                ? "Scanned interior connected · simulation dots active."
                : "Scanned interior connected. Starting simulation dots…";
  const button =
    "min-h-11 rounded-full border border-glass-edge px-4 text-sm text-muted hover:bg-field";
  return (
    <div
      ref={container}
      className="mt-4 overflow-hidden rounded-2xl border border-glass-edge bg-panel-raised"
      aria-label="Scanned simulation"
      data-sdk-state={connection}
      data-furniture-state={proposal ? nativeStatus : "none"}
      data-proposed-items={proposal?.items.length ?? 0}
    >
      <div
        hidden={mode === "selected"}
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted"
      >
        <span>
          {mode === "selected"
            ? "Selected-space scan"
            : embed
              ? "Plain public embed · public café reference"
              : "Scanned interior · public café reference"}
        </span>
        <span>
          {run.metrics.stations} proposed staffed{" "}
          {run.metrics.stations === 1 ? "counter" : "counters"}
        </span>
      </div>
      {mode === "selected" && defurnish.availability === "available" && (
        <div className="mx-4 mb-3 text-xs">
          <div className="flex gap-2">
            {(["original", "defurnished", "proposal"] as const).map((value) => (
              <button
                key={value}
                className={button}
                aria-pressed={layer === value}
                disabled={
                  !sdk ||
                  (value === "defurnished" &&
                    defurnish.availability !== "available")
                }
                onClick={() => void switchLayer(value)}
              >
                {value === "original"
                  ? "Original"
                  : value === "defurnished"
                    ? "Defurnished"
                    : "Proposal"}
              </button>
            ))}
          </div>
          <p role="status">{viewError}</p>
        </div>
      )}
      <div className="mx-4 mb-3 flex flex-wrap gap-2">
        {mode !== "selected" && sdk && config.viewpoint && (
          <Button
            variant="quiet"
            type="button"
            onClick={() => {
              camera.current?.founderInput();
              void session.current?.focus();
            }}
            className={button}
          >
            Show service area
          </Button>
        )}
        {sdk && config.placement && overlay === "failed" && (
          <Button
            variant="quiet"
            type="button"
            onClick={() => session.current?.retryOverlay()}
            className={button}
          >
            Retry simulation dots
          </Button>
        )}
        {failed && (
          <Button
            variant="quiet"
            type="button"
            onClick={() => {
              session.current?.restart();
              setFrameKey((key) => key + 1);
            }}
            className={button}
          >
            Retry scanned interior
          </Button>
        )}
      </div>
      {mode !== "selected" && furnitureProposal && (
        <p
          role="status"
          data-furniture-overlay
          className="mx-4 mb-3 text-xs text-muted"
        >
          {!furnitureProposal.items.length
            ? "No proposed furniture. Captured scan furniture remains visible."
            : !sdk
              ? "Furniture proposal waits for the SDK connection."
              : furnitureState?.revision === furnitureProposal.revision &&
                  furnitureState.status === "failed"
                ? "Furniture overlay could not start. The modeled proposal remains available."
                : furnitureState?.revision === furnitureProposal.revision
                  ? `${furnitureProposal.items.length} proposed furniture models loaded.`
                  : "Starting proposed furniture…"}{" "}
          Placement is illustrative within the reference café, not verified
          selected-unit geometry. Clearing removes proposed objects only.
        </p>
      )}
      {sdk && pickAnchorEnabled() && "Pointer" in sdk && (
        <PickAnchorPanel sdk={sdk as unknown as PointerSdk} />
      )}
      {focusFailed && (
        <p className="px-4 pb-3 text-xs text-muted">
          The service-area view could not be restored. You can still navigate
          the scan manually.
        </p>
      )}
      <p
        role="status"
        data-overlay-status={overlay}
        data-viewer-status={connection}
        data-viewer-failure={failure}
        className="px-4 pb-3 text-sm text-muted"
      >
        {status}
        {failed && localhostUrl && (
          <>
            {" "}
            <a href={localhostUrl} className="underline">
              Open this demo on localhost
            </a>{" "}
            to use the configured SDK domain.
          </>
        )}
      </p>
      {hasBeenVisible &&
        (embed ? (
          <iframe
            key="public-embed"
            title={
              mode === "selected"
                ? "Selected Matterport interior (plain embed)"
                : "Matterport café interior (plain public embed)"
            }
            src={publicEmbedUrl(config.modelId)}
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            className="h-96 w-full border-0 sm:h-[32rem]"
          />
        ) : failed ? (
          <div className="flex h-96 items-center justify-center px-6 text-center text-sm text-muted sm:h-[32rem]">
            Scanned interior unavailable. The modeled replay is unaffected.
          </div>
        ) : (
          <iframe
            key={`sdk-${frameKey}`}
            title={
              mode === "selected"
                ? "Selected Matterport interior"
                : "Matterport café interior"
            }
            src={`/matterport/showcase.html?${params}`}
            onLoad={(event) => {
              const target = event.currentTarget
                .contentWindow as ShowcaseWindow | null;
              void session.current?.connect(target);
            }}
            allow="fullscreen; xr-spatial-tracking"
            allowFullScreen
            className="h-96 w-full border-0 sm:h-[32rem]"
          />
        ))}
      <p
        hidden={mode === "selected"}
        className="px-4 py-3 text-xs leading-relaxed text-muted"
      >
        Blue customer dots and purple employee dots are simulated. Translucent
        counter markers are proposed overlays; captured furniture stays
        {mode === "selected"
          ? "visible in the original scan. Existing defurnished views are available only when the provider returns one for this model."
          : "unchanged. This public scan is a visual reference, not the selected Houston property."}
      </p>
    </div>
  );
}
