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
  type EvaluationRequest,
  type EvaluationSite,
} from "@/lib/contracts/evaluation";
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
} from "@/lib/panel/contracts";
import { buildPersonas } from "@/lib/panel/personas";
import { runPanelForSites } from "@/lib/panel/panel";
import type { JevClient } from "@/lib/panel/jev-client";
import type { JevCache } from "@/lib/panel/cache";

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
  })
  .strict();
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
});
export type AssembleEvaluationInput = z.input<typeof AssemblyInputSchema>;
export type AssemblyFinding = {
  code: string;
  message: string;
  siteId?: string;
};
export type AssemblyMetadata = {
  findings: AssemblyFinding[];
  assumptions: Record<
    string,
    { value: number; origin: Origin; evidenceIds: string[] }
  >;
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
export type AssemblyDependencies = {
  searchSites(
    profile: BusinessProfile,
    candidateIds: string[],
  ): Promise<AssemblySearch>;
  getCatchment(
    siteId: string,
    profile: BusinessProfile,
  ): Promise<AssemblyCatchment>;
  jev?: { client: JevClient; cache: JevCache };
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
  const panelSites: CandidateSite[] = [];
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
      ["operating expenses", row.opexCents.value],
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
    number(`${path}.monthlyOpexCents`, row.opexCents);
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
    trace(
      "lease.opexUsdPerSfYear",
      (row.opexCents.value! * 12) / 100 / sf,
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
        number(`${path}.config.hours.${day}.${key}`, {
          value: hours[key],
          origin: profile.synthetic ? "default" : "founder",
          evidenceIds: [`profile:${profile.id}:operatingHours`],
          unit: "minutes",
        });
    sites.push({
      siteId: id,
      storefront,
      serviceMeanOrigin: assumptions["profile.serviceMinutes"]?.origin,
      config: {
        hours: { weekday: hours, weekend: hours },
        stations: {
          planned: Math.floor(sf / sfPerStation),
          usableSf: sf,
          sfPerStation,
        },
        service: { meanServiceMin: service },
        prices: { avgTicketUsd: price },
        staff: { headcount: staff, wageUsdPerHour: wage },
        costs: { cogsPctOfRevenue: cogs },
        lease: {
          sf,
          askingRentUsdPerSfYear: (row.baseRentCents.value! * 12) / 100 / sf,
          tripleNet: row.opexCents.value! > 0,
          opexUsdPerSfYear: (row.opexCents.value! * 12) / 100 / sf,
          buildoutUsd: buildout,
          leaseTermMonths: term,
        },
        calendar: {
          weekdayDaysPerMonth: WEEKDAYS_PER_MONTH,
          weekendDaysPerMonth: WEEKEND_DAYS_PER_MONTH,
        },
      },
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
    catchments.push(await deps.getCatchment(id, profile));
  }
  if (!sites.length)
    throw new AssemblyError(
      "No candidates have enough known inputs to evaluate",
      findings,
    );
  const first = catchments[0]!;
  const firstSite = sites[0]!;
  finding(
    "SHARED_CATCHMENT",
    `All sites use the first eligible candidate's catchment (${firstSite.siteId}) for one shared, seeded persona population.`,
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
  const center = firstSite.storefront.location;
  for (const [key, value] of Object.entries({
    medianAge: 40,
    shareHouseholdsWithKids: 0.35,
    commuteDrive: 0.78,
    commuteWalk: 0.1,
    commuteTransit: 0.08,
    commuteBike: 0.04,
  }))
    number(`personas.defaults.${key}`, defaultMetric(value));
  const inputCatchment: CatchmentInput = {
    catchmentId: first.response.catchment.id,
    site: panelSites[0]!,
    blockGroups: first.response.residents.blockGroups.flatMap((bg) => {
      if (
        bg.allocatedPopulation.value === null ||
        bg.allocatedPopulation.value <= 0
      ) {
        finding(
          "POPULATION_UNKNOWN",
          `Block group ${bg.geoid} has no usable allocated population.`,
        );
        return [];
      }
      const location = first.locations?.blockGroups?.[bg.geoid];
      if (!location)
        finding(
          "DEFAULT_RESIDENT_LOCATION",
          `Block group ${bg.geoid} uses the catchment center as a location proxy, origin default.`,
        );
      const income = number(
        `personas.${bg.geoid}.medianIncome`,
        bg.medianHouseholdIncome,
        60000,
      );
      number(`personas.${bg.geoid}.population`, bg.allocatedPopulation);
      number(`personas.${bg.geoid}.households`, bg.allocatedHouseholds, 0);
      for (const [key, value] of Object.entries(location ?? center))
        number(`personas.${bg.geoid}.${key}`, {
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
          commuteShares: { drive: 0.78, walk: 0.1, transit: 0.08, bike: 0.04 },
        },
      ];
    }),
    workplaces: first.response.workers.blocks.flatMap((w) => {
      if (w.jobs.value === null || w.jobs.value <= 0) {
        finding(
          "JOBS_UNKNOWN",
          `Workplace ${w.geoid} has no usable job count.`,
        );
        return [];
      }
      const location = first.locations?.workers?.[w.geoid];
      number(`personas.workers.${w.geoid}.jobs`, w.jobs);
      const earnings = location?.earnings ?? { low: 1, mid: 1, high: 1 };
      const ages = location?.ages ?? { under30: 1, age30to54: 1, over55: 1 };
      for (const [key, value] of Object.entries(earnings))
        number(`personas.workers.${w.geoid}.earnings.${key}`, {
          value,
          origin: location?.earnings ? "public" : "default",
          unit: "weight",
          evidenceIds: w.jobs.evidenceIds,
        });
      for (const [key, value] of Object.entries(ages))
        number(`personas.workers.${w.geoid}.ages.${key}`, {
          value,
          origin: location?.ages ? "public" : "default",
          unit: "weight",
          evidenceIds: w.jobs.evidenceIds,
        });
      for (const [key, value] of Object.entries({
        lat: location?.lat ?? center.lat,
        lng: location?.lng ?? center.lng,
      }))
        number(`personas.workers.${w.geoid}.${key}`, {
          value,
          origin: location ? "public" : "default",
          unit: "degrees",
          evidenceIds: w.jobs.evidenceIds,
        });
      if (!location)
        finding(
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
  const personaSet = buildPersonas(inputCatchment);
  if (!personaSet.personas.length)
    throw new AssemblyError(
      "Catchment has no usable resident or workplace population",
      findings,
    );
  const competitors: Storefront[] = [];
  const panelCompetitors: Competitor[] = [];
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  for (const bundle of catchments)
    for (const competitor of bundle.response.competitors) {
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
      panelCompetitors.push({
        id: optionId(competitor.id),
        lat: location.lat,
        lng: location.lng,
        brandClass: "independent",
        businessType: category === "fitness" ? "fitness_studio" : category,
        priceUsd: price,
      });
    }
  finding(
    "COMPETITOR_DEFAULTS",
    "Competitor size/frontage/position/anchors, price and independent brand class are uncalibrated defaults; only location/category come from source records.",
  );
  if (input.demandSource === "jev" && deps.jev && price > 0) {
    const { tables } = await runPanelForSites({
      personaSet,
      sites: panelSites,
      competitors: panelCompetitors,
      need: {
        businessType: category === "fitness" ? "fitness_studio" : category,
        priceUsd: price,
        serviceMinPerCustomer: service,
      },
      ...deps.jev,
    });
    const canonical = new Map([
      ...sites.map((s) => [optionId(s.siteId), s.siteId] as const),
      ...competitors.map((c) => [optionId(c.id), c.id] as const),
    ]);
    for (const site of sites) {
      const table = tables.find((t) => t.siteId === optionId(site.siteId));
      if (
        !table ||
        table.failedPersonaIds.length ||
        table.personas.length !== personaSet.personas.length
      ) {
        finding(
          "JEV_INCOMPLETE",
          "Jev table incomplete; all-site Huff fallback will be used.",
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
  return { request, findings, assumptions };
}

export async function assembleEvaluationRequest(
  input: AssembleEvaluationInput,
  deps: AssemblyDependencies,
): Promise<EvaluationRequest> {
  return (await assembleEvaluation(input, deps)).request;
}
