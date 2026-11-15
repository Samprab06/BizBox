import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BusinessProfileSchema,
  type AssumedValue,
  type BusinessProfile,
} from "@/lib/contracts";
import type { CatchmentResponse } from "@/lib/contracts/catchment";
import type { SiteSearchResult } from "@/lib/contracts/sites";
import {
  EvaluationRequestSchema,
  SiteTweakMapSchema,
  type EvaluationRequest,
  type EvaluationSite,
  type SiteTweakMap,
  type SiteTweaks,
} from "@/lib/contracts/evaluation";
import { SiteConfigSchema } from "@/lib/sim/contracts";
import { categoryDefaults } from "@/lib/agent/defaults";
import {
  WEEKDAYS_PER_MONTH,
  WEEKEND_DAYS_PER_MONTH,
} from "@/lib/demand/defaults";
import type { LatLng, Storefront, Origin } from "@/lib/demand/contracts";
import type {
  CatchmentInput,
  Competitor,
  CandidateSite,
  PersonaSet,
} from "@/lib/panel/contracts";
import { buildPersonas } from "@/lib/panel/personas";
import { runPanelForSites, type RunPanelOptions } from "@/lib/panel/panel";
import { panelProgressMessage } from "@/lib/panel/progress";
import type { JevClient } from "@/lib/panel/jev-client";
import type { JevCache } from "@/lib/panel/cache";
import type { ScenarioOverrides } from "@/lib/contracts/scenario";
import type { Layout } from "@/lib/contracts/layout";

export const AssemblyShortcutSchema = z
  .object({
    projectId: z.string().min(1),
    profileId: z.string().min(1),
    candidateIds: z
      .array(
        z
          .string()
          .max(100)
          .regex(/^\d+:\d+$/),
      )
      .min(1)
      .max(8)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Candidate IDs must be unique",
      ),
    demandSource: z.enum(["huff", "jev"]).default("huff"),
    seeds: z.number().int().min(1).max(100).optional(),
    /** Scene 1: per-site hours/price/staff/rent, keyed by candidate ID. */
    siteTweaks: SiteTweakMapSchema.optional(),
  })
  .strict();
const unknownTweakMessage = (id: string) =>
  `Tweaks name ${id}, which is not one of candidateIds`;
export const AssemblyInputSchema = AssemblyShortcutSchema.extend({
  profileVersion: z.number().int().positive(),
  profile: BusinessProfileSchema,
}).superRefine((input, ctx) => {
  if (
    input.profile.id !== input.profileId ||
    input.profile.projectId !== input.projectId ||
    input.profile.version !== input.profileVersion
  )
    ctx.addIssue({
      code: "custom",
      message: "Profile snapshot identity must match the request",
    });
  const wanted = new Set(input.candidateIds);
  for (const id of Object.keys(input.siteTweaks ?? {}))
    if (!wanted.has(id))
      ctx.addIssue({
        code: "custom",
        path: ["siteTweaks", id],
        message: unknownTweakMessage(id),
      });
});

/**
 * Scene 1: field errors for per-site tweaks keyed by a candidate that is not in the request,
 * as `{ "siteTweaks.<candidateId>": [message] }`. Empty when every tweak names a candidate.
 */
export function siteTweakFieldErrors(
  candidateIds: readonly string[],
  siteTweaks: SiteTweakMap | undefined,
): Record<string, string[]> {
  const wanted = new Set(candidateIds);
  return Object.fromEntries(
    Object.keys(siteTweaks ?? {})
      .filter((id) => !wanted.has(id))
      .map((id) => [`siteTweaks.${id}`, [unknownTweakMessage(id)]]),
  );
}

/**
 * Scene 1: per-site tweaks produced a site config the simulator cannot run. Carries field
 * errors keyed by tweak field (`siteTweaks.<candidateId>.<field>`), reported as a 422.
 */
export class SiteTweakError extends Error {
  constructor(
    message: string,
    public readonly fieldErrors: Record<string, string[]>,
  ) {
    super(message);
    this.name = "SiteTweakError";
  }
}

/** Which tweak field produced each part of the site config, for field errors. */
const TWEAK_FIELD_FOR_CONFIG: Record<string, keyof SiteTweaks> = {
  hours: "hours",
  prices: "priceUsd",
  staff: "staff",
  lease: "monthlyRentUsd",
};

/** One-line summary of a site's tweaks for findings, e.g. "hours 420-1140, staff 3". */
function describeTweaks(tweaks: SiteTweaks): string {
  const parts: string[] = [];
  if (tweaks.hours)
    parts.push(
      `hours ${tweaks.hours.openMinute}-${tweaks.hours.closeMinute} (minutes of the day)`,
    );
  if (tweaks.priceUsd !== undefined)
    parts.push(`average ticket $${tweaks.priceUsd.toFixed(2)}`);
  if (tweaks.staff !== undefined) parts.push(`staff ${tweaks.staff}`);
  if (tweaks.monthlyRentUsd !== undefined)
    parts.push(`monthly rent $${tweaks.monthlyRentUsd.toFixed(2)}`);
  return parts.join(", ");
}
export type AssembleEvaluationInput = z.input<typeof AssemblyInputSchema>;
export type AssemblyFinding = {
  code: string;
  message: string;
  siteId?: string;
};
/**
 * HAC-156: version of the rule that picks each site's Jev competitors: that site's own
 * catchment only, venues with source coordinates, deduplicated by source ID, sorted by stable
 * venue ID, capped at `JEV_MAX_COMPETITORS`. Bump it when the rule changes (cache keys change).
 */
