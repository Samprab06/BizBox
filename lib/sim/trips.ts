/** Deterministic, approximate customer trips; no road-network or source-data lookup (HAC-75). */
import type { Persona } from "../panel/contracts";
import type { ArrivalSchedule, DayResult, SimEvent } from "./contracts";
import { createRng, type Rng } from "./random";

export type Position = readonly [lng: number, lat: number];
type Segment = readonly [Position, Position];
type PolygonCoordinates = readonly (readonly Position[])[];
export type BlockGroupGeometry =
  | { type: "Polygon"; coordinates: PolygonCoordinates }
  | { type: "MultiPolygon"; coordinates: readonly PolygonCoordinates[] };

/** Provenance describes the supplied input, not verification of an observed geography. */
export type TripGeometry<T> = {
  value: T;
  provenance: "provided" | "assumed";
  source: string;
};

/** Explicit adapter: existing persona locations are already jittered, not source geometry. */
export type TripPersona = Pick<Persona, "id" | "commuteMode"> &
  (
    | { kind: "resident"; blockGroup: TripGeometry<BlockGroupGeometry> }
    | {
        kind: "worker";
        workplace: TripGeometry<Position>;
        jitterMeters: number;
      }
    | { kind: "passby" }
  );

export type TripSite = {
  id: string;
  door: TripGeometry<Position>;
  /** Clockwise from north, defining the first axis of the approximate street grid. */
  streetBearingDeg: TripGeometry<number>;
  /** Required for passby customers; segment direction defines their approach/departure. */
  frontage?: TripGeometry<Segment>;
  /** Required for drivers; nearest means metric projection onto these supplied segments. */
  arterials?: TripGeometry<readonly Segment[]>;
  /** Explicit assumptions for modes without ticket-defined speeds. Walk=80, drive=400. */
  modeSpeeds?: Partial<Record<"transit" | "bike", number>>;
};

type GeometrySource = Pick<TripGeometry<unknown>, "provenance" | "source"> & {
  role: "door" | "bearing" | "origin" | "frontage" | "arterial";
};

export type AgentTrip = {
  customerId: string;
  personaId: string;
  kind: Persona["kind"];
  mode: Persona["commuteMode"];
  /** Actual sampled origin, which can be offscreen for drivers. */
  origin: [number, number];
  path: [number, number][];
  /** Minutes since local midnight; may start negative and depart after midnight. */
  timestamps: number[];
  outcome: "served" | "balked" | "reneged" | "open";
  originDepartureMin: number;
  visibleEntryMin: number;
  doorArrivalIndex: number;
  /** Door vertex at terminal event, or null for customers still waiting/in service at close. */
  departureIndex: number | null;
  geometry: {
    approximation: "local_rotated_grid";
    sources: GeometrySource[];
    speedMetersPerMin: number;
    workerJitterMeters?: number;
    /** Origin-to-visible-entry grid travel; zero for non-driving modes. */
    offscreenInboundMinutes: number;
    /** Non-passby drivers return via their arterial entry; return to origin is offscreen. */
    offscreenReturnMinutes: number;
  };
};

type XY = [number, number];
const METERS_PER_DEGREE = 111320;
const SAMPLE_ATTEMPTS = 10000;
const copy = (point: Position): XY => [point[0], point[1]];
const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
const distance = (a: Position, b: Position) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

function point(point: Position): void {
  if (
    !Array.isArray(point) ||
    point.length !== 2 ||
    !Number.isFinite(point[0]) ||
    !Number.isFinite(point[1]) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) >= 85
  ) {
    throw new RangeError(
      "Trip coordinates require finite local longitude/latitude below polar latitudes",
    );
  }
}

function source<T>(
  input: TripGeometry<T>,
  role: GeometrySource["role"],
): GeometrySource {
  if (
    !input ||
    !["provided", "assumed"].includes(input.provenance) ||
    !input.source?.trim()
  ) {
    throw new RangeError(`Missing ${role} geometry provenance/source`);
  }
  return { role, provenance: input.provenance, source: input.source };
}

function segment(segment: Segment): void {
  if (!Array.isArray(segment) || segment.length !== 2)
    throw new RangeError("Invalid street segment");
  segment.forEach(point);
  if (same(segment[0], segment[1]))
    throw new RangeError("Street segment must have positive length");
}

function inRing(p: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

const cross = (a: Position, b: Position, c: Position) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function intersects(
  a: Position,
  b: Position,
  c: Position,
  d: Position,
): boolean {
  const on = (p: Position, q: Position, r: Position) =>
    cross(p, q, r) === 0 &&
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1]);
  const x = cross(a, b, c),
    y = cross(a, b, d),
    z = cross(c, d, a),
    w = cross(c, d, b);
  return (
    (x * y < 0 && z * w < 0) ||
    on(a, b, c) ||
    on(a, b, d) ||
    on(c, d, a) ||
    on(c, d, b)
  );
}

