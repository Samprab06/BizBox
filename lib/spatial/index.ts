import { FURNITURE_CATALOG } from "@/lib/furniture/catalog";
import {
  SpatialCommandSchema,
  SpatialDraftSchema,
  SpatialPolicySchema,
  type SpatialDraft,
  type SpatialCommand,
  type SpatialPolicy,
  type SpatialPolicyState,
  type SpatialExperimentResult,
  type SpatialExperimentSide,
  type SpatialEstimate,
  type SpatialRun,
} from "@/lib/contracts/spatial";
import { createRng, hashString } from "@/lib/sim/random";
import { stayProbabilityAt, percentile } from "@/lib/sim/engine";
import {
  itemBounds,
  pathLength,
  routeThroughRoom,
  validateGeometry,
} from "./geometry";
export {
  SpatialCommandSchema,
  SpatialDraftSchema,
  SpatialPolicySchema,
} from "@/lib/contracts/spatial";
export type {
  SpatialDraft,
  SpatialCommand,
  SpatialPolicy,
  SpatialExperimentResult,
} from "@/lib/contracts/spatial";
export { itemBounds, routeThroughRoom } from "./geometry";

export function createSpatialDraft(input: {
  projectId: string;
  siteId: string;
  city: "houston" | "los_angeles";
  category?: SpatialDraft["category"];
  widthM?: number;
  depthM?: number;
}): SpatialDraft {
  const width = input.widthM ?? 10,
    depth = input.depthM ?? 8,
    category = input.category ?? "coffee";
  const serviceMin =
    category === "salon_barber"
      ? 30
      : category === "fitness"
        ? 60
        : category === "quick_food"
          ? 5
          : 4;
  return validateGeometry(
    SpatialDraftSchema.parse({
      version: 1,
      id: `spatial-${hashString(`${input.projectId}:${input.siteId}`)}`,
      revision: 0,
      projectId: input.projectId,
      siteId: input.siteId,
      city: input.city,
      timezone:
        input.city === "houston" ? "America/Chicago" : "America/Los_Angeles",
      category,
      room: { widthM: width, depthM: depth, source: "assumed" },
      entrance: { x: width / 2, z: 0.5 },
      servicePoint: { x: width / 2, z: depth - 1 },
      items: [],
      settings: {
        openMin: 480,
        closeMin: 720,
        arrivals:
          category === "salon_barber" ? 20 : category === "fitness" ? 40 : 100,
        serviceMin,
        staff: 2,
        averageTicketUsd:
          category === "salon_barber" ? 30 : category === "fitness" ? 15 : 6,
        wageUsdPerHour: 18,
        cogsFraction: 0.3,
        resourceCapacity: category === "fitness" ? 12 : 2,
        appointmentFraction: 0.6,
        sessionIntervalMin: 30,
        pickupMin: 2,
      },
      limitations: [
        "Authored rectangular room and entrance; not measured selected-unit geometry.",
        "Fixed service infrastructure is an explicit assumed resource; clearing removes proposed furniture only.",
        "Operating costs, demand, staff skills and capacities are editable assumptions; no observed business calibration.",
      ],
    }),
  );
}
export function applySpatialCommand(
  input: SpatialDraft,
  raw: SpatialCommand,
): SpatialDraft {
  const draft = structuredClone(SpatialDraftSchema.parse(input)),
    command = SpatialCommandSchema.parse(raw);
  switch (command.type) {
    case "layout":
      draft.entrance = command.entrance;
      draft.servicePoint = command.servicePoint;
      break;
    case "add":
      draft.items.push({
        id: command.id,
        catalogId: command.catalogId,
        x: command.x,
        z: command.z,
        rotation: command.rotation,
      });
      break;
    case "clear":
      draft.items = [];
      break;
    case "settings":
      draft.settings = command.settings;
      break;
    default: {
      const item = draft.items.find((i) => i.id === command.id);
      if (!item) throw new Error("Furniture instance not found");
      if (command.type === "remove")
        draft.items = draft.items.filter((i) => i.id !== command.id);
      if (command.type === "move") {
        item.x = command.x;
        item.z = command.z;
      }
      if (command.type === "rotate") item.rotation = command.rotation;
    }
  }
  draft.revision++;
  return validateGeometry(SpatialDraftSchema.parse(draft));
}
export function spatialReadiness(input: SpatialDraft): {
  runnable: boolean;
  reasons: string[];
  source: "assumed";
  capabilities: string[];
} {
  try {
    const draft = SpatialDraftSchema.parse(input);
    validateGeometry(draft);
    if (
      draft.timezone !==
      (draft.city === "houston" ? "America/Chicago" : "America/Los_Angeles")
    )
      throw new Error("City and timezone mismatch");
    return {
      runnable: true,
      reasons: [
        draft.room.source === "matterport-bounds"
          ? "Approximate selected-suite room bounds; entrances, service points, obstacle inventory and business behavior still require verification."
          : "Assumption-based preview; approved geometry and business calibration are unavailable.",
        "Jev decisions require an explicitly supplied validated policy.",
      ],
      source: "assumed",
      capabilities: [
        "furniture-placement",
        "route-effects",
        "staffing",
        "hours",
        "pricing",
        "demand",
        ...(draft.category === "salon_barber"
          ? ["appointments", "service-chairs"]
          : draft.category === "fitness"
            ? ["timed-sessions", "floor-capacity"]
            : ["service-queue", "pickup"]),
      ],
    };
  } catch (e) {
    return {
      runnable: false,
      reasons: [e instanceof Error ? e.message : "Invalid draft"],
      source: "assumed",
      capabilities: [],
    };
  }
}
const PERSONAS = [
  {
    id: "time-sensitive",
    description:
      "Synthetic time-sensitive customer; short waits and direct routes matter.",
    patience: 6,
  },
  {
    id: "flexible",
    description: "Synthetic flexible customer willing to wait longer.",
    patience: 18,
  },
  {
    id: "seat-seeking",
    description: "Synthetic customer who prefers available seating.",
    patience: 12,
  },
];
/** The exact same capacity used by provider observations and engine resources. */
export function spatialServiceCapacity(draft: SpatialDraft): number {
  const s = draft.settings;
  const footprint = draft.items
    .map(itemBounds)
    .filter((b) => b.source.role !== "decor")
    .reduce((n, b) => n + (b.maxX - b.minX) * (b.maxZ - b.minZ), 0);
  const declared = s.resourceCapacity ?? 2;
  const capacity =
    draft.category === "fitness"
      ? Math.max(
          0,
          Math.min(
            declared,
            Math.floor((draft.room.widthM * draft.room.depthM - footprint) / 4),
            s.staff * 8,
          ),
        )
      : Math.min(declared, s.staff);
  if (capacity < 1)
    throw new Error("Furniture leaves no modeled activity capacity");
  return capacity;
}
export function getSpatialPolicyStates(
  input: SpatialDraft,
): SpatialPolicyState[] {
  const draft = SpatialDraftSchema.parse(input);
  validateGeometry(draft);
  const routeLengthM = pathLength(routeThroughRoom(draft));
  const seats = draft.items.reduce(
    (n, item) =>
      n + (FURNITURE_CATALOG.find((c) => c.id === item.catalogId)?.seats ?? 0),
    0,
  );
  return PERSONAS.map((p) => {
    const contextHash = `context-${hashString(JSON.stringify({ room: draft.room, entrance: draft.entrance, servicePoint: draft.servicePoint, items: draft.items.filter((i) => FURNITURE_CATALOG.find((c) => c.id === i.catalogId)?.role !== "decor"), settings: draft.settings, city: draft.city, category: draft.category }))}`;
    const fields = {
      contextHash,
      personaId: p.id,
      routeLengthM,
      seats,
      category: draft.category,
      serviceMin: draft.settings.serviceMin,
      staff: draft.settings.staff,
      serviceCapacity: spatialServiceCapacity(draft),
      queueWaitMinPerPerson:
        draft.settings.serviceMin / spatialServiceCapacity(draft),
      averageTicketUsd: draft.settings.averageTicketUsd,
      description: p.description,
    };
    return { key: `policy-${hashString(JSON.stringify(fields))}`, ...fields };
  });
}
function validatedPolicy(states: SpatialPolicyState[], raw?: SpatialPolicy) {
  if (!raw) return undefined;
  const p = SpatialPolicySchema.parse(raw);
  if (p.states.length !== states.length)
    throw new Error("Jev policy coverage is incomplete");
  for (const state of states) {
    const match = p.states.find((s) => s.key === state.key);
    if (
      !match ||
      Object.entries(state).some(
        ([k, v]) => match[k as keyof typeof match] !== v,
      )
    )
      throw new Error("Jev policy does not match current layout observations");
    for (let i = 1; i < match.stayByQueue.length; i++)
      if (
        match.stayByQueue[i]!.lineLength <= match.stayByQueue[i - 1]!.lineLength
      )
        throw new Error("Policy queue points must increase");
  }
  return p;
}
function estimate(values: number[]): SpatialEstimate {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    p5: percentile(sorted, 0.05)!,
    p95: percentile(sorted, 0.95)!,
  };
}
function run(
  draft: SpatialDraft,
  seed: number,
  states: SpatialPolicyState[],
  policy?: SpatialPolicy,
): SpatialRun {
  const s = draft.settings,
    route = routeThroughRoom(draft),
    distance = pathLength(route),
    walkMin = distance / 60;
  const capacity = spatialServiceCapacity(draft),
    declared = s.resourceCapacity ?? 2;
  const occupied = Array.from({ length: capacity }, () => s.openMin),
    prep = Array.from({ length: declared }, () => s.openMin);
  const rng = createRng(seed),
    arrivals = rng.fork("arrivals"),
    events: SpatialRun["events"] = [],
    decisions: SpatialRun["decisions"] = [],
    stageEvents: SpatialRun["stageEvents"] = [],
    customers: SpatialRun["customers"] = [];
  for (let i = 0; i < s.arrivals; i++) {
    const id = `customer-${i}`,
      persona = PERSONAS[i % PERSONAS.length]!,
      service = s.serviceMin * rng.fork(`service:${id}`).lognormal(1, 0.15),
      appointment =
        draft.category === "salon_barber" &&
        rng.fork(`appointment:${id}`).next() < (s.appointmentFraction ?? 0.6);
    const arrival = s.openMin + arrivals.next() * (s.closeMin - s.openMin);
    customers.push({
      id,
      personaId: persona.id,
      arrivalMin: arrival,
      walkStartMin: arrival,
      queueArrivalMin: arrival + walkMin,
      route,
      serviceMin: service,
      appointment,
    });
  }
  customers.sort(
    (a, b) => a.queueArrivalMin - b.queueArrivalMin || a.id.localeCompare(b.id),
  );
  let served = 0,
    balked = 0,
    reneged = 0,
    inServiceAtClose = 0,
    waitingAtClose = 0,
    walkingAtClose = 0,
    busyMinutes = 0;
  const waits: number[] = [];
  const reservations: { start: number; end: number; customerId: string }[] = [];
  for (const c of customers) {
    const t = c.queueArrivalMin;
    if (t >= s.closeMin) {
      walkingAtClose++;
      continue;
    }
    const state = states.find((p) => p.personaId === c.personaId)!,
      persona = PERSONAS.find((p) => p.id === c.personaId)!;
    const queueLength = reservations.filter((r) => r.start > t).length;
    const assumed = Math.max(
      0.02,
      Math.min(
        0.99,
        0.96 -
          ((queueLength * s.serviceMin) / (capacity * persona.patience)) *
            0.22 -
          (distance > 8 ? (distance - 8) * 0.025 : 0) -
          (c.personaId === "seat-seeking" && state.seats === 0 ? 0.15 : 0),
      ),
    );
    const external = policy?.states.find((p) => p.key === state.key);
    const probability = external
      ? stayProbabilityAt(external.stayByQueue, queueLength)
      : assumed;
    const draw = rng.fork(`decision:${c.id}`).next(),
      join = draw < probability;
    decisions.push({
      customerId: c.id,
      personaId: c.personaId,
      timeMin: t,
      action: join ? "join" : "leave",
      probability,
      draw,
      queueLength,
      policyKey: state.key,
      source: policy ? "jev" : "assumed",
      modelVersion: policy?.modelVersion ?? null,
      evidenceId: policy?.evidenceId ?? null,
      routeLengthM: distance,
      seats: state.seats,
    });
    events.push({
      type: "arrival",
      timeMin: t,
      customerId: c.id,
      personaId: c.personaId,
      lineLength: queueLength,
      stayProbability: probability,
      decision: join ? "join" : "leave",
    });
    if (!join) {
      balked++;
      continue;
    }
    const station = occupied.indexOf(Math.min(...occupied));
    let start = Math.max(t, occupied[station]!);
    if (draft.category === "salon_barber" && c.appointment) {
      const slot =
        Math.ceil((t - s.openMin) / s.serviceMin) * s.serviceMin + s.openMin;
      start = Math.max(start, slot);
    }
    if (draft.category === "fitness") {
      const interval = s.sessionIntervalMin ?? 30;
      start = s.openMin + Math.ceil((start - s.openMin) / interval) * interval;
    }
    const patience =
      draft.category === "fitness"
        ? (s.sessionIntervalMin ?? 30) + persona.patience
        : c.appointment
          ? s.serviceMin
          : persona.patience;
    events.push({
      type: "queue_entry",
      timeMin: t,
      customerId: c.id,
      patienceMin: patience,
    });
    if (start - t > patience && t + patience <= s.closeMin) {
      reneged++;
      reservations.push({
        start: t + patience,
        end: t + patience,
        customerId: c.id,
      });
      events.push({
        type: "abandonment",
        timeMin: t + patience,
        customerId: c.id,
        waitMin: patience,
      });
      continue;
    }
    if (start >= s.closeMin) {
      waitingAtClose++;
      reservations.push({
        start: s.closeMin,
        end: s.closeMin,
        customerId: c.id,
      });
      continue;
    }
    let end = start + c.serviceMin;
    occupied[station] = end;
    if (draft.category === "quick_food") {
      occupied[station] = start + Math.min(1, c.serviceMin);
      const p = prep.indexOf(Math.min(...prep)),
        prepStart = Math.max(occupied[station]!, prep[p]!);
      end = prepStart + c.serviceMin + (s.pickupMin ?? 2) + walkMin;
      prep[p] = end;
      stageEvents.push(
        {
          customerId: c.id,
          stage: "preparation",
          startMin: prepStart,
          endMin: end - (s.pickupMin ?? 2) - walkMin,
        },
        {
          customerId: c.id,
          stage: "pickup",
          startMin: end - (s.pickupMin ?? 2) - walkMin,
          endMin: end,
        },
      );
    }
    if (draft.category === "salon_barber" && c.appointment)
      stageEvents.push({
        customerId: c.id,
        stage: "appointment",
        startMin: start,
        endMin: end,
      });
    if (draft.category === "fitness")
      stageEvents.push({
        customerId: c.id,
        stage: "session",
        startMin: start,
        endMin: end,
      });
    reservations.push({ start, end, customerId: c.id });
    events.push({
      type: "service_start",
      timeMin: start,
      customerId: c.id,
      stationIndex: station,
      waitMin: start - t,
    });
    busyMinutes += Math.max(
      0,
      Math.min(occupied[station]!, s.closeMin) - start,
    );
    if (end <= s.closeMin) {
      served++;
      waits.push(start - t);
      events.push({
        type: "completion",
        timeMin: end,
        customerId: c.id,
        stationIndex: station,
        revenueUsd: s.averageTicketUsd,
      });
    } else inServiceAtClose++;
  }
  events.sort(
    (a, b) => a.timeMin - b.timeMin || a.customerId.localeCompare(b.customerId),
  );
  waits.sort((a, b) => a - b);
  const revenue = served * s.averageTicketUsd;
  return {
    seed,
    events,
    decisions,
    customers,
    walkingAtClose,
    routeLengthM: distance,
    adapter:
      draft.category === "fitness"
        ? "session-occupancy"
        : draft.category === "salon_barber"
          ? "appointment-chair"
          : draft.category === "quick_food"
            ? "order-preparation-pickup"
            : "counter-service",
    capacity,
    stageEvents,
    dailyContributionUsd:
      revenue * (1 - s.cogsFraction) -
      ((s.closeMin - s.openMin) / 60) * s.staff * s.wageUsdPerHour,
    metrics: {
      dayType: "weekday",
      openMin: s.openMin,
      closeMin: s.closeMin,
      stations: capacity,
      arrivals: customers.length,
      arrivalsOutsideHours: 0,
      joined: customers.length - balked - walkingAtClose,
      served,
      balked,
      reneged,
      abandoned: balked + reneged,
      inServiceAtClose,
      waitingAtClose,
      meanWaitMin: waits.length
        ? waits.reduce((a, b) => a + b, 0) / waits.length
        : null,
      p90WaitMin: percentile(waits, 0.9),
      stationUtilization: Math.min(
        1,
        busyMinutes / (capacity * (s.closeMin - s.openMin)),
      ),
      revenueUsd: revenue,
    },
  };
}
const METRICS = [
  "served",
  "abandoned",
  "revenueUsd",
  "dailyContributionUsd",
  "meanWaitMin",
  "routeLengthM",
] as const;
function metric(run: SpatialRun, key: (typeof METRICS)[number]) {
  return key === "dailyContributionUsd" || key === "routeLengthM"
    ? run[key]
    : run.metrics[key];
}
function nullableEstimate(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? estimate(known) : { mean: null, p5: null, p95: null };
}
function side(
  draft: SpatialDraft,
  seeds: number[],
  raw?: SpatialPolicy,
): SpatialExperimentSide {
  const policyStates = getSpatialPolicyStates(draft),
    policy = validatedPolicy(policyStates, raw),
    runs = seeds.map((seed) => run(draft, seed, policyStates, policy));
  return {
    draft: structuredClone(draft),
    policyStates,
    runs,
    metrics: Object.fromEntries(
      METRICS.map((k) => [k, nullableEstimate(runs.map((r) => metric(r, k)))]),
    ) as SpatialExperimentSide["metrics"],
  };
}
export function runSpatialExperiment(input: {
  baseline: SpatialDraft;
  variant: SpatialDraft;
  seeds?: number[];
  policies?: { baseline?: SpatialPolicy; variant?: SpatialPolicy };
}): SpatialExperimentResult {
  const baseline = SpatialDraftSchema.parse(input.baseline),
    variant = SpatialDraftSchema.parse(input.variant);
  if (
    baseline.projectId !== variant.projectId ||
    baseline.siteId !== variant.siteId ||
    baseline.id !== variant.id ||
    baseline.category !== variant.category ||
    baseline.city !== variant.city
  )
    throw new Error(
      "Baseline and variant must share project, site, category and city",
    );
  for (const d of [baseline, variant]) {
    const ready = spatialReadiness(d);
    if (!ready.runnable) throw new Error(ready.reasons.join("; "));
  }
  const seeds = input.seeds ?? [11, 29, 47];
  if (
    !seeds.length ||
    seeds.length > 10 ||
    new Set(seeds).size !== seeds.length ||
    seeds.some((s) => !Number.isSafeInteger(s) || s < 0 || s > 0xffffffff)
  )
    throw new Error("Use 1–10 unique unsigned integer seeds");
  const a = side(baseline, seeds, input.policies?.baseline),
    b = side(variant, seeds, input.policies?.variant),
    delta = Object.fromEntries(
      METRICS.map((k) => [
        k,
        nullableEstimate(
          b.runs.map((r, i) => {
            const x = metric(r, k),
              y = metric(a.runs[i]!, k);
            return x === null || y === null ? null : x - y;
          }),
        ),
      ]),
    ) as SpatialExperimentSide["metrics"];
  const source =
    input.policies?.baseline && input.policies.variant
      ? "jev"
      : input.policies?.baseline || input.policies?.variant
        ? "mixed"
        : "assumed";
  return {
    version: 1,
    projectId: baseline.projectId,
    siteId: baseline.siteId,
    baselineRevision: baseline.revision,
    variantRevision: variant.revision,
    seeds: [...seeds],
    source,
    policySnapshots: {
      baseline: input.policies?.baseline
        ? structuredClone(input.policies.baseline)
        : null,
      variant: input.policies?.variant
        ? structuredClone(input.policies.variant)
        : null,
    },
    baseline: a,
    variant: b,
    delta,
    findings: [
      `Modeled served change: ${delta.served.mean.toFixed(1)} per operating day.`,
      `Modeled daily contribution change: $${delta.dailyContributionUsd.mean.toFixed(2)} before rent, equipment purchase and other overhead.`,
      `Walking route change: ${delta.routeLengthM.mean.toFixed(1)} m; decisions use ${source} behavior.`,
    ],
    limitations: [
      ...new Set([...baseline.limitations, ...variant.limitations]),
      "Synthetic arrivals/personas; single weekday model, not a city-calibrated forecast.",
      "Furniture costs are unknown; contribution excludes rent, capex, taxes and other overhead.",
      "Available seat count is a preference observation, not a seating occupancy/dwell simulation.",
      "Routing uses a coarse 0.5 m obstacle grid and assumed 1 m/s walking, not pedestrian collision physics.",
      "Salon appointments use modeled slots without no-shows; fitness uses scheduled capacity/session occupancy.",
      "Fixed infrastructure and qualified staff are explicit assumptions, not derived from furniture assets.",
      "p5/p95 are empirical seed ranges, not confidence intervals. Wait bands omit seeds with no completed customers; paired wait differences require observations on both sides.",
    ],
  };
}