export const JEV_COMPETITOR_SET_VERSION = "hac156-site-catchment-v1";
/** Jev `where` options per site besides the site itself and "none". */
export const JEV_MAX_COMPETITORS = 20;
export type JevCompetitorSet = {
  version: typeof JEV_COMPETITOR_SET_VERSION;
  /** Per candidate site ID: the competitor IDs Jev was shown, in prompt order. */
  sites: Record<string, { competitorIds: string[]; capped: boolean }>;
};
/**
 * HAC-159: version of the rule that builds each site's Jev personas: `buildPersonas` over that
 * site's own catchment (its block groups and workplaces, its own locations, its storefront as
 * the fallback location), seeded and named by that site's catchment ID. Never the shared study
 * area, so other candidates cannot change a site's personas. Bump it when the rule changes
 * (persona IDs, prompts and cache keys change).
 */
export const JEV_PERSONA_SET_VERSION = "hac159-site-catchment-v1";
export type JevPersonaSetProvenance = {
  version: typeof JEV_PERSONA_SET_VERSION;
  /** Per candidate site ID: the catchment that seeded its personas, and how many there are. */
  sites: Record<string, { catchmentId: string; personaCount: number }>;
};
export type AssemblyMetadata = {
  /** Immutable scenario and optional layout snapshot used by HAC-81. */
  scenario?: {
    id: string;
    layoutId: string | null;
    overrides: ScenarioOverrides;
    layout: Layout | null;
  };
  findings: AssemblyFinding[];
  assumptions: Record<
    string,
    { value: number; origin: Origin; evidenceIds: string[] }
  >;
  /** Provenance of the per-site Jev competitor sets, when Jev was asked (HAC-156). */
  jevCompetitorSet?: JevCompetitorSet;
  /** Provenance of the per-site Jev persona sets, when Jev was asked (HAC-159). */
  jevPersonaSet?: JevPersonaSetProvenance;
  /**
   * Scene 1: the per-site tweaks applied to this comparison, keyed by candidate (site) ID,
   * exactly as requested. Only sites that were assembled appear; a tweak for a candidate that
   * was excluded is reported as a `SITE_TWEAKS_IGNORED` finding instead. The tweaked values are
   * already in `request.sites[].config`, so reruns reproduce them from the stored request.
   */
  siteTweaks?: SiteTweakMap;
};
export type AssembledEvaluation = AssemblyMetadata & {
  request: EvaluationRequest;
};
export class AssemblyError extends Error {
  constructor(
    message: string,
    public readonly findings: AssemblyFinding[],
  ) {
    super(message);
  }
}
/**
 * HAC-155: the Jev panel reached its deadline before every persona answered. Not a failure:
 * the answers received are cached by key, so assembling the same inputs again resumes from
 * them. Never reported as a finished Jev result, and never replaced by a silent Huff fallback.
 */
export class PanelInProgressError extends Error {
  /** Marks a step that should be resent unchanged (read by the investigation job loop). */
  readonly resumable = true;
  constructor(
    public readonly completedPersonas: number,
    public readonly totalPersonas: number,
  ) {
    super(panelProgressMessage({ completedPersonas, totalPersonas }));
    this.name = "PanelInProgressError";
  }
}
/** Deadline for the Jev panel step of an assembly (see `RunPanelOptions.deadlineAt`). */
export type PanelDeadline = Pick<
  RunPanelOptions,
  "deadlineAt" | "deadlineReserveMs" | "signal" | "now"
>;
export type AssemblySearch = {
  result: SiteSearchResult;
  frontageFt?: Record<string, AssumedValue>;
};
export type AssemblyCatchment = {
  response: CatchmentResponse;
  locations?: {
    blockGroups?: Record<string, LatLng>;
    workers?: Record<
      string,
      LatLng & {
        earnings?: { low: number; mid: number; high: number };
        ages?: { under30: number; age30to54: number; over55: number };
      }
    >;
    competitors?: Record<string, LatLng & { origin: "costar" | "public" }>;
  };
};
type Picked<T> = { row: T; bundle: AssemblyCatchment };
export type AssemblyDependencies = {
  searchSites(
    profile: BusinessProfile,
    candidateIds: string[],
  ): Promise<AssemblySearch>;
  getCatchment(
    siteId: string,
    profile: BusinessProfile,
  ): Promise<AssemblyCatchment>;
  jev?: { client: JevClient; cache: JevCache; bundleOrders?: boolean };
};

