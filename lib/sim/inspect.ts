/**
 * HAC-93 (SIM-9): pure, renderer-agnostic selectors for inspecting one modeled customer.
 *
 * Everything here is read from the inputs the caller already holds: the engine events of
 * one run, the arrival schedule, persona details and (optionally) the approximate trip.
 * Only events at or before `minute` are read, so seeking back never shows a later outcome.
 * A missing input becomes `null`, which the panel labels as unavailable, never a guess.
 */
import type { CommuteMode, PersonaKind } from "../panel/contracts";
import type { ArrivalSchedule, SimEvent } from "./contracts";
import type { AgentTrip } from "./trips";

/** Persona facts the caller has for this run. Every field is optional on purpose. */
export type InspectPersona = {
  id: string;
  label?: string;
  kind?: PersonaKind;
  incomeUsd?: number;
  age?: number;
  hasKids?: boolean;
  commuteMode?: CommuteMode;
  /** The customer panel's answers for this persona, when the run used them. */
  answers?: {
    /** e.g. "Jev panel" or "Synthetic choice shares". */
    source: string;
    where: readonly { label: string; share: number | null }[];
    visitsPerMonth: number | null;
  };
};

export type InspectSource = "engine" | "stored";

export type InspectInput = {
  events: readonly SimEvent[];
  minute: number;
  customerId: string;
  schedule?: Pick<ArrivalSchedule, "customers"> | null;
  personas?: readonly InspectPersona[] | null;
  trips?: readonly AgentTrip[] | null;
  /**
   * "stored" events were rebuilt from canonical stored rows, which keep the join/leave
   * decision but not the stay probability or patience, so those are shown as not stored.
   */
  source?: InspectSource;
  /** Closing minute; customers still in line or service after it are labelled as such. */
  closeMin?: number;
};

export type Activity =
  | "not_arrived"
  | "traveling"
  | "waiting"
  | "in_service"
  | "served"
  | "left";

export type Outcome = "served" | "balked" | "reneged";

export type HistoryEntry = { minute: number; label: string };

export type InspectCard = {
  customerId: string;
  minute: number;
  activity: Activity;
  /** True once the doors have closed while the customer is still in line or service. */
  atClose: boolean;
  persona: {
    id: string | null;
    label: string | null;
    kind: PersonaKind | null;
    incomeBand: string | null;
    ageBand: string | null;
    hasKids: boolean | null;
  };
  travel: {
    mode: CommuteMode | null;
    /** From the trip's sampled origin to the door; null without a trip. */
    originDistanceMeters: number | null;
    /** "assumed" when any trip geometry source is assumed. */
    geometry: "provided" | "assumed" | null;
  };
  arrival: {
    minute: number;
    lineLength: number;
    /** Null when the events do not carry the original probability. */
    stayProbability: number | null;
    decision: "join" | "leave";
    /** The schedule's uniform draw compared against the stay probability. */
    stayDraw: number | null;
    /** The line was at capacity: the draw would have stayed, the engine turned them away. */
    lineFull: boolean;
  } | null;
  wait: {
    minutes: number;
    /** False while the customer is still in line (time waited so far). */
    final: boolean;
  } | null;
  service: {
    startMin: number;
    station: number;
    /** Known only after completion. */
    durationMin: number | null;
  } | null;
  outcome: Outcome | null;
  answers: InspectPersona["answers"] | null;
  why: string;
  history: HistoryEntry[];
};

const EMPTY_PERSONA: InspectCard["persona"] = {
  id: null,
  label: null,
  kind: null,
  incomeBand: null,
  ageBand: null,
  hasKids: null,
};

const BAD_INPUT = "Inspection requires a finite minute and a customer ID";

export function incomeBand(incomeUsd: number | undefined): string | null {
  if (incomeUsd === undefined || !Number.isFinite(incomeUsd) || incomeUsd < 0)
    return null;
  const bands: [number, string][] = [
    [25_000, "Under $25k"],
    [50_000, "$25k–$50k"],
    [75_000, "$50k–$75k"],
    [100_000, "$75k–$100k"],
    [150_000, "$100k–$150k"],
  ];
  return bands.find(([limit]) => incomeUsd < limit)?.[1] ?? "$150k and over";
}

