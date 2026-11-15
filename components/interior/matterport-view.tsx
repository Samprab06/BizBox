"use client";
import { Button } from "@/components/ui/button";

import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  config: MatterportConfig;
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
  const replay = useMemo(
    () => ({
      frame: interiorFrame(run, minute, employeeCount),
      stationCount: run.metrics.stations,
      selected,
    }),
    [run, minute, employeeCount, selected],
  );
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
  const status = failed
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
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
        <span>
          {embed
            ? "Plain public embed · public café reference"
            : "Scanned interior · public café reference"}
        </span>
        <span>
          {run.metrics.stations} proposed staffed{" "}
          {run.metrics.stations === 1 ? "counter" : "counters"}
        </span>
      </div>
      <div className="mx-4 mb-3 flex flex-wrap gap-2">
        {sdk && config.viewpoint && (
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
            title="Matterport café interior (plain public embed)"
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
            title="Matterport café interior"
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
      <p className="px-4 py-3 text-xs leading-relaxed text-muted">
        Blue customer dots and purple employee dots are simulated. Translucent
        counter markers are proposed overlays; captured furniture stays
        unchanged. This public scan is a visual reference, not the selected
        Houston property.
      </p>
    </div>
  );
}
