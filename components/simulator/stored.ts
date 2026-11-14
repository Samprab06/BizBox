/**
 * HAC-63: open the simulator from a stored comparison and its representative runs.
 * Pure. Converts canonical stored events (arrived/joined/served/departed/abandoned) back into
 * the engine event shape the scene animates, and builds the demo data and copy for one site.
 */
import type { SiteRun } from "@/lib/contracts";
import type {
  EvaluationRequest,
  EvaluationResult,
} from "@/lib/contracts/evaluation";
import type { AssemblyMetadata } from "@/lib/evaluation/assemble";
import type {
  DailyMetrics,
  DayResult,
  DayType,
  SimEvent,
  SiteConfig,
} from "@/lib/sim/contracts";
import { computeParsedMonthlyEconomics } from "@/lib/sim/economics";
import { resolveStationCount } from "@/lib/sim/engine";
import type { DemoData, demoPlan } from "./fixture";

type StoredEvent = SiteRun["events"][number];

/**
 * Engine-shaped events from canonical ones. Line length at arrival is replayed from the
 * stored sequence; stay probability is not stored, so it shows the recorded decision (1 or 0);
 * stations are assigned to the lowest free lane, as the stored replay does.
 */
export function engineEventsFromStored(
  events: readonly StoredEvent[],
  ticketUsd: number,
): SimEvent[] {
  const ordered = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.minute - b.e.minute || a.i - b.i);
  const joins = new Set(
    events.filter((e) => e.type === "joined").map((e) => e.customerId),
  );
  const joinedAt = new Map<string, number>();
  const lanes = new Map<string, number>();
  const waiting = new Set<string>();
  const out: SimEvent[] = [];
  for (const { e } of ordered) {
    const id = e.customerId;
    switch (e.type) {
      case "arrived": {
        const decision = joins.has(id) ? "join" : "leave";
        out.push({
          type: "arrival",
          timeMin: e.minute,
          customerId: id,
          personaId: "stored",
          lineLength: waiting.size,
          stayProbability: decision === "join" ? 1 : 0,
          decision,
        });
        break;
      }
      case "joined":
        waiting.add(id);
        joinedAt.set(id, e.minute);
        out.push({
          type: "queue_entry",
          timeMin: e.minute,
          customerId: id,
          patienceMin: 0,
        });
        break;
      case "served": {
        waiting.delete(id);
        const used = new Set(lanes.values());
        let lane = 0;
        while (used.has(lane)) lane++;
        lanes.set(id, lane);
        out.push({
          type: "service_start",
          timeMin: e.minute,
          customerId: id,
          stationIndex: lane,
          waitMin: e.minute - (joinedAt.get(id) ?? e.minute),
        });
        break;
      }
      case "departed":
        out.push({
          type: "completion",
          timeMin: e.minute,
          customerId: id,
          stationIndex: lanes.get(id) ?? 0,
          revenueUsd: ticketUsd,
        });
        lanes.delete(id);
        break;
      case "abandoned":
        // A balked arrival's "abandoned" is already its leave decision.
        if (waiting.delete(id))
          out.push({
            type: "abandonment",
            timeMin: e.minute,
            customerId: id,
            waitMin: e.minute - (joinedAt.get(id) ?? e.minute),
          });
        break;
    }
  }
  return out;
}

/** A DayResult for the scene, from a stored run plus the site's saved config. */
export function storedDayResult(
  run: SiteRun,
  config: SiteConfig,
  dayType: DayType,
): DayResult {
  const events = engineEventsFromStored(run.events, config.prices.avgTicketUsd);
  const { openMin, closeMin } = config.hours[dayType];
  const served = events.filter((e) => e.type === "completion").length;
  const balked = events.filter(
    (e) => e.type === "arrival" && e.decision === "leave",
  ).length;
  const reneged = events.filter((e) => e.type === "abandonment").length;
  const arrivals = events.filter((e) => e.type === "arrival").length;
  const metrics: DailyMetrics = {
    dayType,
    openMin,
    closeMin,
    stations: resolveStationCount(config),
    arrivals,
    arrivalsOutsideHours: 0,
    joined: events.filter((e) => e.type === "queue_entry").length,
    served,
    balked,
    reneged,
    abandoned: balked + reneged,
    inServiceAtClose: 0,
    waitingAtClose: 0,
    meanWaitMin: run.metrics.averageWaitMinutes,
    p90WaitMin: null,
    stationUtilization: 0,
    revenueUsd: run.metrics.revenueCents / 100,
  };
  return { siteId: run.siteId, seed: run.seed, events, metrics };
}