export function ageBand(age: number | undefined): string | null {
  if (age === undefined || !Number.isFinite(age) || age < 0) return null;
  const bands: [number, string][] = [
    [18, "Under 18"],
    [25, "18–24"],
    [35, "25–34"],
    [45, "35–44"],
    [55, "45–54"],
    [65, "55–64"],
  ];
  return bands.find(([limit]) => age < limit)?.[1] ?? "65 and over";
}

const METERS_PER_DEGREE = 111_320;
/** Local equirectangular distance, the same approximation the trip builder uses. */
function meters(a: readonly number[], b: readonly number[]) {
  const scale = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot(
    (a[0] - b[0]) * METERS_PER_DEGREE * scale,
    (a[1] - b[1]) * METERS_PER_DEGREE,
  );
}

const fixed = (value: number, digits: number) => value.toFixed(digits);
const station = (index: number) => `counter ${index + 1}`;

/** Customers who have arrived by `minute`, in arrival order. Later arrivals stay hidden. */
export function arrivedCustomers(
  events: readonly SimEvent[],
  minute: number,
): string[] {
  const ids: string[] = [];
  for (const event of events) {
    if (event.timeMin > minute) break;
    if (event.type === "arrival") ids.push(event.customerId);
  }
  return ids;
}

/** Case-insensitive match on the customer ID or the persona label. */
export function filterCustomers(
  ids: readonly string[],
  query: string,
  personaLabel: (id: string) => string | undefined = () => undefined,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...ids];
  return ids.filter(
    (id) =>
      id.toLowerCase().includes(needle) ||
      (personaLabel(id)?.toLowerCase().includes(needle) ?? false),
  );
}

/** Persona ID per customer from arrivals at or before `minute`, then the schedule. */
export function personaIdAt(
  events: readonly SimEvent[],
  minute: number,
  customerId: string,
  schedule?: Pick<ArrivalSchedule, "customers"> | null,
) {
  for (const event of events) {
    if (event.timeMin > minute) break;
    if (event.type === "arrival" && event.customerId === customerId)
      return event.personaId;
  }
  return (
    schedule?.customers.find((customer) => customer.id === customerId)
      ?.personaId ?? null
  );
}

function why(card: Omit<InspectCard, "why" | "history">, source: InspectSource) {
  const { arrival, wait, service, outcome, activity } = card;
  if (!arrival)
    return activity === "traveling"
      ? "On the way; has not reached the door at this time."
      : "Has not arrived at this time.";
  const saw = `Saw ${arrival.lineLength} in line`;
  const chance =
    arrival.stayProbability === null
      ? source === "stored"
        ? "stay probability not stored"
        : "stay probability unavailable"
      : `stay probability ${fixed(arrival.stayProbability, 2)}`;
  const opening = `${saw}, ${chance}`;
  if (arrival.decision === "leave")
    return arrival.lineFull
      ? `${opening}, line was full, turned away.`
      : `${opening}, walked away.`;
  if (outcome === "reneged")
    return `${opening}, joined, left after waiting ${fixed(wait?.minutes ?? 0, 1)} min.`;
  if (outcome === "served" && service)
    return `${opening}, joined, waited ${fixed(wait?.minutes ?? 0, 1)} min, served at ${station(service.station)}.`;
  if (service)
    return `${opening}, joined, waited ${fixed(wait?.minutes ?? 0, 1)} min, ${card.atClose ? "still in service at closing" : `in service at ${station(service.station)}`}.`;
  return `${opening}, joined, ${card.atClose ? "still in line at closing" : `waiting ${fixed(wait?.minutes ?? 0, 1)} min so far`}.`;
}

/**
 * The inspection card for one customer at one minute. Pure: no clock, randomness or I/O.
 * Events must be in chronological order (the engine and stored adapter both emit them so).
 */