const optionId = (id: string) =>
  `s_${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
const defaultMetric = (value: number): AssumedValue => ({
  value,
  origin: "default",
  unit: "scenario",
  evidenceIds: ["hac56-assembly-scenario-v1"],
});
// Authored scenario inputs, not measured market benchmarks. Profile observations win.
const TICKETS = {
  coffee: { budget: 5, mid: 6.5, premium: 9 },
  quick_food: { budget: 9, mid: 12, premium: 18 },
  salon_barber: { budget: 25, mid: 35, premium: 55 },
  fitness: { budget: 15, mid: 20, premium: 30 },
};

/** Same request is shared by all sites; findings/provenance stay beside the canonical contract. */
export async function assembleEvaluation(
  raw: AssembleEvaluationInput,
  deps: AssemblyDependencies,
  panelDeadline: PanelDeadline = {},
): Promise<AssembledEvaluation> {
  const input = AssemblyInputSchema.parse(raw);
  const { profile } = input;
  if (profile.category === "unsupported")
    throw new AssemblyError("Unsupported business category", []);
  const category = profile.category;
  const defaults = categoryDefaults(category)!;
  const findings: AssemblyFinding[] = [];
  const assumptions: AssemblyMetadata["assumptions"] = {};
  const finding = (code: string, message: string, siteId?: string) =>
    findings.push({ code, message, ...(siteId ? { siteId } : {}) });
  const number = (path: string, metric: AssumedValue, fallback?: number) => {
    const chosen =
      metric.value === null
        ? fallback === undefined
          ? null
          : defaultMetric(fallback)
        : metric;
    if (chosen === null || chosen.value === null)
      throw new AssemblyError(`Required input is unknown: ${path}`, findings);
    assumptions[path] = {
      value: chosen.value,
      origin: chosen.origin,
      evidenceIds: chosen.evidenceIds,
    };
    if (chosen.origin === "default")
      finding(
        "DEFAULT_ASSUMPTION",
        `${path} uses an explicit uncalibrated scenario default (${chosen.value}).`,
      );
    return chosen.value;
  };
  const tier = profile.economics.priceTier.value ?? "mid";
  if (profile.economics.priceTier.value === null)
    finding(
      "DEFAULT_PRICE_TIER",
      "Unknown price tier uses the mid scenario default.",
    );
  const price =
    number(
      "profile.averageTicketCents",
      profile.economics.averageTicketCents,
      TICKETS[category][tier] * 100,
    ) / 100;
  const staff = number("profile.servers", profile.capacity.servers, 2);
  if (!Number.isInteger(staff))
    throw new AssemblyError("Staff count must be a whole number", findings);
  const wage =
    number(
      "profile.wageRateCentsPerHour",
      profile.derivedDefaults.wageRateCentsPerHour,
      defaults.values.wageRateCentsPerHour.value!,
    ) / 100;
  const cogs = number(
    "profile.cogsFraction",
    profile.derivedDefaults.cogsFraction,
    defaults.values.cogsFraction.value!,
  );
  const service = number(
    "profile.serviceMinutes",
    profile.capacity.serviceMinutes,
    defaults.values.serviceMinutes.value!,
  );
  const buildout =
    number(
      "profile.buildoutBudgetCents",
      profile.economics.buildoutBudgetCents,
    ) / 100;
  const sfPerStation = number(
    "category.squareFeetPerStation",
    defaults.values.squareFeetPerStation,
  );
  if (service <= 0 || sfPerStation <= 0)
    throw new AssemblyError(
      "Service time and station area must be positive",
      findings,
    );
  const { result, frontageFt = {} } = await deps.searchSites(
    profile,
    input.candidateIds,
  );
  const rows = new Map(result.candidates.map((row) => [row.candidate.id, row]));
  const sites: EvaluationSite[] = [];
  const catchments: AssemblyCatchment[] = [];
  const siteCatchments = new Map<string, AssemblyCatchment>();
  const panelSites: CandidateSite[] = [];
  const appliedTweaks: SiteTweakMap = {};
  for (const id of input.candidateIds) {
    const row = rows.get(id);
    if (!row) {
      finding(
        "CANDIDATE_UNAVAILABLE",
        "Candidate is absent from the current matching inventory.",
        id,
      );
      continue;
    }
    const c = row.candidate;
    if (c.projectId !== input.projectId || c.city !== profile.city)
      throw new AssemblyError(
        "Candidate identity does not match the profile",
        findings,
      );
    const unknown = [
      ["size", c.floorAreaSqFt.value],
      ["rent", row.baseRentCents.value],
      ["latitude", c.latitude.value],
      ["longitude", c.longitude.value],
    ]
      .filter(([, value]) => value === null)
      .map(([name]) => name);
    if (unknown.length) {
      finding(
        "SITE_INPUT_UNKNOWN",
        `Excluded: unknown ${unknown.join(", ")}.`,
        id,
      );
      continue;
    }
    // Unknown opex alone (non-NNN lease) is not a reason to drop a unit: assume costs are
    // included in rent ($0 additional) and say so as a default-origin assumption.
    const opex: AssumedValue =
      row.opexCents.value === null
        ? {
            value: 0,
            origin: "default",
            unit: row.opexCents.unit,
            evidenceIds: row.opexCents.evidenceIds,
          }
        : row.opexCents;
    if (row.opexCents.value === null)
      finding(
        "OPEX_ASSUMED_INCLUDED",
        "Operating expenses are not listed; assumed included in rent ($0 additional).",
        id,
      );
    const sf = c.floorAreaSqFt.value!;
    if (sf <= 0 || Math.floor(sf / sfPerStation) < 1) {
      finding(
        "INSUFFICIENT_AREA",
        "Excluded: marketed floor area does not fit one category station.",
        id,
      );
      continue;
    }
    const path = `sites.${id}`;
    number(`${path}.sizeSqft`, c.floorAreaSqFt);
    number(`${path}.monthlyBaseRentCents`, row.baseRentCents);
    number(`${path}.monthlyOpexCents`, opex);
    number(`${path}.latitude`, c.latitude);
    number(`${path}.longitude`, c.longitude);
    const frontage = number(
      `${path}.frontageFt`,
      frontageFt[id] ?? defaultMetric(20),
      20,
    );
    if (frontageFt[id]?.origin === "costar")
      finding(
        "BUILDING_FRONTAGE_PROXY",
        "Building-level source frontage is used as a storefront proxy; marketed-suite frontage is not verified.",
        id,
      );
    const anchors = number(`${path}.anchorCoTenants`, defaultMetric(0));
    const term = number(`${path}.leaseTermMonths`, defaultMetric(60));
    const position =
      row.position === "Corner"
        ? "corner"
        : row.position === "EndCap"
          ? "end_cap"
          : "inline";
    if (
      row.position !== "Corner" &&
      row.position !== "EndCap" &&
      row.position !== "Inline"
    )
      finding(
        "DEFAULT_POSITION",
        "Unverified space position is modeled as inline, origin default.",
        id,
      );
    const storefront: Storefront = {
      id,
      location: { lat: c.latitude.value!, lng: c.longitude.value! },
      sizeSqft: sf,
      position,
      frontageFt: frontage,
      anchorCoTenants: anchors,
      origin: c.floorAreaSqFt.origin,
    };
    const hours = {
      openMin: profile.operatingHours.openMinute,
      closeMin: profile.operatingHours.closeMinute,
    };
    // Scene 1: per-site tweaks replace this site's engine/economics inputs. Jev prompts keep
    // the profile's opening time and price (see `panelSites` and `need`), so hours, staff and
    // rent tweaks never change Jev cache keys; a price tweak reprices cached answers instead.
    const tweaks = input.siteTweaks?.[id];
    const siteHours = tweaks?.hours
      ? {
          openMin: tweaks.hours.openMinute,
          closeMin: tweaks.hours.closeMinute,
        }
      : hours;
    const sitePrice = tweaks?.priceUsd ?? price;
    const siteStaff = tweaks?.staff ?? staff;
    const siteRentUsdPerSfYear =
      tweaks?.monthlyRentUsd !== undefined
        ? (tweaks.monthlyRentUsd * 12) / sf
        : (row.baseRentCents.value! * 12) / 100 / sf;
    const tweaked = (key: string, value: number, field: keyof SiteTweaks) => {
      assumptions[`${path}.config.${key}`] = {
        value,
        origin: "founder",
        evidenceIds: [`siteTweaks:${id}:${field}`],
      };
    };
    const trace = (key: string, value: number, sourcePath: string) => {
      assumptions[`${path}.config.${key}`] = {
        ...assumptions[sourcePath]!,
        value,
      };
    };
    number(`${path}.config.stations.usableSf`, {
      ...c.floorAreaSqFt,
      origin: "default",
    });
    number(`${path}.config.stations.planned`, {
      ...defaultMetric(Math.floor(sf / sfPerStation)),
      evidenceIds: [
        ...c.floorAreaSqFt.evidenceIds,
        ...defaults.values.squareFeetPerStation.evidenceIds,
      ],
    });
    trace(
      "stations.sfPerStation",
      sfPerStation,
      "category.squareFeetPerStation",
    );
    trace("prices.avgTicketUsd", price, "profile.averageTicketCents");
    trace("staff.headcount", staff, "profile.servers");
    trace("staff.wageUsdPerHour", wage, "profile.wageRateCentsPerHour");
    trace("costs.cogsPctOfRevenue", cogs, "profile.cogsFraction");
    trace("service.meanServiceMin", service, "profile.serviceMinutes");
    trace("lease.sf", sf, `${path}.sizeSqft`);
    trace(
      "lease.askingRentUsdPerSfYear",
      (row.baseRentCents.value! * 12) / 100 / sf,
      `${path}.monthlyBaseRentCents`,
    );
    if (tweaks?.priceUsd !== undefined)
      tweaked("prices.avgTicketUsd", sitePrice, "priceUsd");
    if (tweaks?.staff !== undefined)
      tweaked("staff.headcount", siteStaff, "staff");
    if (tweaks?.monthlyRentUsd !== undefined)
      tweaked(
        "lease.askingRentUsdPerSfYear",
        siteRentUsdPerSfYear,
        "monthlyRentUsd",
      );
    trace(
      "lease.opexUsdPerSfYear",
      (opex.value! * 12) / 100 / sf,
      `${path}.monthlyOpexCents`,
    );
    trace("lease.buildoutUsd", buildout, "profile.buildoutBudgetCents");
    trace("lease.leaseTermMonths", term, `${path}.leaseTermMonths`);
    number(
      `${path}.config.calendar.weekdayDaysPerMonth`,
      defaultMetric(WEEKDAYS_PER_MONTH),
    );
    number(
      `${path}.config.calendar.weekendDaysPerMonth`,
      defaultMetric(WEEKEND_DAYS_PER_MONTH),
    );
    for (const day of ["weekday", "weekend"] as const)
      for (const key of ["openMin", "closeMin"] as const)
        number(
          `${path}.config.hours.${day}.${key}`,
          tweaks?.hours
            ? {
                value: siteHours[key],
                origin: "founder",
                evidenceIds: [`siteTweaks:${id}:hours`],
                unit: "minutes",
              }
            : {
                value: hours[key],
                origin: profile.synthetic ? "default" : "founder",
                evidenceIds: [`profile:${profile.id}:operatingHours`],
                unit: "minutes",
              },
        );
    const config: EvaluationSite["config"] = {
      hours: { weekday: siteHours, weekend: siteHours },
      stations: {
        planned: Math.floor(sf / sfPerStation),
        usableSf: sf,
        sfPerStation,
      },
      service: { meanServiceMin: service },
      prices: { avgTicketUsd: sitePrice },
      staff: { headcount: siteStaff, wageUsdPerHour: wage },
      costs: { cogsPctOfRevenue: cogs },
      lease: {
        sf,
        askingRentUsdPerSfYear: siteRentUsdPerSfYear,
        tripleNet: opex.value! > 0,
        opexUsdPerSfYear: (opex.value! * 12) / 100 / sf,
        buildoutUsd: buildout,
        leaseTermMonths: term,
      },
      calendar: {
        weekdayDaysPerMonth: WEEKDAYS_PER_MONTH,
        weekendDaysPerMonth: WEEKEND_DAYS_PER_MONTH,
      },
    };
    if (tweaks) {
      // A tweak must leave a config the simulator accepts; report which tweak field broke it.
      const parsed = SiteConfigSchema.safeParse(config);
      if (!parsed.success) {
        const fieldErrors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          const field = TWEAK_FIELD_FOR_CONFIG[String(issue.path[0])];
          (fieldErrors[
            field ? `siteTweaks.${id}.${field}` : `siteTweaks.${id}`
          ] ??= []).push(issue.message);
        }
        throw new SiteTweakError(
          `Tweaks for ${id} make the site impossible to simulate`,
          fieldErrors,
        );
      }
      appliedTweaks[id] = tweaks;
      finding(
        "SITE_TWEAKS_APPLIED",
        `Founder changes applied to this site only: ${describeTweaks(tweaks)}.`,
        id,
      );
    }
    sites.push({
      siteId: id,
      storefront,
      serviceMeanOrigin: assumptions["profile.serviceMinutes"]?.origin,
      config,
      // Cached Jev answers stay at the profile price; the evaluator reprices from it.
      ...(sitePrice !== price ? { jevBasePriceUsd: price } : {}),
    });
    panelSites.push({
      id: optionId(id),
      lat: storefront.location.lat,
      lng: storefront.location.lng,
      frontage: position === "end_cap" ? "endcap" : position,
      opensMin: hours.openMin,
      hasParking: c.features.parking.value ?? false,
    });
    if (c.features.parking.value === null)
      finding(
        "UNKNOWN_PARKING",
        "Jev parking input uses false for unverified parking, origin default.",
        id,
      );
    const bundle = await deps.getCatchment(id, profile);
    catchments.push(bundle);
    siteCatchments.set(id, bundle);
  }
  for (const id of Object.keys(input.siteTweaks ?? {}))
    if (!appliedTweaks[id])
      finding(
        "SITE_TWEAKS_IGNORED",
        "Tweaks were not applied because this candidate was excluded from the comparison.",
        id,
      );
  if (!sites.length)
    throw new AssemblyError(
      "No candidates have enough known inputs to evaluate",
      findings,
    );
  // HAC-60: one order-independent study area. Every candidate's catchment contributes; block
  // groups and workplaces are deduplicated by geoid at their largest allocated share (ties
  // broken by catchment ID), and everything is processed in a canonical order, so reordering
  // the candidates cannot change the population behind the comparison.
  const ordered = [...catchments].sort((a, b) =>
    a.response.catchment.id.localeCompare(b.response.catchment.id),
  );
  const largest = <T>(
    bundles: AssemblyCatchment[],
    pick: (bundle: AssemblyCatchment) => T[],
    key: (row: T) => string,
    size: (row: T) => number | null,
  ) => {
    const chosen = new Map<string, Picked<T>>();
    for (const bundle of bundles)
      for (const row of pick(bundle)) {
        const prev = chosen.get(key(row));
        if (!prev || (size(row) ?? -1) > (size(prev.row) ?? -1))
          chosen.set(key(row), { row, bundle });
      }
    return [...chosen.values()].sort((a, b) =>
      key(a.row).localeCompare(key(b.row)),
    );
  };
  const blockGroupsOf = (bundles: AssemblyCatchment[]) =>
    largest(
      bundles,
      (b) => b.response.residents.blockGroups,
      (bg) => bg.geoid,
      (bg) => bg.allocatedPopulation.value,
    );
  const workplacesOf = (bundles: AssemblyCatchment[]) =>
    largest(
      bundles,
      (b) => b.response.workers.blocks,
      (w) => w.geoid,
      (w) => w.jobs.value,
    );
  const studyAreaId = `study:${createHash("sha256")
    .update(ordered.map((b) => b.response.catchment.id).join("|"))
    .digest("hex")
    .slice(0, 16)}`;
  const studySite = [...panelSites].sort((a, b) =>
    a.id.localeCompare(b.id),
  )[0]!;
  finding(
    "SHARED_STUDY_AREA",
    `All sites share one order-independent study area (${studyAreaId}): the union of all ${catchments.length} candidates' catchments, with block groups and workplaces deduplicated at their largest allocated share. Results do not depend on candidate order.`,
  );
  finding(
    "AREA_PROXY",
    "Marketed floor area is the usable-area proxy; no measured internal layout is available, origin default.",
  );
  finding(
    "VEHICLES_NOT_PEOPLE",
    "Vehicle pass-by counts are excluded from personas: no calibrated vehicles-to-people conversion is available.",
  );
  finding(
    "DEMOGRAPHIC_DEFAULTS",
    "Persona age, children and commute distributions use explicit scenario defaults where source detail is unavailable; workplace jobs are a worker-demand proxy, not unique people.",
  );
  // Fallback location for records without coordinates: the mean of the candidate sites.
  const center: LatLng = {
    lat:
      sites.reduce((sum, s) => sum + s.storefront.location.lat, 0) /
      sites.length,
    lng:
      sites.reduce((sum, s) => sum + s.storefront.location.lng, 0) /
      sites.length,
  };
  for (const [key, value] of Object.entries({
    medianAge: 40,
    shareHouseholdsWithKids: 0.35,
    commuteDrive: 0.78,
    commuteWalk: 0.1,
    commuteTransit: 0.08,
    commuteBike: 0.04,
  }))
    number(`personas.defaults.${key}`, defaultMetric(value));
  // Same values as `number`, without recording assumptions or findings: used for the per-site
  // Jev personas (HAC-159), whose inputs are already recorded through the shared study area.
  const quiet = (path: string, metric: AssumedValue, fallback?: number) => {
    const value = metric.value ?? fallback;
    if (value === undefined || value === null)
      throw new AssemblyError(`Required input is unknown: ${path}`, findings);
    return value;
  };
  /**
   * Persona-builder input over `bundles`. With `record`, every input is recorded as an
   * assumption with its findings (the shared study area); without, nothing is recorded.
   */
  const personaInput = (args: {
    catchmentId: string;
    site: CandidateSite;
    bundles: AssemblyCatchment[];
    center: LatLng;
    record: boolean;
  }): CatchmentInput => {
    const { bundles, center, record } = args;
    const num = record ? number : quiet;
    const note = record ? finding : () => {};
    return {
      catchmentId: args.catchmentId,
      site: args.site,
      blockGroups: blockGroupsOf(bundles).flatMap(({ row: bg, bundle }) => {
        if (
          bg.allocatedPopulation.value === null ||
          bg.allocatedPopulation.value <= 0
        ) {
          note(
            "POPULATION_UNKNOWN",
            `Block group ${bg.geoid} has no usable allocated population.`,
          );
          return [];
        }
        const location =
          bundle.locations?.blockGroups?.[bg.geoid] ??
          bundles
            .map((b) => b.locations?.blockGroups?.[bg.geoid])
            .find(Boolean);
        if (!location)
          note(
            "DEFAULT_RESIDENT_LOCATION",
            `Block group ${bg.geoid} uses the catchment center as a location proxy, origin default.`,
          );
        const income = num(
          `personas.${bg.geoid}.medianIncome`,
          bg.medianHouseholdIncome,
          60000,
        );
        num(`personas.${bg.geoid}.population`, bg.allocatedPopulation);
        num(`personas.${bg.geoid}.households`, bg.allocatedHouseholds, 0);
        for (const [key, value] of Object.entries(location ?? center))
          num(`personas.${bg.geoid}.${key}`, {
            value,
            origin: location ? "public" : "default",
            unit: "degrees",
            evidenceIds: bg.areaFraction.evidenceIds,
          });
        return [
          {
            geoid: bg.geoid,
            lat: location?.lat ?? center.lat,
            lng: location?.lng ?? center.lng,
            population: Math.round(bg.allocatedPopulation.value),
            households: Math.round(bg.allocatedHouseholds.value ?? 0),
            medianHouseholdIncomeUsd: income,
            medianAge: 40,
            shareHouseholdsWithKids: 0.35,
            commuteShares: {
              drive: 0.78,
              walk: 0.1,
              transit: 0.08,
              bike: 0.04,
            },
          },
        ];
      }),
      workplaces: workplacesOf(bundles).flatMap(({ row: w, bundle }) => {
        if (w.jobs.value === null || w.jobs.value <= 0) {
          note("JOBS_UNKNOWN", `Workplace ${w.geoid} has no usable job count.`);
          return [];
        }
        const location =
          bundle.locations?.workers?.[w.geoid] ??
          bundles.map((b) => b.locations?.workers?.[w.geoid]).find(Boolean);
        num(`personas.workers.${w.geoid}.jobs`, w.jobs);
        const earnings = location?.earnings ?? { low: 1, mid: 1, high: 1 };
        const ages = location?.ages ?? { under30: 1, age30to54: 1, over55: 1 };
        for (const [key, value] of Object.entries(earnings))
          num(`personas.workers.${w.geoid}.earnings.${key}`, {
            value,
            origin: location?.earnings ? "public" : "default",
            unit: "weight",
            evidenceIds: w.jobs.evidenceIds,
          });
        for (const [key, value] of Object.entries(ages))
          num(`personas.workers.${w.geoid}.ages.${key}`, {
            value,
            origin: location?.ages ? "public" : "default",
            unit: "weight",
            evidenceIds: w.jobs.evidenceIds,
          });
        for (const [key, value] of Object.entries({
          lat: location?.lat ?? center.lat,
          lng: location?.lng ?? center.lng,
        }))
          num(`personas.workers.${w.geoid}.${key}`, {
            value,
            origin: location ? "public" : "default",
            unit: "degrees",
            evidenceIds: w.jobs.evidenceIds,
          });
        if (!location)
          note(
            "DEFAULT_WORKER_LOCATION",
            `Workplace ${w.geoid} uses the catchment center as location proxy, origin default.`,
          );
        return [
          {
            geoid: w.geoid,
            lat: location?.lat ?? center.lat,
            lng: location?.lng ?? center.lng,
            jobs: Math.round(w.jobs.value),
            earnings,
            ages,
          },
        ];
      }),
      passBy: [],
      competitors: [],
    };
  };
  const inputCatchment = personaInput({
    catchmentId: studyAreaId,
    site: studySite,
    bundles: ordered,
    center,
    record: true,
  });
  const personaSet = buildPersonas(inputCatchment);
  if (!personaSet.personas.length)
    throw new AssemblyError(
      "Catchment has no usable resident or workplace population",
      findings,
    );
  const competitors: Storefront[] = [];
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  for (const bundle of ordered)
    for (const competitor of [...bundle.response.competitors].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (
        seen.has(competitor.id) ||
        competitor.sourceIds.some((id) => seenSources.has(id))
      )
        continue;
      const location = competitor.sourceIds
        .map((id) => bundle.locations?.competitors?.[id])
        .find((p) => p !== undefined);
      if (!location) {
        finding(
          "COMPETITOR_LOCATION_UNKNOWN",
          `Competitor ${competitor.id} excluded because source coordinates are unavailable.`,
        );
        continue;
      }
      seen.add(competitor.id);
      competitor.sourceIds.forEach((id) => seenSources.add(id));
      const size = number(
        `competitors.${competitor.id}.sizeSqft`,
        defaultMetric(1500),
      );
      const frontage = number(
        `competitors.${competitor.id}.frontageFt`,
        defaultMetric(20),
      );
      const anchors = number(
        `competitors.${competitor.id}.anchorCoTenants`,
        defaultMetric(0),
      );
      for (const [key, value] of Object.entries({
        lat: location.lat,
        lng: location.lng,
      }))
        number(`competitors.${competitor.id}.${key}`, {
          value,
          origin: location.origin,
          evidenceIds: competitor.evidenceIds,
          unit: "degrees",
        });
      competitors.push({
        id: competitor.id,
        location: { lat: location.lat, lng: location.lng },
        sizeSqft: size,
        frontageFt: frontage,
        position: "inline",
        anchorCoTenants: anchors,
        origin: location.origin,
      });
    }
  finding(
    "COMPETITOR_DEFAULTS",
    "Competitor size/frontage/position/anchors, price and independent brand class are uncalibrated defaults; only location/category come from source records.",
  );
  let jevCompetitorSet: JevCompetitorSet | undefined;
  let jevPersonaSet: JevPersonaSetProvenance | undefined;
  if (input.demandSource === "jev" && deps.jev && price > 0) {
    // HAC-156: the union study area above stays for the population and Huff, but each site's
    // Jev competitors come from its own catchment only, so adding or removing other candidates
    // leaves that site's prompts and Jev cache keys unchanged.
    const businessType = category === "fitness" ? "fitness_studio" : category;
    const perSite = new Map<string, Competitor[]>();
    const canonicalCompetitors = new Map<string, string>();
    jevCompetitorSet = { version: JEV_COMPETITOR_SET_VERSION, sites: {} };
    for (const site of sites) {
      const bundle = siteCatchments.get(site.siteId)!;
      const { competitors: chosen, eligibleCount } = siteJevCompetitors(
        bundle,
        { businessType, priceUsd: price },
      );
      if (eligibleCount > chosen.length)
        finding(
          "JEV_COMPETITORS_CAPPED",
          `Jev was shown ${chosen.length} of ${eligibleCount} competitors in this site's catchment (lowest stable venue IDs first).`,
          site.siteId,
        );
      jevCompetitorSet.sites[site.siteId] = {
        competitorIds: chosen.map((c) => c.sourceId),
        capped: eligibleCount > chosen.length,
      };
      for (const c of chosen)
        canonicalCompetitors.set(c.competitor.id, c.sourceId);
      perSite.set(
        optionId(site.siteId),
        chosen.map((c) => c.competitor),
      );
    }
    finding(
      "JEV_COMPETITOR_SET",
      `Jev competitor options come from each site's own catchment (${JEV_COMPETITOR_SET_VERSION}); the shared study area is used for population and Huff only.`,
    );
    // HAC-159: the same for the personas. Each site's Jev personas are built from its own
    // catchment and seeded by its own catchment ID, so a site's full Jev request set (personas
    // and competitors) is identical alone or with any other candidates. The shared study-area
    // personas above stay the population for Huff.
    const personasBySite = new Map<string, PersonaSet>();
    jevPersonaSet = { version: JEV_PERSONA_SET_VERSION, sites: {} };
    for (const site of sites) {
      const bundle = siteCatchments.get(site.siteId)!;
      const panelSite = panelSites.find((p) => p.id === optionId(site.siteId))!;
      const set = buildPersonas(
        personaInput({
          catchmentId: bundle.response.catchment.id,
          site: panelSite,
          bundles: [bundle],
          center: site.storefront.location,
          record: false,
        }),
      );
      personasBySite.set(panelSite.id, set);
      jevPersonaSet.sites[site.siteId] = {
        catchmentId: set.catchmentId,
        personaCount: set.personas.length,
      };
    }
    if (Object.values(appliedTweaks).some((t) => t.hours || t.priceUsd))
      finding(
        "SITE_TWEAKS_JEV",
        "Jev answers were collected at the profile's opening time and price. Tweaked hours change only the simulated open window; a tweaked price rescales cached Jev visits by each persona's cached price acceptance.",
      );
    finding(
      "JEV_PERSONA_SET",
      `Jev personas come from each site's own catchment, seeded by its catchment ID (${JEV_PERSONA_SET_VERSION}); the shared study-area personas are used for Huff only.`,
    );
    const { tables, progress } = await runPanelForSites({
      personaSet,
      personaSetForSite: (site) => personasBySite.get(site.id) ?? personaSet,
      sites: panelSites,
      competitors: [],
      competitorsForSite: (site) => perSite.get(site.id) ?? [],
      need: {
        businessType: category === "fitness" ? "fitness_studio" : category,
        priceUsd: price,
        serviceMinPerCustomer: service,
      },
      ...deps.jev,
      ...panelDeadline,
    });
    if (progress.inProgress)
      throw new PanelInProgressError(
        progress.completedPersonas,
        progress.totalPersonas,
      );
    const canonical = new Map([
      ...sites.map((s) => [optionId(s.siteId), s.siteId] as const),
      ...competitors.map((c) => [optionId(c.id), c.id] as const),
      ...canonicalCompetitors,
    ]);
    for (const site of sites) {
      const table = tables.find((t) => t.siteId === optionId(site.siteId));
      const sitePersonas = personasBySite.get(optionId(site.siteId))!;
      const personaCount = sitePersonas.personas.length;
      // Personas still unanswered after the panel's own retry; a missing table counts them all.
      const failedPersonaCount = table
        ? Math.max(
            table.failedPersonaIds.length,
            personaCount - table.personas.length,
          )
        : personaCount;
      site.jevPanel = { personaCount, failedPersonaCount };
      if (!table || failedPersonaCount > 0 || personaCount === 0) {
        finding(
          "JEV_INCOMPLETE",
          `Jev failed for ${failedPersonaCount} of ${personaCount} personas after one retry; all-site Huff fallback will be used.`,
          site.siteId,
        );
        continue;
      }
      site.behaviorTable = {
        ...table,
        siteId: site.siteId,
        personas: table.personas.map((p) => ({
          ...p,
          where: Object.fromEntries(
            Object.entries(p.where).map(([id, share]) => [
              canonical.get(id) ?? id,
              share,
            ]),
          ),
        })),
      };
      site.jevPersonaSet = sitePersonas;
      site.behaviorTableId = `assembled:${createHash("sha256").update(JSON.stringify(site.behaviorTable)).digest("hex")}`;
    }
  } else if (input.demandSource === "jev")
    finding(
      "JEV_UNAVAILABLE",
      "Jev was requested but no configured client/cache or positive ticket is available; evaluation will report Huff fallback.",
    );
  const request = EvaluationRequestSchema.parse({
    projectId: input.projectId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    synthetic:
      profile.synthetic ||
      sites.some((s) => rows.get(s.siteId)!.candidate.synthetic),
    city: profile.city === "Houston" ? "houston" : "los_angeles",
    category: category === "salon_barber" ? "salon" : category,
    priceTier: tier === "budget" ? "low" : tier === "premium" ? "high" : "mid",
    personaSet,
    sites,
    competitors,
    demandSource: input.demandSource,
    ...(input.seeds ? { seeds: input.seeds } : {}),
  });
  return {
    request,
    findings,
    assumptions,
    ...(jevCompetitorSet ? { jevCompetitorSet } : {}),
    ...(jevPersonaSet ? { jevPersonaSet } : {}),
    ...(Object.keys(appliedTweaks).length ? { siteTweaks: appliedTweaks } : {}),
  };
}