export type SimulatorStory = {
  eyebrow: string;
  title: string;
  intro: string;
  scenarioLabels: [string, string];
  compare: boolean;
  footnote: string;
  provenance?: { label: string; items: string[] };
};

const usd = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

/** Demo data, plan figures and copy for one site of a stored comparison. */
export function storedSimulator(input: {
  comparisonId: string;
  request: EvaluationRequest;
  result: EvaluationResult;
  runs: readonly SiteRun[];
  assembly?: AssemblyMetadata;
  siteId?: string;
  siteLabel?: (siteId: string) => string;
}): {
  data: DemoData;
  plan: typeof demoPlan;
  story: SimulatorStory;
  coordinates: { longitude: number; latitude: number };
} | null {
  const siteId =
    input.siteId && input.result.sites.some((s) => s.siteId === input.siteId)
      ? input.siteId
      : input.result.ranking[0];
  const evaluation = input.result.sites.find((s) => s.siteId === siteId);
  const site = input.request.sites.find((s) => s.siteId === siteId);
  if (!evaluation || !site) return null;
  const byId = new Map(input.runs.map((r) => [r.id, r]));
  const weekdayRun = byId.get(evaluation.representative.weekday.runId);
  const weekendRun = byId.get(evaluation.representative.weekend.runId);
  if (!weekdayRun || !weekendRun) return null;
  const config = site.config;
  const days = {
    weekday: storedDayResult(weekdayRun, config, "weekday"),
    weekend: storedDayResult(weekendRun, config, "weekend"),
  };
  const monthly = computeParsedMonthlyEconomics(config, {
    weekday: days.weekday.metrics,
    weekend: days.weekend.metrics,
  });
  const label = input.siteLabel?.(siteId) ?? siteId;
  const range = evaluation.monthlyContributionUsd;
  const assumptions = Object.entries(input.assembly?.assumptions ?? {})
    .filter(([path]) => path.startsWith(`sites.${siteId}.config.`))
    .map(
      ([path, a]) =>
        `${path.slice(`sites.${siteId}.config.`.length)}: ${a.value} (${a.origin})`,
    );
  return {
    data: [
      { run: days.weekday, monthly },
      { run: days.weekend, monthly },
    ],
    plan: {
      concept: input.request.category.replaceAll("_", " "),
      area: config.lease.sf,
      rentPerSquareFoot: config.lease.askingRentUsdPerSfYear,
      ticket: config.prices.avgTicketUsd,
      wage: config.staff.wageUsdPerHour,
      baselineBuildout: config.lease.buildoutUsd,
      alternativeBuildout: config.lease.buildoutUsd,
    },
    story: {
      eyebrow: `Stored comparison · rank ${evaluation.rank} of ${input.result.sites.length}`,
      title: label,
      intro: `Recorded representative weekday and weekend runs (seed ${weekdayRun.seed}) from comparison ${input.comparisonId}, using ${input.result.demandSource === "jev" ? "Jev" : "Huff"} modeled arrivals.`,
      scenarioLabels: ["Weekday", "Weekend"],
      compare: false,
      footnote: `Monthly figures combine this run's weekday and weekend over the saved calendar; the comparison's 90% range for monthly operating contribution is ${usd(range.low)} – ${usd(range.high)}. Modelled scenarios, not a sales forecast.`,
      provenance: {
        label: `Comparison ${input.comparisonId} · runs ${weekdayRun.id}, ${weekendRun.id}`,
        items: assumptions.length
          ? assumptions
          : ["Recorded engine inputs: see the comparison for assumptions."],
      },
    },
    coordinates: {
      longitude: site.storefront.location.lng,
      latitude: site.storefront.location.lat,
    },
  };
}