export function inspectCustomer(input: InspectInput): InspectCard {
  const {
    events,
    minute,
    customerId,
    schedule,
    personas,
    trips,
    source = "engine",
    closeMin,
  } = input;
  if (!Number.isFinite(minute) || !customerId) throw new RangeError(BAD_INPUT);

  let arrivalEvent: Extract<SimEvent, { type: "arrival" }> | null = null;
  let queueMin: number | null = null;
  let start: Extract<SimEvent, { type: "service_start" }> | null = null;
  let completion: Extract<SimEvent, { type: "completion" }> | null = null;
  let abandonment: Extract<SimEvent, { type: "abandonment" }> | null = null;
  const history: HistoryEntry[] = [];
  for (const event of events) {
    if (event.timeMin > minute) break;
    if (event.customerId !== customerId) continue;
    switch (event.type) {
      case "arrival":
        arrivalEvent = event;
        history.push({
          minute: event.timeMin,
          label:
            event.decision === "join" ? "Arrived" : "Arrived and walked away",
        });
        break;
      case "queue_entry":
        queueMin = event.timeMin;
        history.push({ minute: event.timeMin, label: "Joined the line" });
        break;
      case "service_start":
        start = event;
        history.push({
          minute: event.timeMin,
          label: `Started service at ${station(event.stationIndex)}`,
        });
        break;
      case "completion":
        completion = event;
        history.push({ minute: event.timeMin, label: "Completed service" });
        break;
      case "abandonment":
        abandonment = event;
        history.push({ minute: event.timeMin, label: "Left the line" });
        break;
    }
  }

  const scheduled = schedule?.customers.find((c) => c.id === customerId);
  const trip = trips?.find((t) => t.customerId === customerId) ?? null;
  const personaId = arrivalEvent?.personaId ?? scheduled?.personaId ?? null;
  const persona =
    personaId === null
      ? undefined
      : personas?.find((entry) => entry.id === personaId);

  const outcome: Outcome | null =
    arrivalEvent?.decision === "leave"
      ? "balked"
      : completion
        ? "served"
        : abandonment
          ? "reneged"
          : null;
  const tripEnd = trip?.timestamps.at(-1);
  const activity: Activity = !arrivalEvent
    ? trip && minute >= trip.visibleEntryMin
      ? "traveling"
      : "not_arrived"
    : outcome === "served"
      ? "served"
      : outcome
        ? "left"
        : start
          ? "in_service"
          : "waiting";
  // Outbound customers on a trip are still traveling, but the outcome is already known.
  const shownActivity: Activity =
    outcome &&
    trip &&
    trip.departureIndex !== null &&
    tripEnd !== undefined &&
    minute < tripEnd
      ? "traveling"
      : activity;
  const atClose =
    closeMin !== undefined &&
    minute >= closeMin &&
    (activity === "waiting" || activity === "in_service");

  const stored = source === "stored";
  const draw = !stored && scheduled ? scheduled.stayDraw : null;
  const stayProbability = arrivalEvent && !stored ? arrivalEvent.stayProbability : null;

  const geometry = trip
    ? trip.geometry.sources.some((s) => s.provenance === "assumed")
      ? "assumed"
      : "provided"
    : null;
  const door = trip?.path[trip.doorArrivalIndex];

  // Before a customer is on the map or at the door, nothing about them is shown yet.
  const hidden = shownActivity === "not_arrived";
  const base: Omit<InspectCard, "why" | "history"> = {
    customerId,
    minute,
    activity: shownActivity,
    atClose,
    persona: hidden
      ? EMPTY_PERSONA
      : {
          id:
            personaId && !(stored && personaId === "stored") ? personaId : null,
          label: persona?.label ?? null,
          kind: persona?.kind ?? trip?.kind ?? null,
          incomeBand: incomeBand(persona?.incomeUsd),
          ageBand: ageBand(persona?.age),
          hasKids: persona?.hasKids ?? null,
        },
    travel: hidden
      ? { mode: null, originDistanceMeters: null, geometry: null }
      : {
          mode: trip?.mode ?? persona?.commuteMode ?? null,
          originDistanceMeters: trip && door ? meters(trip.origin, door) : null,
          geometry,
        },
    arrival: arrivalEvent
      ? {
          minute: arrivalEvent.timeMin,
          lineLength: arrivalEvent.lineLength,
          stayProbability,
          decision: arrivalEvent.decision,
          stayDraw: draw,
          lineFull:
            arrivalEvent.decision === "leave" &&
            draw !== null &&
            stayProbability !== null &&
            draw < stayProbability,
        }
      : null,
    wait: start
      ? { minutes: start.waitMin, final: true }
      : abandonment
        ? { minutes: abandonment.waitMin, final: true }
        : queueMin !== null
          ? { minutes: Math.max(0, minute - queueMin), final: false }
          : null,
    service: start
      ? {
          startMin: start.timeMin,
          station: start.stationIndex,
          durationMin: completion ? completion.timeMin - start.timeMin : null,
        }
      : null,
    outcome,
    answers: arrivalEvent ? (persona?.answers ?? null) : null,
  };
  return { ...base, why: why(base, source), history };
}
