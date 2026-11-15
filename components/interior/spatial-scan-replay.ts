import type { SpatialDraft, SpatialRun } from "@/lib/contracts/spatial";
import type { DayResult } from "@/lib/sim/contracts";
import { interiorFrame } from "../simulator/interior-state";
import {
  motionPointAlong,
  projectCustomerMotion,
  projectEmployeeMotion,
  type CustomerMotionGeometry,
} from "../simulator/customer-motion";
import type { ScanReplay } from "./matterport-scene";
const cache = new WeakMap<
  SpatialRun,
  { draft: SpatialDraft; day: DayResult; geometry: CustomerMotionGeometry }
>();
function prepared(draft: SpatialDraft, run: SpatialRun) {
  const existing = cache.get(run);
  if (existing?.draft === draft) return existing;
  const route = run.customers[0]?.route ?? [draft.entrance, draft.servicePoint],
    reverse = [...route].reverse();
  const distance = route
    .slice(1)
    .reduce(
      (sum, p, index) =>
        sum + Math.hypot(p.x - route[index]!.x, p.z - route[index]!.z),
      0,
    );
  const clamp = (point: { x: number; z: number }) => ({
    x: Math.max(0.2, Math.min(draft.room.widthM - 0.2, point.x)),
    z: Math.max(0.2, Math.min(draft.room.depthM - 0.2, point.z)),
  });
  const stationPoint = (index: number) =>
    clamp({
      x: draft.servicePoint.x + (index - (run.metrics.stations - 1) / 2) * 0.65,
      z: draft.servicePoint.z,
    });
  const geometry: CustomerMotionGeometry = {
    entrance: route.at(-1)!,
    outsideApproach: route[0]!,
    outsideExit: route[0]!,
    approachVia: route.slice(1, -1),
    exitVia: reverse.slice(1, -1),
    queueSlot: (index) =>
      motionPointAlong(
        reverse,
        distance ? Math.min(1, (index * 0.7) / distance) : 0,
      ),
    stationPoint,
    staffPoint: (index) =>
      clamp({ ...stationPoint(index), z: draft.servicePoint.z + 0.5 }),
  };
  const value = {
    draft,
    day: {
      siteId: draft.siteId,
      seed: run.seed,
      events: run.events,
      metrics: run.metrics,
    },
    geometry,
  };
  cache.set(run, value);
  return value;
}
/** Geometry comes only from this selected scenario/run. Rendering stretches travel for readability. */
export function spatialScanReplay(
  draft: SpatialDraft,
  run: SpatialRun,
  minute: number,
  selected: string,
): ScanReplay {
  const { day, geometry } = prepared(draft, run);
  const customers = projectCustomerMotion(day, minute, geometry),
    employees = projectEmployeeMotion(
      day,
      minute,
      draft.settings.staff,
      geometry,
    );
  return {
    frame: interiorFrame(day, minute, draft.settings.staff),
    stationCount: run.metrics.stations,
    selected,
    projectedLayout: {
      people: [
        ...customers.map((dot) => ({ ...dot, role: "customer" as const })),
        ...employees.map((dot) => ({ ...dot, role: "employee" as const })),
      ],
      stations: Array.from({ length: run.metrics.stations }, (_, index) =>
        geometry.stationPoint(index),
      ),
    },
  };
}
