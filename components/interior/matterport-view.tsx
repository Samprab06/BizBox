"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayResult } from "@/lib/sim/contracts";
import { interiorFrame } from "../simulator/interior-state";
import { useSceneVisibility } from "../simulator/use-scene-visibility";
import type { ScanPlacement } from "./matterport-scene";
import type { ServiceViewpoint, ShowcaseWindow } from "./matterport-bridge";
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
}: {
  config: MatterportConfig;
  run: DayResult;
  minute: number;
  employeeCount?: number;
  selected: string;
  select: (id: string) => void;
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
  const latest = useRef({ replay, select, config });
  useEffect(() => {
    latest.current = { replay, select, config };
    session.current?.update(replay);
  }, [replay, select, config]);

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
        ? "Scanned interior connected. Simulation overlay is awaiting placement calibration."
        : overlay === "failed"
          ? "The scan connected, but simulation dots could not start. Retry the dots or choose Modeled layout to inspect the replay."
          : overlay === "ready"
            ? "Scanned interior connected · simulation dots active."
            : "Scanned interior connected. Starting simulation dots…";
  const button =
    "min-h-11 rounded-full border border-white/20 px-4 text-sm text-white/80 hover:bg-white/10";
  return (
    <div
      ref={container}
      className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30"
      aria-label="Scanned simulation"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-white/65">
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
          <button
            type="button"
            onClick={() => void session.current?.focus()}
            className={button}
          >
            Show service area
          </button>
        )}
        {sdk && config.placement && overlay === "failed" && (
          <button
            type="button"
            onClick={() => session.current?.retryOverlay()}
            className={button}
          >
            Retry simulation dots
          </button>
        )}
        {failed && (
          <button
            type="button"
            onClick={() => {
              session.current?.restart();
              setFrameKey((key) => key + 1);
            }}
            className={button}
          >
            Retry scanned interior
          </button>
        )}
      </div>
      {focusFailed && (
        <p className="px-4 pb-3 text-xs text-white/65">
          The service-area view could not be restored. You can still navigate
          the scan manually.
        </p>
      )}
      <p
        role="status"
        data-overlay-status={overlay}
        data-viewer-status={connection}
        data-viewer-failure={failure}
        className="px-4 pb-3 text-sm text-white/75"
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
          <div className="flex h-96 items-center justify-center px-6 text-center text-sm text-white/65 sm:h-[32rem]">
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
      <p className="px-4 py-3 text-xs leading-relaxed text-white/55">
        Blue customer dots and purple employee dots are simulated. Translucent
        mint counter markers are proposed overlays; captured furniture stays
        unchanged. This public scan is a visual reference, not the selected
        Houston property.
      </p>
    </div>
  );
}