/**
 * HAC-156: one site's Jev competitor options, from that site's own catchment only (never the
 * shared study area): venues with source coordinates, deduplicated by source ID, sorted by
 * stable venue ID and capped at `JEV_MAX_COMPETITORS`. A pure function of the site's catchment,
 * so other candidates in the comparison cannot change it.
 */
export function siteJevCompetitors(
  bundle: AssemblyCatchment,
  options: { businessType: Competitor["businessType"]; priceUsd: number },
): {
  competitors: { sourceId: string; competitor: Competitor }[];
  eligibleCount: number;
} {
  const sources = new Set<string>();
  const eligible = [...bundle.response.competitors]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap((competitor) => {
      if (competitor.sourceIds.some((id) => sources.has(id))) return [];
      const location = competitor.sourceIds
        .map((id) => bundle.locations?.competitors?.[id])
        .find((p) => p !== undefined);
      if (!location) return [];
      competitor.sourceIds.forEach((id) => sources.add(id));
      return [
        {
          sourceId: competitor.id,
          competitor: {
            id: optionId(competitor.id),
            lat: location.lat,
            lng: location.lng,
            brandClass: "independent" as const,
            businessType: options.businessType,
            priceUsd: options.priceUsd,
          },
        },
      ];
    });
  return {
    competitors: eligible.slice(0, JEV_MAX_COMPETITORS),
    eligibleCount: eligible.length,
  };
}

export async function assembleEvaluationRequest(
  input: AssembleEvaluationInput,
  deps: AssemblyDependencies,
): Promise<EvaluationRequest> {
  return (await assembleEvaluation(input, deps)).request;
}