function validatePolygon(polygon: PolygonCoordinates): void {
  if (!polygon.length)
    throw new RangeError("Polygon requires an exterior ring");
  for (const ring of polygon) {
    if (ring.length < 4 || !same(ring[0], ring[ring.length - 1]))
      throw new RangeError(
        "Polygon rings must be closed with at least four positions",
      );
    ring.forEach(point);
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += cross(ring[0], ring[i], ring[i + 1]);
      for (let j = i + 2; j < ring.length - 1; j++) {
        if (i === 0 && j === ring.length - 2) continue;
        if (intersects(ring[i], ring[i + 1], ring[j], ring[j + 1]))
          throw new RangeError("Polygon ring intersects itself");
      }
    }
    if (area === 0) throw new RangeError("Polygon ring has zero area");
  }
  for (let h = 1; h < polygon.length; h++) {
    const hole = polygon[h];
    if (!inRing(hole[0], polygon[0]))
      throw new RangeError("Polygon hole must lie inside exterior");
    for (let previous = 0; previous < h; previous++) {
      const other = polygon[previous];
      if (previous > 0 && (inRing(hole[0], other) || inRing(other[0], hole)))
        throw new RangeError("Polygon holes overlap");
      for (let i = 0; i < hole.length - 1; i++)
        for (let j = 0; j < other.length - 1; j++) {
          if (intersects(hole[i], hole[i + 1], other[j], other[j + 1]))
            throw new RangeError("Polygon rings intersect");
        }
    }
  }
}

function polygons(geometry: BlockGroupGeometry): readonly PolygonCoordinates[] {
  const all =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  if (!all.length) throw new RangeError("Invalid or empty block group polygon");
  all.forEach(validatePolygon);
  return all;
}

function sampleResident(all: readonly PolygonCoordinates[], rng: Rng): XY {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const polygon of all)
    for (const p of polygon[0]) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  for (let i = 0; i < SAMPLE_ATTEMPTS; i++) {
    const p: XY = [
      minX + rng.next() * (maxX - minX),
      minY + rng.next() * (maxY - minY),
    ];
    if (
      all.some(
        (polygon) =>
          inRing(p, polygon[0]) &&
          !polygon.slice(1).some((hole) => inRing(p, hole)),
      )
    )
      return p;
  }
  throw new RangeError(
    "Could not sample block group polygon within 10000 attempts",
  );
}

function projectToSegment(p: Position, [a, b]: Segment): XY {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );
  return [a[0] + t * dx, a[1] + t * dy];
}

type Trace = {
  arrival?: Extract<SimEvent, { type: "arrival" }>;
  start?: Extract<SimEvent, { type: "service_start" }>;
  terminal?: Extract<SimEvent, { type: "completion" | "abandonment" }>;
};

/**
 * Requires explicit source geometry adapters and a matching chronological engine result.
 * Local metric plane uses 111320 m/degree and cos(site latitude) longitude scaling;
 * this is an illustrative rotated-grid approximation, not network routing. Resident
 * sampling supports simple closed polygons, holes and multipolygons; invalid geometry
 * or exhausted bounded rejection sampling throws, with no synthetic fallback.
 *
 * Drivers' visible paths start at supplied arterial projections; their true origin
 * and offscreen grid travel time remain metadata. Passby customers continue to the
 * opposite frontage endpoint; others reverse their inbound route. Open customers hold
 * at the door through close. Equal-time engine states retain separate door vertices.
 */
