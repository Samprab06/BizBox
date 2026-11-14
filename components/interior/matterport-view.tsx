"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DayResult } from "@/lib/sim/contracts";
import { interiorFrame } from "../simulator/interior-state";
import { useSceneVisibility } from "../simulator/use-scene-visibility";
import { attachReplayScene, type ScanPlacement } from "./matterport-scene";
import {
  waitForPlaying,
  connectShowcase,
  focusServiceArea,
  type ServiceViewpoint,
  type MatterportSdk,
  type ShowcaseWindow,
} from "./matterport-bridge";
import {
  CameraController,
  connectMatterportCamera,
  scanTargets,
  type CameraSdk,
} from "./camera";

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
  const [sdk, setSdk] = useState<MatterportSdk | null>(null);
  const [connection, setConnection] = useState<"connecting" | "failed">(
    "connecting",
  );
  const [focusFailed, setFocusFailed] = useState(false);
  const [overlay, setOverlay] = useState<"pending" | "ready" | "failed">(
    "pending",
  );
  const controller = useRef<AbortController | null>(null);
  const session = useRef<Awaited<ReturnType<typeof attachReplayScene>> | null>(
    null,
  );
  const replay = useMemo(
    () => ({
      frame: interiorFrame(run, minute, employeeCount),
      stationCount: run.metrics.stations,
      selected,
    }),
    [run, minute, employeeCount, selected],
  );
  const latest = useRef({ replay, select, seek, onCamera });
  const camera = useRef<CameraController | null>(null);
  useEffect(() => {
    latest.current = { replay, select, seek, onCamera };
    session.current?.update(replay, config.placement);
    camera.current?.tick();
  }, [replay, select, seek, onCamera, config.placement]);

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
      targets: () =>
        config.placement
          ? scanTargets(latest.current.replay, config.placement)
          : { stations: [], agents: new Map() },
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
      bridge.dispose();
      camera.current = null;
      latest.current.onCamera?.(null);
    };
  }, [sdk, config.placement]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!sdk || !config.placement) return;
    let disposed = false;
    const attempt = new AbortController();
    let layer: Awaited<ReturnType<typeof attachReplayScene>> | null = null;
    void attachReplayScene(
      sdk,
      config.placement,
      latest.current.replay,
      (id) => latest.current.select(id),
      attempt.signal,
    )
      .then((created) => {
        if (disposed) {
          created.dispose();
          return;
        }
        layer = created;
        session.current = created;
        created.update(latest.current.replay);
        setOverlay("ready");
      })
      .catch(() => {
        if (!disposed) setOverlay("failed");
      });
    return () => {
      disposed = true;
      attempt.abort();
      layer?.dispose();
      session.current = null;
    };
  }, [sdk, config.placement]);

  async function connect(frame: HTMLIFrameElement) {
    controller.current?.abort();
    setSdk(null);
    setConnection("connecting");
    setOverlay("pending");
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      const target = frame.contentWindow as ShowcaseWindow | null;
      if (!target) throw new Error("Viewer SDK unavailable");
      const connected = await connectShowcase(target, attempt.signal);
      await waitForPlaying(connected, attempt.signal);
      if (attempt.signal.aborted) return;
      if (config.viewpoint) await focusServiceArea(connected, config.viewpoint);
      if (!attempt.signal.aborted) setSdk(connected);
    } catch {
      if (!attempt.signal.aborted) setConnection("failed");
    }
  }
  const localhostUrl =
    typeof window !== "undefined" && window.location.hostname === "127.0.0.1"
      ? window.location.href.replace("127.0.0.1", "localhost")
      : null;
  const params = new URLSearchParams({
    m: config.modelId,
    applicationKey: config.sdkKey,
    play: "1",
    qs: "1",
  });
  const status =
    connection === "failed"
      ? "Unable to connect to the scanned interior. Check the SDK key's allowed domain and model access, or choose Modeled layout."
      : !sdk
        ? "Connecting to the Matterport café…"
        : !config.placement
          ? "Scanned interior connected. Simulation overlay is awaiting placement calibration."
          : overlay === "failed"
            ? "The scan connected, but simulation dots could not start. Choose Modeled layout to inspect the replay."
            : overlay === "ready"
              ? "Scanned interior connected · simulation dots active."
              : "Scanned interior connected. Starting simulation dots…";
  return (
    <div
      ref={container}
      className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/30"
      aria-label="Scanned simulation"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-white/65">
        <span>Scanned interior · public café reference</span>
        <span>
          {run.metrics.stations} proposed staffed{" "}
          {run.metrics.stations === 1 ? "counter" : "counters"}
        </span>
      </div>
      {sdk && config.viewpoint && (
        <button
          type="button"
          onClick={() => {
            setFocusFailed(false);
            camera.current?.founderInput();
            void focusServiceArea(sdk, config.viewpoint!).catch(() =>
              setFocusFailed(true),
            );
          }}
          className="mx-4 mb-3 min-h-11 rounded-full border border-white/20 px-4 text-sm text-white/80 hover:bg-white/10"
        >
          Show service area
        </button>
      )}
      {focusFailed && (
        <p className="px-4 pb-3 text-xs text-white/65">
          The service-area view could not be restored. You can still navigate
          the scan manually.
        </p>
      )}
      <p
        role="status"
        data-overlay-status={overlay}
        className="px-4 pb-3 text-sm text-white/75"
      >
        {status}
        {connection === "failed" && localhostUrl && (
          <>
            {" "}
            <a href={localhostUrl} className="underline">
              Open this demo on localhost
            </a>{" "}
            to use the configured SDK domain.
          </>
        )}
      </p>
      {hasBeenVisible && (
        <iframe
          title="Matterport café interior"
          src={`/matterport/showcase.html?${params}`}
          onLoad={(event) => {
            void connect(event.currentTarget);
          }}
          allow="fullscreen; xr-spatial-tracking"
          allowFullScreen
          className="h-96 w-full border-0 sm:h-[32rem]"
        />
      )}
      <p className="px-4 py-3 text-xs leading-relaxed text-white/55">
        Blue customer dots and purple employee dots are simulated. Translucent
        mint counter markers are proposed overlays; captured furniture stays
        unchanged. This public scan is a visual reference, not the selected
        Houston property.
      </p>
    </div>
  );
}
