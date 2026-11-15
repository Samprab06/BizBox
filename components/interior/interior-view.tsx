"use client";
import { Card } from "@/components/ui/card";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DayResult } from "@/lib/sim/contracts";
import {
  layoutFromDimensions,
  modeledLayout,
  type EntranceWall,
} from "@/lib/sim/interior-layout";
import { SimulatorViewport } from "../simulator/viewport";
import type { CameraController } from "./camera";
import type { ServiceViewpoint } from "./matterport-bridge";
import type { ScanPlacement } from "./matterport-scene";
import { interiorFrameAt, type InteriorAgent } from "./interior-replay";
import {
  fetchInterior,
  interiorDisplay,
  type InteriorLoad,
} from "./interior-source";

const LayoutScene = dynamic(() => import("./layout-scene"), { ssr: false });
const MatterportView = dynamic(() => import("./matterport-view"), {
  ssr: false,
});

const stateLabels: Record<InteriorAgent["state"], string> = {
  entering: "Entering",
  in_line: "In line",
  at_station: "At a station",
  leaving: "Leaving",
  staffing: "Staffing a station",
};

/** Loads SIM-12's interior for a site, unless the caller already has it. */
export function useInterior(
  siteId: string | undefined,
  preloaded?: InteriorLoad,
) {
  const [state, setState] = useState<{ siteId?: string; load: InteriorLoad }>({
    load: { status: "loading" },
  });
  useEffect(() => {
    if (preloaded || !siteId) return;
    const controller = new AbortController();
    fetchInterior(siteId, fetch, controller.signal)
      .then((load) => setState({ siteId, load }))
      .catch(() => {
        /* Aborted on unmount or site change. */
      });
    return () => controller.abort();
  }, [siteId, preloaded]);
  if (preloaded) return preloaded;
  if (!siteId) return { status: "not_found" } as const;
  return state.siteId === siteId
    ? state.load
    : ({ status: "loading" } as const);
}

/**
 * SIM-13: the selected run inside the selected space. It reads the shared playback
 * minute and selection from its caller (the same clock as the city view) and holds
 * no playback state of its own, so switching between city and interior keeps the
 * time and the selected customer. Counts come from `replayAt`.
 */
export function InteriorView({
  siteId,
  interior,
  sdkKey,
  run,
  minute,
  employeeCount,
  selected,
  select,
  seek,
  onCamera,
  scan,
  entranceWall,
}: {
  /** The selected site; its interior is read from `/api/sites/[siteId]/interior`. */
  siteId?: string;
  /** An interior already resolved by the caller (skips the request). */
  interior?: InteriorLoad;
  /** Domain-restricted, client-permitted Showcase SDK key, when the response has none. */
  sdkKey?: string;
  run: DayResult;
  minute: number;
  employeeCount?: number;
  selected: string;
  select: (id: string) => void;
  seek?: (minute: number) => void;
  onCamera?: (camera: CameraController | null) => void;
  /** Calibrated scan overlay placement (HAC-138); without it the scan shows no dots. */
  scan?: { placement?: ScanPlacement; viewpoint?: ServiceViewpoint };
  /** Calibrated entrance wall for room-bounds layouts; otherwise it is labelled assumed. */
  entranceWall?: EntranceWall;
}) {
  const load = useInterior(siteId, interior);
  const display = interiorDisplay(load, { sdkKey });
  const [floorPlanFailed, setFloorPlanFailed] = useState<string | null>(null);
  const stations = run.metrics.stations;
  const layout = useMemo(
    () =>
      layoutFromDimensions(display.dimensions, stations, { entranceWall }) ??
      modeledLayout(stations),
    [display.dimensions, stations, entranceWall],
  );
  const frame = useMemo(
    () => interiorFrameAt(run, minute, layout, employeeCount),
    [run, minute, layout, employeeCount],
  );
  const onFloorPlanFailed = useCallback(
    () => setFloorPlanFailed(display.floorPlanUri ?? null),
    [display.floorPlanUri],
  );
  const chosen = frame.agents.find((agent) => agent.id === selected);
  const visit = frame.arrivals.get(selected);
  const counts = frame.counts;
  const notes = [
    display.fallbackReason,
    display.provenance?.description,
    ...(display.provenance?.limitations ?? []),
    ...(display.kind === "scan" ? [] : layout.limitations),
    display.kind === "floorplan"
      ? "The listing floor plan is drawn as a ground image under the modeled layout. It is not to scale and no geometry is derived from it."
      : null,
    display.kind === "floorplan" && floorPlanFailed === display.floorPlanUri
      ? "The floor plan image could not be loaded; the modeled floor is shown instead."
      : null,
  ].filter((note): note is string => !!note);

  return (
    <Card
      role="region"
      aria-label="Interior view"
      data-interior-source={display.kind}
      className="space-y-3 rounded-2xl border border-glass-edge bg-panel-raised p-4 text-ink"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p
          data-interior-label
          className="rounded-full border border-indigo-300/40 bg-indigo-400/15 px-3 py-1 text-xs font-medium text-indigo-100"
        >
          <span className="sr-only">Interior source: </span>
          {display.label}
        </p>
        <span className="text-xs text-muted">
          {stations} {stations === 1 ? "station" : "stations"} · simulated
          customers, not observed traffic
        </span>
      </header>

      <div role="group" aria-label="Interior counts">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ["In line", counts.inLine],
              ["In service", counts.inService],
              ["Served", counts.served],
              ["Left", counts.left],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-field px-3 py-2">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {display.kind === "scan" && display.modelId && display.sdkKey ? (
        <MatterportView
          config={{
            sdkKey: display.sdkKey,
            modelId: display.modelId,
            placement: scan?.placement,
            viewpoint: scan?.viewpoint,
          }}
          run={run}
          minute={minute}
          employeeCount={employeeCount}
          selected={selected}
          select={select}
          seek={seek}
          onCamera={onCamera}
        />
      ) : (
        <SimulatorViewport label={`${display.label} room`} className="h-80">
          <LayoutScene
            layout={layout}
            agents={frame.agents}
            selected={selected}
            select={select}
            floorPlanUri={
              display.kind === "floorplan" ? display.floorPlanUri : undefined
            }
            onFloorPlanFailed={onFloorPlanFailed}
          />
        </SimulatorViewport>
      )}

      {display.kind !== "scan" && (
        <ul
          aria-label="Layout markers"
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
        >
          <li>
            <span aria-hidden className="text-amber-300">
              ●
            </span>{" "}
            Entrance
          </li>
          <li>Counter</li>
          {layout.stations.map((_, index) => (
            <li key={index}>Station {index + 1}</li>
          ))}
          <li>Queue path</li>
        </ul>
      )}

      <p
        role="status"
        aria-label="Interior inspection"
        className="text-sm text-muted"
      >
        {selected
          ? chosen
            ? `${selected}: ${stateLabels[chosen.state]}${
                chosen.station !== undefined && chosen.role === "customer"
                  ? ` (station ${chosen.station + 1})`
                  : ""
              }`
            : visit
              ? `${selected}: not inside at this minute`
              : `${selected}: has not arrived yet`
          : "Select a customer to inspect them."}
      </p>
      {frame.overflow > 0 && (
        <p className="text-xs text-amber-200">
          {frame.overflow} more in line than the drawn line holds; they are
          shown past the line&apos;s end.
        </p>
      )}
      {notes.length > 0 && (
        <ul
          aria-label="Interior source notes"
          className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted"
        >
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