export function buildTrips(
  schedule: ArrivalSchedule,
  personas: readonly TripPersona[],
  dayResult: DayResult,
  site: TripSite,
  seed: number,
): AgentTrip[] {
  if (site.id !== schedule.siteId || site.id !== dayResult.siteId)
    throw new RangeError("Trip site must match schedule and engine result");
  const { openMin, closeMin } = dayResult.metrics;
  if (
    !Number.isFinite(seed) ||
    !Number.isFinite(openMin) ||
    !Number.isFinite(closeMin) ||
    openMin < 0 ||
    closeMin > 1440 ||
    closeMin <= openMin
  )
    throw new RangeError("Trips require finite seed and valid same-day hours");
  const sources = [
    source(site.door, "door"),
    source(site.streetBearingDeg, "bearing"),
  ];
  point(site.door.value);
  if (!Number.isFinite(site.streetBearingDeg.value))
    throw new RangeError("Street bearing must be finite");
  const longitudeScale =
    METERS_PER_DEGREE * Math.cos((site.door.value[1] * Math.PI) / 180);
  const toXY = (p: Position): XY => [
    (p[0] - site.door.value[0]) * longitudeScale,
    (p[1] - site.door.value[1]) * METERS_PER_DEGREE,
  ];
  const fromXY = (p: Position): XY => [
    site.door.value[0] + p[0] / longitudeScale,
    site.door.value[1] + p[1] / METERS_PER_DEGREE,
  ];
  const angle = (site.streetBearingDeg.value * Math.PI) / 180;
  const u: XY = [Math.sin(angle), Math.cos(angle)];
  const route = (a: Position, b: Position): XY[] => {
    const from = toXY(a),
      to = toXY(b);
    const along = (to[0] - from[0]) * u[0] + (to[1] - from[1]) * u[1];
    const corner = fromXY([from[0] + along * u[0], from[1] + along * u[1]]);
    return [
      copy(a),
      ...(same(a, corner) || same(b, corner) ? [] : [corner]),
      copy(b),
    ];
  };
  const length = (path: readonly Position[]) =>
    path
      .slice(1)
      .reduce((total, p, i) => total + distance(toXY(path[i]), toXY(p)), 0);
  const people = new Map(personas.map((persona) => [persona.id, persona]));
  if (people.size !== personas.length)
    throw new RangeError("Duplicate trip persona id");
  const ids = new Set(schedule.customers.map((c) => c.id));
  if (ids.size !== schedule.customers.length)
    throw new RangeError("Duplicate scheduled customer id");
  const customers = schedule.customers
    .filter((c) => c.arrivalMin >= openMin && c.arrivalMin < closeMin)
    .sort(
      (a, b) =>
        a.arrivalMin - b.arrivalMin || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const expected = new Map(customers.map((c) => [c.id, c]));
  const traces = new Map<string, Trace>();
  let previousTime = openMin;
  for (const event of dayResult.events) {
    if (
      !Number.isFinite(event.timeMin) ||
      event.timeMin < previousTime ||
      event.timeMin > closeMin ||
      !expected.has(event.customerId)
    )
      throw new RangeError(
        "Trip events must be chronological matching in-hours customers",
      );
    previousTime = event.timeMin;
    const trace = traces.get(event.customerId) ?? {};
    if (event.type === "arrival") {
      const c = expected.get(event.customerId)!;
      if (
        trace.arrival ||
        event.timeMin !== c.arrivalMin ||
        event.personaId !== c.personaId
      )
        throw new RangeError("Arrival event must match scheduled customer");
      trace.arrival = event;
    } else {
      if (
        !trace.arrival ||
        trace.arrival.decision === "leave" ||
        trace.terminal
      )
        throw new RangeError("Trip event has no matching joined arrival");
      if (event.type === "service_start") {
        if (
          trace.start ||
          event.waitMin !== event.timeMin - trace.arrival.timeMin
        )
          throw new RangeError("Invalid service start event");
        trace.start = event;
      } else if (event.type === "completion" || event.type === "abandonment") {
        if ((event.type === "completion") !== !!trace.start)
          throw new RangeError("Invalid terminal service/abandonment event");
        trace.terminal = event;
      }
    }
    traces.set(event.customerId, trace);
  }
  if (
    customers.length !== dayResult.metrics.arrivals ||
    customers.some((c) => !traces.get(c.id)?.arrival)
  )
    throw new RangeError("Missing or mismatched in-hours arrival events");
  const validated = new Map<string, readonly PolygonCoordinates[]>();
  const root = createRng(seed);
  return customers.map((customer): AgentTrip => {
    const persona = people.get(customer.personaId);
    if (!persona)
      throw new RangeError(`Missing trip persona ${customer.personaId}`);
    const trace = traces.get(customer.id)!;
    const rng = root.fork(JSON.stringify([customer.id, customer.personaId]));
    const speed =
      persona.commuteMode === "walk"
        ? 80
        : persona.commuteMode === "drive"
          ? 400
          : site.modeSpeeds?.[persona.commuteMode];
    if (!speed || !Number.isFinite(speed) || speed <= 0)
      throw new RangeError(
        `Explicit positive speed required for ${persona.commuteMode}`,
      );
    const usedSources = [...sources];
    let origin: XY;
    let frontage: Segment | undefined;
    if (persona.kind === "resident") {
      usedSources.push(source(persona.blockGroup, "origin"));
      let all = validated.get(persona.id);
      if (!all) {
        all = polygons(persona.blockGroup.value);
        validated.set(persona.id, all);
      }
      origin = sampleResident(all, rng);
    } else if (persona.kind === "worker") {
      usedSources.push(source(persona.workplace, "origin"));
      point(persona.workplace.value);
      if (!Number.isFinite(persona.jitterMeters) || persona.jitterMeters < 0)
        throw new RangeError(
          "Worker jitter radius must be finite and nonnegative",
        );
      const radius = Math.sqrt(rng.next()) * persona.jitterMeters,
        theta = rng.next() * 2 * Math.PI;
      const center = toXY(persona.workplace.value);
      origin = fromXY([
        center[0] + radius * Math.cos(theta),
        center[1] + radius * Math.sin(theta),
      ]);
    } else {
      if (!site.frontage)
        throw new RangeError("Passby trips require explicit frontage geometry");
      usedSources.push(source(site.frontage, "frontage"));
      segment(site.frontage.value);
      frontage = site.frontage.value;
      const t = rng.next();
      origin = [
        frontage[0][0] + t * (frontage[1][0] - frontage[0][0]),
        frontage[0][1] + t * (frontage[1][1] - frontage[0][1]),
      ];
    }
    point(origin);
    let entry = copy(origin);
    if (persona.commuteMode === "drive") {
      if (!site.arterials?.value.length)
        throw new RangeError(
          "Driving trips require supplied arterial segments",
        );
      usedSources.push(source(site.arterials, "arterial"));
      const originXY = toXY(origin);
      const candidates = site.arterials.value.map((line) => {
        segment(line);
        return projectToSegment(originXY, [toXY(line[0]), toXY(line[1])]);
      });
      candidates.sort(
        (a, b) =>
          distance(originXY, a) - distance(originXY, b) ||
          a[0] - b[0] ||
          a[1] - b[1],
      );
      entry = fromXY(candidates[0]);
    }
    const inbound = route(entry, site.door.value);
    const offscreenInboundMinutes = length(route(origin, entry)) / speed;
    const path = inbound.map(copy);
    // Count backward from the exact engine arrival to avoid a floating-point arrival drift.
    const timestamps = new Array<number>(path.length);
    timestamps[path.length - 1] = customer.arrivalMin;
    for (let i = path.length - 2; i >= 0; i--)
      timestamps[i] =
        timestamps[i + 1] - distance(toXY(path[i]), toXY(path[i + 1])) / speed;
    const visibleEntryMin = timestamps[0];
    const doorArrivalIndex = path.length - 1;
    const outcome =
      trace.arrival!.decision === "leave"
        ? "balked"
        : trace.terminal?.type === "completion"
          ? "served"
          : trace.terminal?.type === "abandonment"
            ? "reneged"
            : "open";
    if (trace.start) {
      path.push(copy(site.door.value));
      timestamps.push(trace.start.timeMin);
    }
    let departureIndex: number | null = null;
    if (outcome === "open") {
      path.push(copy(site.door.value));
      timestamps.push(closeMin);
    } else {
      const end = trace.terminal?.timeMin ?? customer.arrivalMin;
      path.push(copy(site.door.value));
      timestamps.push(end);
      departureIndex = path.length - 1;
      let outbound = [...inbound].reverse();
      if (frontage) {
        const near = projectToSegment(toXY(site.door.value), [
          toXY(frontage[0]),
          toXY(frontage[1]),
        ]);
        const originSide = distance(toXY(origin), toXY(frontage[0]));
        const doorSide = distance(near, toXY(frontage[0]));
        outbound = route(
          site.door.value,
          originSide <= doorSide ? frontage[1] : frontage[0],
        );
      }
      for (const next of outbound.slice(1)) {
        timestamps.push(
          timestamps[timestamps.length - 1] +
            distance(toXY(path[path.length - 1]), toXY(next)) / speed,
        );
        path.push(copy(next));
      }
    }
    return {
      customerId: customer.id,
      personaId: customer.personaId,
      kind: persona.kind,
      mode: persona.commuteMode,
      origin,
      path,
      timestamps,
      outcome,
      originDepartureMin: visibleEntryMin - offscreenInboundMinutes,
      visibleEntryMin,
      doorArrivalIndex,
      departureIndex,
      geometry: {
        approximation: "local_rotated_grid",
        sources: usedSources,
        speedMetersPerMin: speed,
        ...(persona.kind === "worker"
          ? { workerJitterMeters: persona.jitterMeters }
          : {}),
        offscreenInboundMinutes,
        offscreenReturnMinutes:
          persona.commuteMode === "drive" &&
          persona.kind !== "passby" &&
          outcome !== "open"
            ? offscreenInboundMinutes
            : 0,
      },
    };
  });
}
